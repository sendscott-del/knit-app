-- Two RLS fixes in one pass:
--
-- 1) PERFORMANCE: policies called knit_can_view_ward(ward_id) /
--    knit_can_edit_ward(ward_id) per candidate row. On knit_members that's
--    3,300+ helper-cascade executions per query (each touching auth.users and
--    gather_user_roles) on the shared suite DB. New SETOF helpers compute the
--    caller's ward set ONCE per query (one helper call per ward, ~9 wards) and
--    policies become hashed `ward_id IN (SELECT ...)` subplans. Semantics are
--    identical because the helpers delegate to the same predicates.
--
-- 2) WRITE SCOPING: the member child tables (availability baselines/
--    exceptions, interests, participation styles, notifications log, outing
--    suggestions) had FOR ALL policies whose only test was "the parent row is
--    visible" — so view-only roles (stake presidency, high councilors) could
--    insert/update/DELETE availability data and notification-log rows
--    (deleting log rows defeats SMS dedupe). Reads stay view-scoped; writes
--    now require edit rights on the member's ward. knit_notifications_log
--    becomes service-role-write-only (only server endpoints ever write it).
--
-- Note on edit reach: the editable set is knit_can_edit_ward(w) OR
-- knit_is_app_super_admin() OR knit_is_ward_super_admin(w), matching the
-- v0.49.0 Gather-centric model already enforced by the server endpoints
-- (api/_lib/auth.ts + knit_member_invitations RPC gates). Previously a
-- Gather-granted WML with no knit_admin_users row could VIEW members but
-- direct table writes silently failed; this aligns DB write reach with the
-- intended model.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.knit_viewable_ward_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select w.id from public.knit_wards w
  where public.knit_can_view_ward(w.id)
$$;

create or replace function public.knit_editable_ward_ids()
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  select w.id from public.knit_wards w
  where public.knit_can_edit_ward(w.id)
     or public.knit_is_app_super_admin()
     or public.knit_is_ward_super_admin(w.id)
$$;

-- RLS-bypassing parent lookups so child-table policies don't re-trigger the
-- knit_members / knit_friends policies per row.
create or replace function public.knit_member_ward(p_member_id uuid)
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
  select ward_id from public.knit_members where id = p_member_id
$$;

create or replace function public.knit_friend_ward(p_friend_id uuid)
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
  select ward_id from public.knit_friends where id = p_friend_id
$$;

revoke execute on function public.knit_viewable_ward_ids(), public.knit_editable_ward_ids(),
  public.knit_member_ward(uuid), public.knit_friend_ward(uuid) from public, anon;
grant execute on function public.knit_viewable_ward_ids(), public.knit_editable_ward_ids(),
  public.knit_member_ward(uuid), public.knit_friend_ward(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Ward-keyed tables: same semantics, set-based evaluation
-- ---------------------------------------------------------------------------

drop policy if exists knit_members_select on public.knit_members;
create policy knit_members_select on public.knit_members
  for select to authenticated
  using (ward_id in (select public.knit_viewable_ward_ids()));

drop policy if exists knit_members_write on public.knit_members;
create policy knit_members_write on public.knit_members
  for all to authenticated
  using (ward_id in (select public.knit_editable_ward_ids()))
  with check (ward_id in (select public.knit_editable_ward_ids()));

drop policy if exists knit_friends_select on public.knit_friends;
create policy knit_friends_select on public.knit_friends
  for select to authenticated
  using (ward_id in (select public.knit_viewable_ward_ids()));

drop policy if exists knit_friends_write on public.knit_friends;
create policy knit_friends_write on public.knit_friends
  for all to authenticated
  using (ward_id in (select public.knit_editable_ward_ids()))
  with check (ward_id in (select public.knit_editable_ward_ids()));

drop policy if exists knit_outings_select on public.knit_outings;
create policy knit_outings_select on public.knit_outings
  for select to authenticated
  using (ward_id in (select public.knit_viewable_ward_ids()));

drop policy if exists knit_outings_write on public.knit_outings;
create policy knit_outings_write on public.knit_outings
  for all to authenticated
  using (ward_id in (select public.knit_editable_ward_ids()))
  with check (ward_id in (select public.knit_editable_ward_ids()));

drop policy if exists knit_companionships_select on public.knit_companionships;
create policy knit_companionships_select on public.knit_companionships
  for select to authenticated
  using (ward_id in (select public.knit_viewable_ward_ids()));

drop policy if exists knit_companionships_write on public.knit_companionships;
create policy knit_companionships_write on public.knit_companionships
  for all to authenticated
  using (ward_id in (select public.knit_editable_ward_ids()))
  with check (ward_id in (select public.knit_editable_ward_ids()));

drop policy if exists knit_sheet_bindings_select on public.knit_google_sheet_bindings;
create policy knit_sheet_bindings_select on public.knit_google_sheet_bindings
  for select to authenticated
  using (ward_id in (select public.knit_viewable_ward_ids()));

drop policy if exists knit_sheet_bindings_write on public.knit_google_sheet_bindings;
create policy knit_sheet_bindings_write on public.knit_google_sheet_bindings
  for all to authenticated
  using (ward_id in (select public.knit_editable_ward_ids()))
  with check (ward_id in (select public.knit_editable_ward_ids()));

drop policy if exists knit_interest_tags_select on public.knit_interest_tags;
create policy knit_interest_tags_select on public.knit_interest_tags
  for select to authenticated
  using (ward_id is null or ward_id in (select public.knit_viewable_ward_ids()));

drop policy if exists knit_interest_tags_write on public.knit_interest_tags;
create policy knit_interest_tags_write on public.knit_interest_tags
  for all to authenticated
  using (ward_id is not null and ward_id in (select public.knit_editable_ward_ids()))
  with check (ward_id is not null and ward_id in (select public.knit_editable_ward_ids()));

-- ---------------------------------------------------------------------------
-- Member child tables: read = view scope, write = edit scope
-- ---------------------------------------------------------------------------

drop policy if exists knit_avail_baselines_scope on public.knit_availability_baselines;
create policy knit_avail_baselines_select on public.knit_availability_baselines
  for select to authenticated
  using (public.knit_member_ward(member_id) in (select public.knit_viewable_ward_ids()));
create policy knit_avail_baselines_write on public.knit_availability_baselines
  for all to authenticated
  using (public.knit_member_ward(member_id) in (select public.knit_editable_ward_ids()))
  with check (public.knit_member_ward(member_id) in (select public.knit_editable_ward_ids()));

drop policy if exists knit_avail_exceptions_scope on public.knit_availability_exceptions;
create policy knit_avail_exceptions_select on public.knit_availability_exceptions
  for select to authenticated
  using (public.knit_member_ward(member_id) in (select public.knit_viewable_ward_ids()));
create policy knit_avail_exceptions_write on public.knit_availability_exceptions
  for all to authenticated
  using (public.knit_member_ward(member_id) in (select public.knit_editable_ward_ids()))
  with check (public.knit_member_ward(member_id) in (select public.knit_editable_ward_ids()));

drop policy if exists knit_member_interests_admin_scope on public.knit_member_interests;
create policy knit_member_interests_select on public.knit_member_interests
  for select to authenticated
  using (public.knit_member_ward(member_id) in (select public.knit_viewable_ward_ids()));
create policy knit_member_interests_write on public.knit_member_interests
  for all to authenticated
  using (public.knit_member_ward(member_id) in (select public.knit_editable_ward_ids()))
  with check (public.knit_member_ward(member_id) in (select public.knit_editable_ward_ids()));

drop policy if exists knit_member_styles_admin_scope on public.knit_member_participation_styles;
create policy knit_member_styles_select on public.knit_member_participation_styles
  for select to authenticated
  using (public.knit_member_ward(member_id) in (select public.knit_viewable_ward_ids()));
create policy knit_member_styles_write on public.knit_member_participation_styles
  for all to authenticated
  using (public.knit_member_ward(member_id) in (select public.knit_editable_ward_ids()))
  with check (public.knit_member_ward(member_id) in (select public.knit_editable_ward_ids()));

-- Notifications log: read-only for leaders; ONLY the service role writes it.
drop policy if exists knit_notifications_log_scope on public.knit_notifications_log;
create policy knit_notifications_log_select on public.knit_notifications_log
  for select to authenticated
  using (public.knit_member_ward(member_id) in (select public.knit_viewable_ward_ids()));

-- Outing suggestions audit: read for viewers; write requires edit rights on
-- the friend's ward (server inserts via service role and bypasses RLS).
drop policy if exists knit_outing_suggestions_scope on public.knit_outing_suggestions;
create policy knit_outing_suggestions_select on public.knit_outing_suggestions
  for select to authenticated
  using (public.knit_friend_ward(friend_id) in (select public.knit_viewable_ward_ids()));
create policy knit_outing_suggestions_write on public.knit_outing_suggestions
  for all to authenticated
  using (public.knit_friend_ward(friend_id) in (select public.knit_editable_ward_ids()))
  with check (public.knit_friend_ward(friend_id) in (select public.knit_editable_ward_ids()));

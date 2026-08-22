-- Members on the magic-link (no-login) dashboard/onboarding are the `anon` role.
-- knit_interest_tags' only SELECT policy is `to authenticated`, so the interest
-- picker's direct table read returned zero rows (RLS filters silently, no error)
-- and "What you love" rendered empty for every member from 2026-06-12 on.
-- Give members a token-checked SECURITY DEFINER read, matching the other
-- knit_member_self_* RPCs, instead of widening the table's RLS to anon.

create or replace function public.knit_member_self_list_interest_tags(
  p_member_id uuid,
  p_token text
)
returns setof public.knit_interest_tags
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
begin
  if not public.knit_member_token_is_valid(p_member_id, p_token) then
    raise exception 'Invalid or expired link' using errcode = '28000';
  end if;

  return query
  select t.*
  from public.knit_interest_tags t
  where t.active
    and (
      t.ward_id is null
      or t.ward_id = (select m.ward_id from public.knit_members m where m.id = p_member_id)
    )
  order by t.name_en;
end;
$function$;

revoke all on function public.knit_member_self_list_interest_tags(uuid, text) from public;
grant execute on function public.knit_member_self_list_interest_tags(uuid, text)
  to anon, authenticated, service_role;

-- Lock down gather_user_roles reads.
--
-- The original policy was USING (true) for all authenticated users. Because
-- auth.users is shared across the whole Gathered suite (and Knit has open
-- self-signup), any signed-up stranger could read the entire stake leadership
-- catalog (emails, names, wards, notes) with the public anon key.
--
-- New rule: you can read your own rows; leadership (anyone holding an active
-- suite role, a gather super admin, or a Knit stake-presidency/super admin)
-- can read the catalog. Known client readers preserved:
--   - knit-app AdminUsers.tsx (gated by canManageStake)
--   - gathered-admin gather/page.tsx (gather super admins)
-- Knit's RLS helpers are SECURITY DEFINER and unaffected.

create or replace function public.gather_can_read_role_catalog()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.gather_super_admins gsa
      where gsa.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.gather_user_roles gur
      where lower(gur.email) = lower((select auth.jwt()->>'email'))
        and gur.revoked_at is null
    )
    or exists (
      select 1 from public.knit_admin_users kau
      where kau.id = (select auth.uid())
        and (kau.is_super_admin or kau.role = 'stake_presidency')
    )
$$;

revoke execute on function public.gather_can_read_role_catalog() from public, anon;
grant execute on function public.gather_can_read_role_catalog() to authenticated;

drop policy if exists gather_user_roles_read on public.gather_user_roles;
create policy gather_user_roles_read on public.gather_user_roles
  for select to authenticated
  using (
    lower(email) = lower((select auth.jwt()->>'email'))
    or (select public.gather_can_read_role_catalog())
  );

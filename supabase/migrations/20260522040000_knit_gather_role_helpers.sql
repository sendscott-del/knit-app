-- 20260522040000_knit_gather_role_helpers.sql
-- Knit-side helpers that read from the shared gather_user_roles catalog.
-- Not yet bound into Knit's RLS — these exist so the new /admin/roles page
-- and future Knit features can check the 19-role catalog alongside the
-- existing knit_admin_users table.
--
-- Lives on the shared Supabase project (isogetmvnpimcmouakeg) since Knit
-- is on that project. Tidings reads cross-Supabase as before.

CREATE OR REPLACE FUNCTION public.knit_current_user_has_gather_role(p_role text)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.gather_user_roles gur
    JOIN auth.users au ON lower(au.email) = lower(gur.email)
    WHERE au.id = auth.uid()
      AND gur.role_key = p_role
      AND gur.revoked_at IS NULL
  );
$fn$;

-- Knit "app super admin" per spreadsheet: Stake President, Stake Clerk,
-- or High Councilor — Missionary Work. Full read/write across the stake.
CREATE OR REPLACE FUNCTION public.knit_is_app_super_admin()
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
  SELECT
    EXISTS (SELECT 1 FROM public.knit_admin_users WHERE id = auth.uid() AND is_super_admin = true)
    OR public.knit_current_user_has_gather_role('stake_president')
    OR public.knit_current_user_has_gather_role('stake_clerk')
    OR public.knit_current_user_has_gather_role('hc_missionary_work');
$fn$;

-- Knit "ward super admin": Ward Mission Leader within their specific ward.
CREATE OR REPLACE FUNCTION public.knit_is_ward_super_admin(p_ward_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
  SELECT
    EXISTS (
      SELECT 1 FROM public.knit_admin_users
      WHERE id = auth.uid()
        AND role = 'ward_mission_leader'
        AND ward_id = p_ward_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.gather_user_roles gur
      JOIN auth.users au ON lower(au.email) = lower(gur.email)
      JOIN public.knit_wards w ON w.name = gur.ward
      WHERE au.id = auth.uid()
        AND gur.role_key = 'ward_mission_leader'
        AND gur.revoked_at IS NULL
        AND w.id = p_ward_id
    );
$fn$;

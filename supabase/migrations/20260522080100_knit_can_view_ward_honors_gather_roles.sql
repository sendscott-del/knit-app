-- 20260522080100_knit_can_view_ward_honors_gather_roles.sql
-- Extend knit_can_view_ward to also recognize the gather_user_roles catalog
-- for stake-level roles (stake_president, stake_clerk, hc_missionary_work)
-- and ward-level WMLs. Without this, those roles can't search members to
-- invite from the new /admin/invitations page because knit_members RLS would
-- block the SELECT. knit_can_edit_ward is intentionally NOT broadened —
-- stake_president and stake_clerk remain read-only per the original spec.

CREATE OR REPLACE FUNCTION public.knit_can_view_ward(p_ward uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $fn$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.knit_current_admin() a
      LEFT JOIN public.knit_wards w ON w.id = p_ward
      WHERE a.admin_is_super
         OR (a.admin_role IN ('stake_presidency','high_councilor')
             AND a.admin_stake_id = w.stake_id)
         OR (a.admin_role IN ('ward_mission_leader','relief_society_presidency','elders_quorum_presidency')
             AND a.admin_ward_id = p_ward)
    )
    OR (
      public.knit_is_app_super_admin()
      AND EXISTS (SELECT 1 FROM public.knit_wards w WHERE w.id = p_ward)
    )
    OR public.knit_is_ward_super_admin(p_ward);
$fn$;

COMMENT ON FUNCTION public.knit_can_view_ward(uuid) IS
  'View-permission check for ward-scoped data. Honors knit_admin_users and the gather_user_roles catalog (app super admin = stake-wide read; ward super admin = own-ward read).';

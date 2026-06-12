-- Hardening batch from the 2026-06-12 code review.
--
-- 1) paused_until was INVERTED in the SQL "is active" helpers: a member paused
--    into the future counted as active (TypeScript consumers have it right).
--    Active means the pause has expired: paused_until <= today.
-- 2) knit_is_ward_super_admin joined gather grants to wards by NAME only — a
--    same-named ward in another stake would cross-grant member PII access.
--    Scope the join by the grant's stake (populated on every live row).
-- 3) Grants: knit_generate_member_magic_link keeps its authenticated EXECUTE —
--    AdminMembers.tsx calls it client-side for the copy-invite-link flow, and
--    it is SECURITY INVOKER so the inner UPDATE is gated by knit_members_write
--    (now edit-scoped). Anon has no business calling it. IMPORTANT: this
--    function must stay SECURITY INVOKER; flipping it to DEFINER would let any
--    authenticated user mint magic links. knit_active_member_ids_in_ward
--    leaked active member UUIDs (half a magic-link URL) to anon.
-- 4) Re-apply four indexes that exist in migrations but drifted out of prod,
--    plus an index for the AdminSuggest recent-suggestions query.

-- (1) paused_until fix
CREATE OR REPLACE FUNCTION public.knit_member_is_active(p_member_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.knit_members m
    WHERE m.id = p_member_id
      AND m.onboarding_completed_at IS NOT NULL
      AND m.opted_out_at IS NULL
      AND (m.paused_until IS NULL OR m.paused_until <= CURRENT_DATE)
      AND EXISTS (
        SELECT 1 FROM public.knit_availability_baselines b
        WHERE b.member_id = m.id
      )
  );
$fn$;

CREATE OR REPLACE FUNCTION public.knit_active_member_ids_in_ward(p_ward_id uuid)
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
  SELECT m.id
  FROM public.knit_members m
  WHERE m.ward_id = p_ward_id
    AND m.onboarding_completed_at IS NOT NULL
    AND m.opted_out_at IS NULL
    AND (m.paused_until IS NULL OR m.paused_until <= CURRENT_DATE)
    AND EXISTS (SELECT 1 FROM public.knit_availability_baselines b WHERE b.member_id = m.id);
$fn$;

-- (2) stake-scoped ward grant join
CREATE OR REPLACE FUNCTION public.knit_is_ward_super_admin(p_ward_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      JOIN public.knit_stakes s ON s.id = w.stake_id AND s.name = gur.stake
      WHERE au.id = auth.uid()
        AND gur.role_key = 'ward_mission_leader'
        AND gur.revoked_at IS NULL
        AND w.id = p_ward_id
    );
$function$;

-- (3) least-privilege grants
REVOKE EXECUTE ON FUNCTION public.knit_generate_member_magic_link(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.knit_active_member_ids_in_ward(uuid) FROM public, anon;

-- (4) drifted + new indexes
CREATE INDEX IF NOT EXISTS knit_friends_ward_active_idx
  ON public.knit_friends (ward_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS knit_member_invitations_ward_created_idx
  ON public.knit_member_invitations (ward_id, created_at DESC);
CREATE INDEX IF NOT EXISTS knit_member_invitations_member_created_idx
  ON public.knit_member_invitations (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS knit_members_callings_idx
  ON public.knit_members USING gin (callings);
CREATE INDEX IF NOT EXISTS knit_outing_suggestions_suggested_at_idx
  ON public.knit_outing_suggestions (suggested_at DESC);

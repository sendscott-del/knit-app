-- 20260522060000_knit_member_is_active_helper.sql
-- Canonical "is this member active?" predicate, per the Gathered User Access
-- spreadsheet rule: "Ward members don't show as active options until they
-- have completed a Knit availability update."
--
-- Active = onboarding_completed_at IS NOT NULL
--          AND has at least one row in knit_availability_baselines
--          AND not opted_out_at
--          AND not paused_until > today

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
      AND (m.paused_until IS NULL OR m.paused_until > CURRENT_DATE)
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
    AND (m.paused_until IS NULL OR m.paused_until > CURRENT_DATE)
    AND EXISTS (SELECT 1 FROM public.knit_availability_baselines b WHERE b.member_id = m.id);
$fn$;

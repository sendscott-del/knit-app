-- 20260604080000_knit_events_and_insights.sql
-- Two things, both for the new super-admin-only /admin/insights page:
--
-- 1. public.knit_events — a PII-safe capture table for client + server errors
--    (and, later, named usage events). Written ONLY by the service role
--    (the /api/events endpoint and server _lib helpers); read by app super
--    admins via RLS. Deliberately stores no member names or free-text PII:
--    member/ward are UUID references, route is a sanitized path pattern, and
--    `message`/`detail` carry developer-facing error strings, length-capped
--    at the write endpoint. Church-lane rule: never log names/specifics.
--
-- 2. public.knit_admin_insights() — a SECURITY DEFINER aggregate that returns
--    one JSON blob powering the dashboard: per-ward adoption funnel, what
--    members are picking (interests / styles / availability), the in-app
--    feedback inbox status, and operational health (sheets, SMS, invitations,
--    errors). Gated to app super admins so the browser never has to pull
--    thousands of roster rows and authz is enforced in the database.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Event / error capture table
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.knit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL DEFAULT 'error' CHECK (kind IN ('error', 'event')),
  name        text NOT NULL,
  severity    text NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error')),
  source      text NOT NULL CHECK (source IN ('client', 'server')),
  route       text,
  ward_id     uuid REFERENCES public.knit_wards(id)       ON DELETE SET NULL,
  member_id   uuid REFERENCES public.knit_members(id)     ON DELETE SET NULL,
  admin_id    uuid REFERENCES public.knit_admin_users(id) ON DELETE SET NULL,
  message     text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_version text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knit_events_created_idx
  ON public.knit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS knit_events_kind_created_idx
  ON public.knit_events (kind, created_at DESC);

ALTER TABLE public.knit_events ENABLE ROW LEVEL SECURITY;

-- Read: app super admins only (Stake Presidency / Stake Clerk / HC Missionary
-- Work / knit_admin_users.is_super_admin). No INSERT/UPDATE/DELETE policy —
-- the service role bypasses RLS and is the only writer.
DROP POLICY IF EXISTS knit_events_select ON public.knit_events;
CREATE POLICY knit_events_select
  ON public.knit_events
  FOR SELECT
  TO authenticated
  USING (public.knit_is_app_super_admin());

COMMENT ON TABLE public.knit_events IS
  'PII-safe capture of client + server errors (and future named usage events). Service-role write only; app-super-admin read via RLS. No member names/free-text PII — references are UUIDs, route is a sanitized pattern, message/detail are length-capped at the write endpoint.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Insights aggregate
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.knit_admin_insights()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.knit_is_app_super_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),

    -- Per-ward adoption funnel (real users, demo rows excluded)
    'funnel', COALESCE((
      SELECT jsonb_agg(row_to_json(f) ORDER BY f.roster DESC)
      FROM (
        SELECT
          w.name AS ward_name,
          count(DISTINCT mem.id) FILTER (WHERE NOT COALESCE(mem.is_demo, false)) AS roster,
          count(DISTINCT mem.id) FILTER (WHERE NOT COALESCE(mem.is_demo, false) AND mem.token_issued_at IS NOT NULL) AS invited,
          count(DISTINCT mem.id) FILTER (WHERE NOT COALESCE(mem.is_demo, false) AND mem.onboarding_completed_at IS NOT NULL) AS onboarded,
          count(DISTINCT mi.member_id) FILTER (WHERE NOT COALESCE(mem.is_demo, false)) AS with_interests,
          count(DISTINCT mab.member_id) FILTER (WHERE NOT COALESCE(mem.is_demo, false)) AS with_availability,
          count(DISTINCT mem.id) FILTER (WHERE NOT COALESCE(mem.is_demo, false) AND mem.opted_out_at IS NOT NULL) AS opted_out,
          count(DISTINCT mem.id) FILTER (WHERE NOT COALESCE(mem.is_demo, false) AND mem.paused_until IS NOT NULL AND mem.paused_until >= current_date) AS paused
        FROM public.knit_wards w
        LEFT JOIN public.knit_members mem ON mem.ward_id = w.id
        LEFT JOIN public.knit_member_interests mi ON mi.member_id = mem.id
        LEFT JOIN public.knit_availability_baselines mab ON mab.member_id = mem.id
        WHERE w.active
        GROUP BY w.name
        HAVING count(DISTINCT mem.id) FILTER (WHERE NOT COALESCE(mem.is_demo, false)) > 0
      ) f
    ), '[]'::jsonb),

    -- What members like: most-picked interest tags (real members only)
    'top_interests', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.members DESC, t.name_en)
      FROM (
        SELECT it.name_en, it.name_es, count(DISTINCT mi.member_id) AS members
        FROM public.knit_member_interests mi
        JOIN public.knit_interest_tags it ON it.id = mi.interest_tag_id
        JOIN public.knit_members mem ON mem.id = mi.member_id
        WHERE NOT COALESCE(mem.is_demo, false)
        GROUP BY it.name_en, it.name_es
        ORDER BY count(DISTINCT mi.member_id) DESC, it.name_en
        LIMIT 20
      ) t
    ), '[]'::jsonb),

    -- How members are willing to help: participation styles
    'top_styles', COALESCE((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.members DESC, s.label_en)
      FROM (
        SELECT ps.label_en, ps.label_es, count(DISTINCT mps.member_id) AS members
        FROM public.knit_member_participation_styles mps
        JOIN public.knit_participation_styles ps ON ps.key = mps.style_key
        JOIN public.knit_members mem ON mem.id = mps.member_id
        WHERE NOT COALESCE(mem.is_demo, false)
        GROUP BY ps.label_en, ps.label_es
      ) s
    ), '[]'::jsonb),

    -- When members are free: distinct-member counts per day_of_week + slot
    'availability', COALESCE((
      SELECT jsonb_agg(row_to_json(a) ORDER BY a.day_of_week, a.time_slot)
      FROM (
        SELECT mab.day_of_week, mab.time_slot::text AS time_slot, count(DISTINCT mab.member_id) AS members
        FROM public.knit_availability_baselines mab
        JOIN public.knit_members mem ON mem.id = mab.member_id
        WHERE NOT COALESCE(mem.is_demo, false)
        GROUP BY mab.day_of_week, mab.time_slot
      ) a
    ), '[]'::jsonb),

    -- In-app feedback inbox (the suggestion button). Status counts + recent
    -- text. NO submitter name/email returned — text + status + date only.
    'feedback', jsonb_build_object(
      'by_status', COALESCE((
        SELECT jsonb_object_agg(status, n)
        FROM (
          SELECT COALESCE(status, 'open') AS status, count(*) AS n
          FROM public.app_suggestions
          WHERE app ILIKE 'knit'
          GROUP BY COALESCE(status, 'open')
        ) g
      ), '{}'::jsonb),
      'recent', COALESCE((
        SELECT jsonb_agg(row_to_json(r))
        FROM (
          SELECT left(suggestion, 280) AS suggestion,
                 COALESCE(status, 'open') AS status,
                 created_at
          FROM public.app_suggestions
          WHERE app ILIKE 'knit'
          ORDER BY created_at DESC
          LIMIT 10
        ) r
      ), '[]'::jsonb)
    ),

    -- Operational health: where the issues are (or aren't)
    'health', jsonb_build_object(
      'sheets', COALESCE((
        SELECT jsonb_agg(row_to_json(sh) ORDER BY sh.ward_name)
        FROM (
          SELECT w.name AS ward_name,
                 b.status::text AS status,
                 b.last_error,
                 b.last_pull_at,
                 b.last_push_at
          FROM public.knit_google_sheet_bindings b
          JOIN public.knit_wards w ON w.id = b.ward_id
        ) sh
      ), '[]'::jsonb),
      'sms_30d', COALESCE((
        SELECT jsonb_object_agg(type, n)
        FROM (
          SELECT type::text AS type, count(*) AS n
          FROM public.knit_notifications_log
          WHERE sent_at >= now() - interval '30 days'
          GROUP BY type
        ) g
      ), '{}'::jsonb),
      'sms_replies_30d', (
        SELECT count(*) FROM public.knit_notifications_log
        WHERE response IS NOT NULL AND sent_at >= now() - interval '30 days'
      ),
      'invitations', COALESCE((
        SELECT jsonb_object_agg(outcome, n)
        FROM (
          SELECT outcome, count(*) AS n
          FROM public.knit_member_invitations
          GROUP BY outcome
        ) g
      ), '{}'::jsonb),
      'errors_7d_total', (
        SELECT count(*) FROM public.knit_events
        WHERE kind = 'error' AND created_at >= now() - interval '7 days'
      ),
      'errors_7d_by_name', COALESCE((
        SELECT jsonb_object_agg(name, n)
        FROM (
          SELECT name, count(*) AS n
          FROM public.knit_events
          WHERE kind = 'error' AND created_at >= now() - interval '7 days'
          GROUP BY name
        ) g
      ), '{}'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.knit_admin_insights() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.knit_admin_insights() TO authenticated;

COMMENT ON FUNCTION public.knit_admin_insights() IS
  'Super-admin-only JSON aggregate for /admin/insights: per-ward funnel, top interests/styles, availability heatmap, feedback inbox, and operational health. Raises 42501 for non-super-admins.';

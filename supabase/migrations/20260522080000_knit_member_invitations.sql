-- 20260522080000_knit_member_invitations.sql
-- Audit log + history of every invitation a member receives.
-- Written from two paths:
--   1) /api/admin/invitations endpoint (source='admin_app')
--   2) The Members to Invite missionary-sheet sweep (source='missionary_sheet')
-- RLS lets ward super admins see their own ward and app super admins
-- (stake president, stake clerk, hc_missionary_work, knit_admin_users
-- is_super_admin) see everything in their stake. Inserts are service-role
-- only — server endpoints write; the client reads via RLS.

CREATE TABLE IF NOT EXISTS public.knit_member_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.knit_members(id) ON DELETE CASCADE,
  ward_id uuid NOT NULL REFERENCES public.knit_wards(id) ON DELETE CASCADE,
  sent_by_admin_id uuid REFERENCES public.knit_admin_users(id) ON DELETE SET NULL,
  sent_by_label text,
  source text NOT NULL CHECK (source IN ('admin_app', 'missionary_sheet')),
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('sent', 'failed')),
  outcome_detail text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knit_member_invitations_ward_created_idx
  ON public.knit_member_invitations (ward_id, created_at DESC);

CREATE INDEX IF NOT EXISTS knit_member_invitations_member_created_idx
  ON public.knit_member_invitations (member_id, created_at DESC);

ALTER TABLE public.knit_member_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY knit_member_invitations_select
  ON public.knit_member_invitations
  FOR SELECT
  TO authenticated
  USING (
    public.knit_is_app_super_admin()
    OR public.knit_is_ward_super_admin(ward_id)
    OR EXISTS (
      SELECT 1 FROM public.knit_admin_users a
      WHERE a.id = auth.uid()
        AND (
          a.ward_id = knit_member_invitations.ward_id
          OR a.stake_id = (
            SELECT w.stake_id FROM public.knit_wards w WHERE w.id = knit_member_invitations.ward_id
          )
        )
    )
  );

COMMENT ON TABLE public.knit_member_invitations IS
  'Audit log of every member invitation send attempt. Written by server endpoints with the service role; readable by admins per RLS.';

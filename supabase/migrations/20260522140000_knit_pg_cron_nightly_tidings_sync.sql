-- 20260522140000_knit_pg_cron_nightly_tidings_sync.sql
-- Nightly Supabase pg_cron job that triggers the Tidings → Knit member
-- directory sync via the existing knit-sync-tidings-members edge function.
-- Keeps knit_members in step with Tidings contacts (new members, name
-- changes, opt-outs) without anyone having to click "Sync from Tidings"
-- at /admin/roles.
--
-- Prereq: vault.secrets row 'knit_internal_sync_secret' whose decrypted
-- value matches the INTERNAL_SYNC_SECRET edge-function secret. Created
-- out-of-band via vault.create_secret().

CREATE OR REPLACE FUNCTION public.knit_cron_sync_tidings_members()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions
AS $fn$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'knit_internal_sync_secret';

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Missing vault secret knit_internal_sync_secret';
  END IF;

  SELECT net.http_post(
    url := 'https://isogetmvnpimcmouakeg.supabase.co/functions/v1/knit-sync-tidings-members',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.knit_cron_sync_tidings_members() FROM public, anon, authenticated;

SELECT cron.schedule(
  'knit-nightly-tidings-sync',
  '0 7 * * *',
  $$ SELECT public.knit_cron_sync_tidings_members(); $$
);

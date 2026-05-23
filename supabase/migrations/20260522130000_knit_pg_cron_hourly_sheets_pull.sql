-- 20260522130000_knit_pg_cron_hourly_sheets_pull.sql
-- Hourly Supabase pg_cron job that hits Knit's Vercel sheets-pull endpoint.
-- Bypasses Vercel Hobby's "daily-only" cron cap. The bearer token is read
-- from supabase_vault at execution time so it stays out of pg_cron.job's
-- visible command and out of source control.
--
-- Prereq: a row in vault.secrets named 'knit_vercel_cron_secret' whose
-- decrypted value equals the CRON_SECRET env var on Vercel. Created
-- out-of-band in this session via vault.create_secret().

CREATE OR REPLACE FUNCTION public.knit_cron_call_sheets_pull()
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
  WHERE name = 'knit_vercel_cron_secret';

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Missing vault secret knit_vercel_cron_secret';
  END IF;

  SELECT net.http_post(
    url := 'https://knit-together.vercel.app/api/cron/sheets-pull',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.knit_cron_call_sheets_pull() FROM public, anon, authenticated;

SELECT cron.schedule(
  'knit-hourly-sheets-pull',
  '7 * * * *',
  $$ SELECT public.knit_cron_call_sheets_pull(); $$
);

-- 20260531150000_knit_sheets_pull_5min.sql
-- Speed up the missionary feedback loop on the Suggestions / Log an Outing
-- tabs. Previous schedule was hourly at :07 UTC — a missionary clicking
-- Generate could wait up to ~60 minutes for the ranked-members rows to
-- populate. New schedule is every 5 minutes, 24/7.
--
-- Cost: 12x the daily pulls (288 vs 24). Each run iterates all healthy
-- bindings (~9 wards) and is cheap — mostly empty Sheet reads. Drive read
-- quotas have plenty of headroom and the existing retryOn429 wrapper
-- absorbs transient bursts.

SELECT cron.unschedule('knit-hourly-sheets-pull');

SELECT cron.schedule(
  'knit-sheets-pull-5min',
  '*/5 * * * *',
  $$ SELECT public.knit_cron_call_sheets_pull(); $$
);

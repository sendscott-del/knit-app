-- Adds last_roster_refresh_at to knit_google_sheet_bindings.
--
-- The 5-minute sheets-pull cron used to refresh the hidden Member Roster on
-- every run for every binding — a full roster SELECT per pull that was the
-- single largest query by database time on the shared instance, almost all of
-- it wasted (the roster only changes on the nightly Tidings sync or an
-- occasional opt-out). The cron now throttles the roster refresh to ~hourly
-- per binding using this timestamp. Nullable: a null value means "never
-- refreshed on the new path", which reads as due, so existing bindings refresh
-- once on the next pull and then settle into the hourly cadence.
alter table public.knit_google_sheet_bindings
  add column if not exists last_roster_refresh_at timestamptz;

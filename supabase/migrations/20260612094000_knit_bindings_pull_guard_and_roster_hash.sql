-- Overlap guard + change detection for the sheets sync.
-- last_pull_started_at: a pull claims a binding by setting this; runs that
-- find a fresh claim (< 4 min old) skip the binding instead of racing the
-- in-flight pull (duplicate outing/friend inserts).
-- roster_hash: sha256 of the last roster written to the hidden Member Roster
-- tab; lets the 5-minute pull skip the unconditional rewrite (was ~8,600
-- Sheets writes/day at idle across 10 bindings).
ALTER TABLE public.knit_google_sheet_bindings
  ADD COLUMN IF NOT EXISTS last_pull_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS roster_hash text;

-- Backstop against duplicate sheet-logged outings (stamp-back failure or
-- concurrent pulls). NULLS NOT DISTINCT so member-less outings dedupe too.
CREATE UNIQUE INDEX IF NOT EXISTS knit_outings_sheet_dedupe_idx
  ON public.knit_outings (ward_id, friend_id, member_id, scheduled_at)
  NULLS NOT DISTINCT
  WHERE logged_by = 'missionary_sheet';

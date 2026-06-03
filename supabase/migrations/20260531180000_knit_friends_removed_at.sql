-- 20260531180000_knit_friends_removed_at.sql
-- Soft-delete column for knit_friends. Missionaries can now mark a friend
-- "Remove?" on the Google Sheet → pullFriendRemovals stamps removed_at and
-- appends the supplied reason to notes. The push side filters
-- `removed_at IS NULL`, so removed friends disappear from the sheet on the
-- next sync without losing the historical link from past knit_outings.

ALTER TABLE knit_friends
  ADD COLUMN IF NOT EXISTS removed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS removed_reason text NULL;

CREATE INDEX IF NOT EXISTS knit_friends_ward_active_idx
  ON knit_friends (ward_id)
  WHERE removed_at IS NULL;

COMMENT ON COLUMN knit_friends.removed_at IS
  'Soft delete: set when a missionary checks Remove? on the Friends We are Teaching tab, or a WML clicks Remove in the admin app. NULL = active.';
COMMENT ON COLUMN knit_friends.removed_reason IS
  'Optional reason captured at removal time. Free-form string entered by the missionary in the Reason column.';

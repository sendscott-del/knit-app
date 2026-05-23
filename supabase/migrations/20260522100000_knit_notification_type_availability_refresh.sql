-- Adds 'availability_refresh' to the knit_notification_type enum so the new
-- 90-day refresh cron logs against its own type. 'weekly_nudge' from the
-- original spec is preserved in case we ever bring back a weekly cadence.

ALTER TYPE public.knit_notification_type ADD VALUE IF NOT EXISTS 'availability_refresh';

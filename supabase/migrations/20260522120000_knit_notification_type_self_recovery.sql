-- Add 'self_recovery' to knit_notification_type so the /api/me/recover
-- endpoint logs its own audit type. Self-service link recovery (member
-- typing their name+phone into /join) is semantically distinct from a
-- leader-initiated invite (knit_member_invitations) or a 90-day refresh
-- (knit_notifications_log type='availability_refresh').

ALTER TYPE public.knit_notification_type ADD VALUE IF NOT EXISTS 'self_recovery';

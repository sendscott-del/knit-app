-- Adds Baseball + Ultimate frisbee to the global sports tag library so
-- they appear as chips on the member onboarding survey. "Ultimate frisbee"
-- (rather than just "Ultimate") because non-players see the chip and the
-- longer form removes ambiguity.

INSERT INTO public.knit_interest_tags (ward_id, name_en, category, active)
VALUES
  (NULL, 'Baseball',         'sport', true),
  (NULL, 'Ultimate frisbee', 'sport', true)
ON CONFLICT DO NOTHING;

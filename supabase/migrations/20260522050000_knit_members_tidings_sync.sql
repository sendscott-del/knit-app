-- 20260522050000_knit_members_tidings_sync.sql
-- Knit side of the Tidings directory sync. knit_members already has
-- tidings_member_id, first_name, last_name, phone — extending with
-- email, callings, and sync metadata. Ward mapping seeded.
--
-- The companion piece on Tidings is gather_tidings_contacts_for_sync()
-- (deployed in v0.25.3). Edge function: knit-sync-tidings-members.

ALTER TABLE public.knit_members
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS callings text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_source text;

CREATE UNIQUE INDEX IF NOT EXISTS knit_members_tidings_member_id_idx
  ON public.knit_members(tidings_member_id)
  WHERE tidings_member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS knit_members_callings_idx
  ON public.knit_members USING gin (callings);

ALTER TABLE public.knit_wards
  ADD COLUMN IF NOT EXISTS tidings_unit_name text;

CREATE UNIQUE INDEX IF NOT EXISTS knit_wards_tidings_unit_name_idx
  ON public.knit_wards(tidings_unit_name)
  WHERE tidings_unit_name IS NOT NULL;

UPDATE public.knit_wards SET tidings_unit_name = 'Hyde Park 1st Ward'             WHERE lower(name) LIKE '%hyde park 1%';
UPDATE public.knit_wards SET tidings_unit_name = 'Hyde Park 2nd Ward'             WHERE lower(name) LIKE '%hyde park 2%';
UPDATE public.knit_wards SET tidings_unit_name = 'Hyde Park 3rd Ward (Spanish)'   WHERE lower(name) LIKE '%hyde park 3%';
UPDATE public.knit_wards SET tidings_unit_name = 'Moraine Valley Ward'            WHERE lower(name) LIKE '%moraine valley%';
UPDATE public.knit_wards SET tidings_unit_name = 'Westchester 1st Ward'           WHERE lower(name) LIKE '%westchester 1%';
UPDATE public.knit_wards SET tidings_unit_name = 'Westchester 2nd Ward (Spanish)' WHERE lower(name) LIKE '%westchester 2%';
UPDATE public.knit_wards SET tidings_unit_name = 'Blue Island Ward (Spanish)'     WHERE lower(name) LIKE '%blue island%';
UPDATE public.knit_wards SET tidings_unit_name = 'Midway Ward (Spanish)'          WHERE lower(name) LIKE '%midway%';
UPDATE public.knit_wards SET tidings_unit_name = 'Chicago 2nd Ward (Spanish)'     WHERE lower(name) LIKE '%chicago 2%';

CREATE OR REPLACE FUNCTION public.knit_apply_tidings_member_sync(p_contacts jsonb)
  RETURNS TABLE(inserted int, updated int, skipped int, missing_ward int)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  c jsonb;
  v_ward_id uuid;
  v_existing_id uuid;
  v_full_name text;
  v_unit text;
  v_first text;
  v_last text;
  v_parts text[];
  v_inserted int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_missing int := 0;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    v_full_name := trim(c->>'full_name');
    v_unit := c->>'unit_name';

    IF v_full_name IS NULL OR v_full_name = '' THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;
    IF coalesce((c->>'opted_out')::boolean, false) THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    v_parts := regexp_split_to_array(v_full_name, '\s+');
    IF array_length(v_parts, 1) > 1 THEN
      v_last := v_parts[array_length(v_parts, 1)];
      v_first := array_to_string(v_parts[1:array_length(v_parts, 1) - 1], ' ');
    ELSE
      v_last := '';
      v_first := v_full_name;
    END IF;

    SELECT id INTO v_ward_id
    FROM public.knit_wards
    WHERE tidings_unit_name = v_unit OR name = v_unit
    LIMIT 1;

    IF v_ward_id IS NULL THEN
      v_missing := v_missing + 1; CONTINUE;
    END IF;

    SELECT id INTO v_existing_id
    FROM public.knit_members
    WHERE tidings_member_id = (c->>'id')::uuid;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.knit_members(
        ward_id, tidings_member_id,
        first_name, last_name, phone, email,
        callings, synced_at, sync_source
      )
      VALUES (
        v_ward_id, (c->>'id')::uuid,
        v_first, v_last, c->>'phone', c->>'email',
        COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(c->'callings')), '{}'::text[]),
        now(), 'tidings'
      );
      v_inserted := v_inserted + 1;
    ELSE
      UPDATE public.knit_members SET
        ward_id     = v_ward_id,
        first_name  = v_first,
        last_name   = v_last,
        phone       = COALESCE(c->>'phone', phone),
        email       = COALESCE(c->>'email', email),
        callings    = COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(c->'callings')), '{}'::text[]),
        synced_at   = now(),
        sync_source = 'tidings',
        updated_at  = now()
      WHERE id = v_existing_id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_updated, v_skipped, v_missing;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.knit_apply_tidings_member_sync(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knit_apply_tidings_member_sync(jsonb) TO service_role;

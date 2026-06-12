-- Make opt-out two-way safe.
--
-- Problem: a Tidings opt-out set knit_members.opted_out_at, but opting back
-- in over in Tidings never cleared it — and /api/me/recover excluded
-- opted-out members, so after their magic link expired (30 days) they were
-- stuck until an admin noticed.
--
-- Fix: track WHO set the opt-out (opted_out_source: 'tidings' | 'self').
-- The Tidings sync may only clear an opt-out it set itself — a member who
-- opted out *in Knit* stays opted out regardless of their Tidings state
-- (separate consent decisions). Existing opted-out rows keep source NULL:
-- the sync won't auto-clear them (no worse than today; an admin or the
-- member's own rejoin button handles those).

ALTER TABLE public.knit_members
  ADD COLUMN IF NOT EXISTS opted_out_source text
  CHECK (opted_out_source IN ('tidings', 'self'));

-- Self opt-out: stamp source 'self'; rejoin clears both.
CREATE OR REPLACE FUNCTION public.knit_member_self_opt_out(
  p_member_id uuid,
  p_token text,
  p_opt_out boolean DEFAULT true
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = 'public', 'extensions'
AS $fn$
BEGIN
  IF NOT public.knit_member_token_is_valid(p_member_id, p_token) THEN
    RAISE EXCEPTION 'Invalid or expired link' USING errcode = '28000';
  END IF;
  UPDATE public.knit_members
  SET opted_out_at     = CASE WHEN p_opt_out THEN now() ELSE NULL END,
      opted_out_source = CASE WHEN p_opt_out THEN 'self' ELSE NULL END,
      updated_at       = now()
  WHERE id = p_member_id;
END;
$fn$;

-- Tidings sync: stamp source 'tidings' on opt-out; on a non-opted-out
-- contact, clear an opt-out only when the sync itself set it.
CREATE OR REPLACE FUNCTION public.knit_apply_tidings_member_sync(p_contacts jsonb)
  RETURNS TABLE(inserted integer, updated integer, skipped integer, missing_ward integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c jsonb;
  v_ward_id uuid;
  v_existing_id uuid;
  v_full_name text;
  v_unit text;
  v_first text;
  v_last text;
  v_parts text[];
  v_opted_out boolean;
  v_inserted int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_missing int := 0;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    v_full_name := trim(c->>'full_name');
    v_unit := c->>'unit_name';
    v_opted_out := coalesce((c->>'opted_out')::boolean, false);

    IF v_full_name IS NULL OR v_full_name = '' THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    IF v_opted_out THEN
      UPDATE public.knit_members
      SET opted_out_at = now(), opted_out_source = 'tidings', updated_at = now()
      WHERE tidings_member_id = (c->>'id')::uuid
        AND opted_out_at IS NULL;
      v_skipped := v_skipped + 1;
      CONTINUE;
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
        -- Tidings says this contact is opted in: clear an opt-out the sync
        -- itself set. Never touch a self opt-out.
        opted_out_at     = CASE WHEN opted_out_source = 'tidings' THEN NULL ELSE opted_out_at END,
        opted_out_source = CASE WHEN opted_out_source = 'tidings' THEN NULL ELSE opted_out_source END,
        synced_at   = now(),
        sync_source = 'tidings',
        updated_at  = now()
      WHERE id = v_existing_id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_updated, v_skipped, v_missing;
END;
$function$;

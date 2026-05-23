-- Propagate Tidings opt-outs into Knit. Previously the apply RPC skipped any
-- contact with opted_out=true, leaving the matching knit_members row's
-- opted_out_at as null. Result: someone opted out in Tidings still appeared
-- active in Knit. Now we mark the existing Knit row opted out (idempotent —
-- only when opted_out_at is currently null) and then skip further work.

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
      SET opted_out_at = now(), updated_at = now()
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

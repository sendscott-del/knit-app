-- 20260522070000_knit_member_self_opt_out_rpc.sql
-- Member-self opt-out RPC, mirroring knit_member_self_pause. Lets a ward
-- member toggle opted_out_at from their magic-link page without admin
-- intervention. Per the Gathered User Access spreadsheet: "on the ward
-- member availability survey allow a ward member to opt out, which means
-- they no longer want to participate in Knit."
--
-- Reversible by design: passing p_opt_out=false clears opted_out_at, so
-- the same person can rejoin from the same link (still valid for 30 days).

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
  SET opted_out_at = CASE WHEN p_opt_out THEN now() ELSE NULL END,
      updated_at   = now()
  WHERE id = p_member_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.knit_member_self_opt_out(uuid, text, boolean) TO anon, authenticated;

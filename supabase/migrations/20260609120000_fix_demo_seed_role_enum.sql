-- Fix the "Load demo data" admin action (AdminDemo.tsx -> knit_load_demo_data RPC),
-- which was broken in production for every caller.
--
-- knit_load_demo_data() and knit_clear_demo_data() compared the caller's role
-- against enum literals 'stake_president' and 'stake_missionary_hc', neither of
-- which is a member of the knit_admin_role enum (valid values: stake_presidency,
-- high_councilor, ward_mission_leader, relief_society_presidency,
-- elders_quorum_presidency). Postgres tried to coerce the invalid literals to the
-- enum and raised: invalid input value for enum knit_admin_role: "stake_president".
-- The IF that contains the predicate is evaluated for every caller, so the demo
-- loader/cleaner threw 100% of the time.
--
-- This rewrites ONLY that predicate to the valid stake-level roles, preserving the
-- rest of each function byte-for-byte by reading the live definition with
-- pg_get_functiondef() and doing a targeted text replace. A guard aborts if the
-- expected predicate is not present (e.g. if the function is later edited).

do $$
declare
  v_src text;
  v_new text;
  v_fn text;
begin
  foreach v_fn in array array[
    'public.knit_load_demo_data(uuid)',
    'public.knit_clear_demo_data(uuid)'
  ] loop
    v_src := pg_get_functiondef(v_fn::regprocedure);
    v_new := replace(
      v_src,
      '''stake_president'',''stake_missionary_hc''',
      '''stake_presidency'',''high_councilor'''
    );
    if v_new = v_src then
      raise exception 'Expected predicate not found in % — aborting', v_fn;
    end if;
    execute v_new;
  end loop;
end $$;

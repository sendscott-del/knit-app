// knit-sync-tidings-members
// Pulls the Tidings contacts directory into knit_members. Called manually by
// the "Sync from Tidings" button on /admin/roles, or on a weekly schedule by
// pg_cron once that's wired.
//
// Mirrors glean-sync-tidings-members in structure. The apply RPC is different
// (knit_apply_tidings_member_sync) because Knit's member schema uses
// first_name/last_name and the ward-name mapping is on knit_wards.
//
// Env vars on the shared (Scott's Apps) project:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  - already set
//   TIDINGS_SUPABASE_URL                     - defaults to jdlykebsqafcngpntxma
//   TIDINGS_SUPABASE_SERVICE_ROLE_KEY        - set out-of-band (already there
//                                              for glean-sync; same secret
//                                              works for both)
//   INTERNAL_SYNC_SECRET                     - optional, for pg_cron callers

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TIDINGS_URL =
  Deno.env.get("TIDINGS_SUPABASE_URL") ?? "https://jdlykebsqafcngpntxma.supabase.co";
const TIDINGS_SERVICE_KEY = Deno.env.get("TIDINGS_SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SYNC_SECRET = Deno.env.get("INTERNAL_SYNC_SECRET") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Constant-time secret check: compare SHA-256 digests instead of the raw
// strings — a direct === short-circuits on the first differing byte, which
// leaks prefix-match timing. Digest bytes are unpredictable, so even a
// non-constant-time compare of digests reveals nothing about the secret.
async function secretMatches(provided: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

interface TidingsContact {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  unit_name: string | null;
  callings: string[];
  opted_out: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (!TIDINGS_SERVICE_KEY) {
    return new Response(
      JSON.stringify({ error: "TIDINGS_SUPABASE_SERVICE_ROLE_KEY not set on this project" }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  let authorized = false;

  if (
    INTERNAL_SYNC_SECRET &&
    auth.startsWith("Bearer ") &&
    (await secretMatches(auth.slice("Bearer ".length), INTERNAL_SYNC_SECRET))
  ) {
    authorized = true;
  } else if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    const shared = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await shared.auth.getUser(token);
    if (userData?.user) {
      const { data: sa } = await shared
        .from("gather_super_admins")
        .select("user_id")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      authorized = !!sa;
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Tidings RPC returns a single JSONB array (sidesteps PostgREST's 1000-row cap).
  const contactsRes = await fetch(
    `${TIDINGS_URL}/rest/v1/rpc/gather_tidings_contacts_for_sync`,
    {
      method: "POST",
      headers: {
        apikey: TIDINGS_SERVICE_KEY,
        Authorization: `Bearer ${TIDINGS_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  );
  if (!contactsRes.ok) {
    const text = await contactsRes.text();
    return new Response(JSON.stringify({ error: `tidings fetch failed (${contactsRes.status}): ${text}` }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  const contacts: TidingsContact[] = await contactsRes.json();

  const shared = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: applyRes, error: applyErr } = await shared.rpc(
    "knit_apply_tidings_member_sync",
    { p_contacts: contacts as unknown as Record<string, unknown> },
  );
  if (applyErr) {
    return new Response(JSON.stringify({ error: `apply failed: ${applyErr.message}` }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const result = Array.isArray(applyRes) ? applyRes[0] : applyRes;
  return new Response(
    JSON.stringify({ ok: true, contact_count: contacts.length, ...result }),
    { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
});

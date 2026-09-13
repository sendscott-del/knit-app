# Session log — Knit

Append-only, newest first. One entry per working session: date, what changed, any infra facts touched.

## 2026-08-22 — v0.55.2: member interest picker fixed (anon RLS)

- **Bug (reported by Scott from a live weekly-check-in SMS):** on the member dashboard, tapping Edit on "What you love" showed "Loading options…" and then an empty box with only Save and Cancel. Availability and "How you like to help" worked.
- **Root cause:** `knit_interest_tags`' only SELECT policy is `to authenticated` (migration `20260612091000`). Members use a no-login signed token, so `InterestChipPicker`'s direct table read ran as `anon`, and RLS returned zero rows *with no error* — the component rendered nothing. `knit_participation_styles` has an `{authenticated, anon}` read policy, which is why styles kept working.
- **Blast radius:** confirmed in the DB — 90 `knit_member_interests` rows, all before 2026-06-09, zero since. Members could not set or change interests for ~10 weeks, and the interests step of new-member onboarding was equally dead. Matching quality degrades with stale interest data.
- **Fix:** new `knit_member_self_list_interest_tags(p_member_id, p_token)` — SECURITY DEFINER, checks `knit_member_token_is_valid`, returns active global tags + the member's ward tags, EXECUTE granted to `anon`. Same pattern as the other `knit_member_self_*` RPCs. Table RLS unchanged (not widened to anon). Migration `supabase/migrations/20260822120000_knit_member_self_list_interest_tags.sql`, applied to shared project `isogetmvnpimcmouakeg`.
- `InterestChipPicker` takes an optional `memberAuth` and uses the RPC when present; admin pages (AdminMembers, AdminFriends) keep the direct authenticated read. Wired into MemberDashboard + MemberOnboarding. The picker now shows a message when it has zero options instead of rendering an empty box — this bug was invisible precisely because it rendered nothing. New i18n key `interest_picker.none_available` (EN/ES).
- **Verified:** migration applied; anon call through PostgREST with the live anon key returns `28000 Invalid or expired link` (function reachable by anon, token gate works — a valid token returns rows, SECURITY DEFINER bypasses RLS); `tsc --noEmit` and `npm run build` clean. Deployed bundle on knit.gatheredin.app confirmed to carry the RPC call (v0.55.2). Scott verified end-to-end from his live SMS link on 2026-08-22 — chips load and are editable.
- **Housekeeping:** committed the delivery-surfaces table left uncommitted in CLAUDE.md last session; deleted the empty stray `docs/SESSIONS.md.tmp`. Added a CLAUDE.md gotcha: member-facing reads must go through token-checked `knit_member_self_*` RPCs, never direct table reads, because members are `anon`.
- Left at v0.55.2, pushed to `main`; Vercel deploys all surfaces (web, PWA, Capacitor shells load the live site).

## 2026-08-02 — v0.55.1: safe-area spacer when the Gathered suite bar is hidden

- Suite-wide follow-up to the status-bar overlap Scott reported in Magnify/Conduct: when AppSwitcher had nothing to show (single-app users), it rendered nothing and the next element sat under the iPhone status bar / Dynamic Island.
- Fix: `src/components/AppSwitcher.tsx` — the empty case now returns a chrome-colored spacer padded by `env(safe-area-inset-top)` (zero-height where there is no inset). Same change shipped across Steward/Glean/Knit/Tidings/Conduct/Liken this session.
- Pushed to main (`24a5371`); Vercel deploys.

## 2026-08-02 — v0.55.0: idle sheet-pull does zero DB writes (Disk IO fix)

- **Why:** Supabase flagged the shared project (`isogetmvnpimcmouakeg`) "running out of Disk IO Budget" (email 2026-07-22). Diagnosed from `pg_stat_statements`: Knit's 5-minute `sheets-pull` cron was the dominant write-IO source on the *whole shared instance*. Ranked by WAL bytes: the per-binding **claim UPDATE** (`last_pull_started_at`) = 31.3% of all instance WAL, the **finalize UPDATE** = 14.8% — together ~46% — fired for all 10 bindings every 5 minutes *regardless of activity*. The roster preload SELECT was also the #1 query by DB time (54%), but cached (little disk), so it was secondary for Disk IO. (pg_cron's own `job_run_details` logging was the other ~30% of WAL, dominated by the every-minute Duty cron — separate lane, flagged to Scott, not touched here.)
- **Fix (all in `api/`, no schema-breaking change):**
  - `api/cron/sheets-pull.ts`: each binding is now **peeked** first — `peekSheet()` fetches the tabs from Google (no DB) and checks for a pending Suggestion/Outing/Add-Friend/Remove/Feedback row. Idle wards skip the claim + finalize entirely (zero DB writes); they only get a throttled `last_pull_at` heartbeat every ~30 min. Claim is now taken only when there's work — still the atomic test-and-set guard for the case it protects (two runs seeing the same pending row).
  - `api/_lib/sheetPull.ts`: added `hasPendingWork()` + `peekSheet()`; `pullSheet()` gained optional `prefetch` (reuses the peek's fetch so the sheet is read once) and `refreshRoster` (default true → admin "Sync now" + morning-push unchanged). The cron passes `refreshRoster` only on its hourly cadence, so the roster SELECT stops running every pull.
- **Infra fact touched:** added nullable column `knit_google_sheet_bindings.last_roster_refresh_at` (migration `20260802120000_knit_bindings_roster_refresh_at.sql`, applied to the shared project via Supabase MCP). Throttles the hourly roster refresh; null reads as "due" so existing bindings refresh once then settle.
- **Verify:** `npm run build` green (src); targeted `tsc --noEmit` on the two changed api files clean. Behavior unchanged for missionaries (requests still picked up on the next 5-min pull). Watch `pg_stat_statements` after deploy — the claim/finalize UPDATE call-rate should fall to near-zero on quiet wards.
- Deployed by pushing to `main` (Vercel auto-builds). Left at v0.55.0.

## 2026-07-19 — v0.54.1: centered admin content column on desktop

- Admin shell content stretched nearly edge-to-edge at >=1024px viewports (the `max-w-5xl` cap barely bit inside the 1056px main column at 1280px). Added `lg:max-w-3xl` to the content container in `src/pages/AdminLayout.tsx` — content is now a centered 48rem column on lg+; nothing changes below 1024px. Suite bar, top bar, sidebar, and mobile tab bar remain full width. Public member pages (/join, /m/...) untouched (they don't use AdminLayout).
- Housekeeping: `package.json` was still 0.53.0 while the changelog's top entry was 0.54.0 (the install-page commit missed its bump) — caught it up by shipping this as 0.54.1.
- tsc + build clean; pushed to main (`2c659a5`), Vercel deploys automatically. No infra facts changed.

## 2026-07-15 — Doc system initialized (history reconstructed from git)

- v0.53.0 current: "Try the demo" button on sign-in — one-tap isolated demo ward, fake data only (`07403da`); `/install.html` PWA install page added (`4f6b942`).
- v0.52.x: batched sheet reads — one `values.batchGet` per ward per pull, was ~11 (`6756234`); security + reliability release from a full code review (`55e7f5b`).
- v0.49–0.51: unified user-access UX with the Gather-centric model, Conduct + Liken added to the Gathered app switcher, deep-rose chrome re-skin, iOS safe-area fix; Capacitor App Store wrapper consolidated onto `main`.
- v0.47–0.48: `/admin/insights` monitoring dashboard backed by new `knit_events` table; fixed the broken Load-demo-data action (invalid role enum); dependency security bumps; required Church disclaimer on leader sign-in.
- Migrated to knit.gatheredin.app with api-safe redirects from knit-together.vercel.app (#31); fixed domain-less server-generated invite links from an empty `NEXT_PUBLIC_APP_URL` (#32); fixed super-admin lockout from Users & roles (#33).
- v0.46.x: full i18n pass — every visible string EN/ES; stopped `/admin/users` showing other apps' signups (shared-Supabase cross-app leak); invite-form validation errors.
- v0.44–0.45: missionaries can remove friends from the Google Sheet; Knit invites tagged `app=knit` so they skip Magnify; Drive shares routed through the service account; stopped trusting `shared_emails` when Drive disagrees.
- Long PR-based run (#1–#33) building the Google Sheets missionary workspace: provisioning, morning push + daytime pull crons, suggestions, outing logging.
- Phase 0 (first commits): Vite + React + TS scaffold, then consolidation into the shared "Scott's Apps" Supabase project with the `knit_` prefix (`13558a7`, `9288fd6`).

## 2026-09-13 — App Store unlisted distribution

- Found the app was still PUBLIC on the App Store (App Store Connect > Pricing and Availability). Submitted the unlisted-distribution request form to Apple; awaiting Apple confirm-intent email (reply required).
- No code changes; docs only. Not deployed.

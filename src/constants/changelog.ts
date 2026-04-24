export type ChangelogEntry = {
  version: string
  date: string
  summary: string
  details?: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.12.0',
    date: '2026-04-24',
    summary: 'Phase 2 complete — daily push cron + sheet-pull (Suggestions + Log Outing → DB).',
    details: [
      'Slice C: /api/cron/sheets-morning-push + vercel.json cron (12:00 UTC daily). Iterates all bound sheets and re-populates Available / Friends / Recent Outings from live DB.',
      'Slice D: /api/_lib/sheetPull reads the Suggestions and Log an Outing tabs for pending rows (F/G columns empty). Suggestions: parses friend + day + time + need, runs the suggestion algorithm, writes top-5 members + reasons back into columns F-O, logs an audit row in knit_outing_suggestions. Log Outing: parses date + time + friend + member + status + notes, inserts knit_outings row (logged_by = missionary_sheet), writes ✓ in the Synced column.',
      'Name matching: exact "First Last" / preferred_name / nickname / first_name-only. Skips row and logs error on ambiguous or unfound names.',
      'Day/time/status parsing is forgiving: "Sun", "Sunday", "morning", "morn", "happened", "flaked", "cancelled" all accepted.',
      '/api/admin/sheet/sync-now: admin-triggered per-ward sync (same logic as cron, just for one ward). Exposed via a new "Sync from sheet now" button on the bound-state card.',
      '/api/cron/sheets-pull: same sync across all bindings, gated by CRON_SECRET. Not scheduled on Hobby (sub-daily crons require Pro), but endpoint is ready.',
      'New env vars: CRON_SECRET (auto-generated, set via Vercel CLI).',
      'api/_lib/cronAuth.ts: Bearer verification against CRON_SECRET.',
      'api/_lib/suggestion.ts: server-side copy of the scoring logic, decoupled from Database types.',
    ],
  },
  {
    version: '0.11.0',
    date: '2026-04-24',
    summary: 'Sheet integration: one-click Connect Google + Create — replaces the manual bind flow.',
    details: [
      'New Google OAuth user-consent flow: /api/admin/google/authorize + callback + status + disconnect',
      'Migration 2.04: knit_google_oauth table (one row per stake, service-role-only reads, refresh tokens never leave the server)',
      'New /api/admin/sheet/create: creates the sheet in the connected admin\'s Drive, shares with the service account (for ongoing writes) + missionary gmails, lays out the 7 tabs, populates live data, stores binding — all one click',
      'AdminSheet page rewritten: Connect Google Account card, then a simple "Create sheet" form. The manual bind flow is still available via the /api/admin/sheet/bind endpoint as a fallback.',
      'Architectural note: create-time uses OAuth (sheet goes in user\'s Drive, bypasses SA 0-storage issue); refresh-time uses the service account (no OAuth needed after initial share).',
      'Requires new env vars on Vercel: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI — plus a one-time OAuth consent screen config in GCP.',
    ],
  },
  {
    version: '0.10.0',
    date: '2026-04-24',
    summary: 'Sheet integration: switch from auto-create to bind-existing-sheet (works without Google Workspace).',
    details: [
      'Root cause diagnosed: service accounts in consumer-Gmail GCP projects have 0 bytes of Drive storage since early 2024, so spreadsheets.create returns "The caller does not have permission". Affects every personal-account Knit deployment.',
      'New flow: admin creates the sheet themselves at sheets.new, shares it with the service account as Editor, pastes the URL into /admin/sheet. Knit takes over from there.',
      'New endpoint POST /api/admin/sheet/bind: verifies SA can read the sheet, adds our 7 tabs (idempotent), drops default Sheet1, writes Start Here + headers + live data, stores the binding.',
      'New endpoint GET /api/admin/sheet/info: returns the SA email so the UI can display + copy it.',
      'AdminSheet page rewritten: step-by-step instructions with the SA email prominent and copyable.',
      'Richer Google error formatting (HTTP status + reason + SA email) and a /api/admin/sheet/diagnose endpoint that probed each API call until we found the storage-quota root cause.',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-04-24',
    summary: 'Demo data mode — one-click seed/clear of a realistic ward so you can test without hand-entering everything.',
    details: [
      'Migration 2.02: is_demo boolean on knit_members / knit_friends / knit_outings (plus partial indexes)',
      'Migration 2.03: knit_load_demo_data(ward), knit_clear_demo_data(ward), knit_demo_status(ward) — SECURITY DEFINER with explicit admin scope check',
      'Seed inserts 6 members (2 Spanish speakers, 1 not-yet-onboarded for variety), 3 friends (investigating / progressing / on date), 8 outings across the last 45 days (mostly happened, one flaked, one scheduled)',
      'Load is idempotent: if demo rows exist it returns current counts instead of duplicating',
      'Clear deletes outings → friends → members in order, cascades cleanly',
      '/admin/demo page: status card with counts, Load + Clear buttons, explanation of what is in the dataset',
      'Demo badge pill shown on every demo row in Members / Friends / Outings lists',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-04-24',
    summary: 'Phase 2 Slice A — provision per-ward Google Sheet. Missionaries now have their own workspace.',
    details: [
      'First-ever /api/ serverless functions for this project: provision / refresh / get sheet binding',
      'Google Sheets + Drive via service account (no OAuth consent flow — pure service-to-service)',
      "Creates a spreadsheet, writes 7 tabs (Start Here, Available This Week, Friends We are Teaching, Suggestions, Log an Outing, Urgent Need, Recent Outings), shares with the missionaries' Gmail addresses as Editors",
      'Initial population: Available + Friends + Recent Outings rendered from live DB state',
      '/admin/sheet page with provision form + bound-state view + "Refresh data tabs now" button',
      'Migration 2.01: knit_google_sheet_bindings.shared_emails text[] column',
      'Still to come in Phase 2: cron-based morning push + daytime pull of Suggestions and Log Outing rows',
      'REQUIRES user setup of GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL in Vercel',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-04-23',
    summary: 'Slice G — friend interests picker + /admin/outings log.',
    details: [
      'Add Friend form now has the InterestChipPicker so interest_tag_ids is populated — suggestion algorithm can now score interest overlap',
      '/admin/outings: list of recent outings + inline Log outing form (friend, member, date, slot, status, outcome notes)',
      'Outings feed the suggestion algorithm: freshness (days since last happened), reliability (baseline 3 + happened cap +3), prior-pairing bonus, recent-pairing penalty',
      'scheduled_at composed from date + slot hour (9am / 2pm / 7pm local); scheduled_time_slot stored for display',
      'Status badge with 6 tones (scheduled, happened, flaked, rescheduled, canceled, needs_checkin)',
      'Dashboard card for Outings now links; nav gets an Outings tab',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-04-23',
    summary: 'Slice F — suggestion algorithm and /admin/suggest UI. Pick a friend + day + slot → top 5 ranked members with reasons.',
    details: [
      'Spec §7 scoring implemented in TypeScript (src/lib/suggestion.ts): language, style-match, interest overlap (cap 5), freshness (min(days/14, 5)), reliability (3 baseline + 1 per happened cap +3), prior-success bonus, recent-pairing penalty',
      'Hard filters: paused, opted-out, baseline availability, language compatibility, participation-style match (if need provided)',
      '/admin/suggest page: friend + day + time-slot + optional need → ranked list with per-candidate reasons and score',
      'Empty-state hints: distinct copy for "no one available" vs "fewer than 3" vs all-filtered (expandable list of why each was filtered)',
      'AdminLayout gets a Suggest tab; dashboard card now links',
      'Excludes friends whose teaching_status is baptized or lost_contact from the dropdown',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-04-23',
    summary: 'Slice E — 6-screen member onboarding + inline edits on /me for availability, interests, and participation styles.',
    details: [
      'Migration 1.12: RPCs knit_member_self_save_availability / save_interests / save_styles / complete_onboarding — all bulk-replace semantics, token-validated',
      'Opened anon SELECT on global knit_interest_tags (ward_id null) and knit_participation_styles so the wizard renders without a Supabase session',
      'MemberOnboarding — 6 screens: welcome → what-we-ask → days → interests → styles → confirm. Saves at each Next so progress survives a refresh.',
      '/me branches: not-yet-onboarded members see the wizard; otherwise the dashboard',
      'Dashboard sections now have inline Edit → picker → Save/Cancel for each of availability, interests, styles',
      'Reusable InterestChipPicker (grouped by category) and StylePicker (icon-labelled multi-select buttons)',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-04-23',
    summary: 'Slice D — member magic link end-to-end. Admin can issue a link; member visits it, sees their dashboard, and can pause.',
    details: [
      'Migration 1.11: Postgres RPCs knit_generate_member_magic_link, knit_member_self_read, knit_member_self_pause — token stored as sha256, all crypto server-side, no service role or serverless functions needed',
      'Admin Members tab: "Invite link" / "New link" button on each row → copy-to-clipboard modal with the personal URL',
      '/m/:memberId/:token verifies via RPC, stores {memberId, token} in localStorage, redirects to /me',
      '/me shows name, ward, availability (read-only for now), interest chips, participation styles, and pause buttons (30 / 90 days, unpause)',
      'Sign out clears localStorage and returns to landing',
      'Editing availability + interests + styles from /me and the 6-screen onboarding flow come in the next slice',
    ],
  },
  {
    version: '0.3.1',
    date: '2026-04-23',
    summary: 'Slice C — full names for members + structured day × time-slot availability grid for both members and friends.',
    details: [
      'Migration 1.10: knit_members.first_name + last_name columns',
      'Reusable AvailabilityGrid component (7 days × morning/afternoon/evening cells, 48px touch targets)',
      'Members form: first + last name, phone, language, ward, availability → writes knit_availability_baselines rows',
      'Friends form: availability picker replaces free-text typical_availability field; serializes to readable string like "Tue, Thu evenings; Sat mornings"',
      'Members list now shows an "Available" column with the same readable format',
      'slotsToString() groups days sharing identical slots for compact display',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-04-22',
    summary: 'Phase 1 Slice B — Members + Friends tabs with add/list/remove. Admins can seed a real ward.',
    details: [
      'Added knit_members.phone column for pre-Tidings manual entries (nullable + indexed partial)',
      'Regenerated TypeScript types',
      '/admin/members: list + inline add form (display name, phone, language, ward)',
      '/admin/friends: list + inline add form (name, nickname, phone, language, teaching status, typical availability)',
      'AdminLayout sub-nav with Dashboard / Members / Friends tabs',
      'Dashboard cards for Members and Friends now link to their tabs',
      'Stake-level admins see a ward picker; WML has ward auto-selected',
      'Shared .form-input Tailwind component for consistent form styling',
    ],
  },
  {
    version: '0.2.1',
    date: '2026-04-22',
    summary: 'Phase 1 Slice A — admin auth + router shell. Sign in via Supabase magic link, role-aware dashboard.',
    details: [
      'React Router with routes: / (Landing), /admin/login, /admin/callback, /admin (protected), /m/:id/:token, /me',
      'AuthProvider wraps the app; useAuth + useAdmin hooks',
      'AdminLayout checks knit_admin_users; shows "not yet provisioned" screen for signed-in users without an admin row',
      'Admin dashboard shows role + scope + placeholder tabs for the Phase 1 milestones still to come',
      'vercel.json adds SPA rewrites so deep links (e.g. /admin/login) work on refresh',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-04-22',
    summary: 'Phase 1 database foundation — all 16 knit_ tables, RLS, seeds, TypeScript types.',
    details: [
      'Migration 1.1: knit_stakes, knit_wards, knit_admin_users + knit_current_admin() SECURITY DEFINER helper',
      'Migration 1.2: knit_members, knit_interest_tags, knit_participation_styles + member join tables',
      'Migration 1.3: knit_availability_baselines, knit_availability_exceptions',
      'Migration 1.4: knit_friends, knit_companionships, knit_outings, knit_outing_suggestions',
      'Migration 1.5: knit_notifications_log, knit_google_sheet_bindings',
      'Migration 1.6: seeded 7 participation styles + 47 global interest tags',
      'Migration 1.7: generated TypeScript types into src/lib/database.types.ts, Supabase client now typed',
      'Migration 1.8: advisor fixes — function search_path locked, auth.uid() wrapped for initplan caching, covering indexes added, FOR ALL policies split into INSERT/UPDATE/DELETE on knit_wards + knit_interest_tags to remove overlap with FOR SELECT',
      'All knit_ tables are RLS-enabled; admin scope enforced via knit_current_admin() helper',
    ],
  },
  {
    version: '0.1.3',
    date: '2026-04-22',
    summary: 'Fix: runtime dependencies were missing from package.json, breaking Vercel build.',
    details: [
      'First Vercel build failed with TS2307 "Cannot find module" for react-i18next, supabase-js, clsx, etc.',
      'Root cause: initial background npm install saved to node_modules but not package.json',
      'Reinstalled with explicit --save, all runtime deps now declared',
      'Build verified locally (250kb JS / 8kb CSS)',
    ],
  },
  {
    version: '0.1.2',
    date: '2026-04-22',
    summary: 'Phase 0 wrap-up: googleapis installed (Phase 2 prep), shadcn/ui components.json configured, initial push to GitHub.',
    details: [
      'googleapis npm package added for Phase 2 Sheets integration (server-side only)',
      'components.json configured for shadcn/ui CLI — slate base, @/components, @/lib/utils aliases',
      'Repo pushed to sendscott-del/knit-app on GitHub',
    ],
  },
  {
    version: '0.1.1',
    date: '2026-04-22',
    summary: 'Phase 0 architectural decision: consolidate Knit into shared Scott\'s Apps Supabase project with knit_ table prefix.',
    details: [
      'Free-tier org caps at 2 projects; Tidings occupies the second slot',
      'Every Knit table will be prefixed knit_ (knit_members, knit_wards, knit_outings, etc.)',
      'Matches existing chores_ / duty_ / steward_ / sq_ / bloom_ pattern in Scott\'s Apps',
      'Tidings remains a separate project (jdlykebsqafcngpntxma) for cross-project reads',
      'Spec (CLAUDE.md) and project memory updated with the decision and rationale',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-04-22',
    summary: 'Phase 0 scaffold — Vite + React + TS, Tailwind v4, i18next (en/es), Supabase client stub.',
    details: [
      'Project scaffolded with Vite 8 + React 19 + TypeScript',
      'Tailwind v4 configured via @tailwindcss/vite plugin',
      'i18next wired with en/es namespaces (common, onboarding, admin, sheet) — es values stubbed as TODO',
      'Supabase client module + .env.example created',
      'Path alias @/* mapped to src/*',
    ],
  },
]

export const CURRENT_VERSION = CHANGELOG[0].version

export const APP_NAME = 'Knit'


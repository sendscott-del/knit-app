export type ChangelogEntry = {
  version: string
  date: string
  summary: string
  details?: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
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


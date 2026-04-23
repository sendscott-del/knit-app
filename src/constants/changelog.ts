export type ChangelogEntry = {
  version: string
  date: string
  summary: string
  details?: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
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


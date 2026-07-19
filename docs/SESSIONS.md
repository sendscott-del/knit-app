# Session log — Knit

Append-only, newest first. One entry per working session: date, what changed, any infra facts touched.

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

# Knit

> *"Their hearts were knit together in unity and in love one towards another."* — Mosiah 18:21

A fellowship-matching app that helps LDS ward members form lasting friendships with the people missionaries are teaching. Missionaries transfer every 3–6 months; Knit keeps the relationships they start from leaving with them.

## Stack

- **Frontend**: Vite + React 19 + TypeScript, Tailwind v4, shadcn/ui primitives
- **i18n**: react-i18next (English live, Spanish stubbed)
- **Backend**: Supabase (separate `knit-production` project)
- **SMS**: Tidings app (Knit never touches Twilio directly)
- **Missionary UI**: Google Sheets (permanent design — missionaries can't install non-approved apps)
- **Hosting**: Vercel (web + cron)

## Authoritative spec

See [`CLAUDE.md`](./CLAUDE.md) for the full build specification. Every architectural decision lives there.

## Build phases

Phase 0 (scaffold) — ✅ current
Phase 1 (admin + member onboarding) — next
Phase 2 (Google Sheets integration)
Phase 3 (automated SMS loops)
Phase 4 (dashboards + load balancing)
Phase 5 (Spanish translations)

## Local development

```bash
npm install
cp .env.example .env.local   # fill in Supabase + Tidings values
npm run dev
```

## Release notes

Tracked in [`src/constants/changelog.ts`](./src/constants/changelog.ts). Bump the version and add an entry with every push.

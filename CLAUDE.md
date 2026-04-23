# Knit — Build Specification

> *"Their hearts were knit together in unity and in love one towards another."* — Mosiah 18:21

**Knit** is a fellowship-matching app that helps ward members form lasting friendships with the people the missionaries are teaching. Full-time missionaries transfer every 3–6 months; Knit makes sure the relationships they start don't leave with them.

This document is the authoritative spec. Use it as the project's `CLAUDE.md`. Build in the phases listed at the bottom. Do not skip ahead.

---

## 1. Product summary

### The problem
- Missionaries don't know which ward members would be a good fit for which teaching friends.
- Members' availability and interests aren't stored anywhere.
- Friends flake, members get discouraged, the willing five get burned out while sixty others are never asked.
- Missionaries can't use non-approved apps, but they *can* use Google Drive/Sheets/Docs.
- Many members are not tech-savvy.

### What Knit does
1. Surveys members for interests, availability, and the kinds of help they're happy to give.
2. Nudges members weekly by SMS (via Tidings) to confirm or adjust availability.
3. Publishes a live Google Sheet per ward that missionaries use as their workspace.
4. Suggests the best 3–5 members for any given friend and time slot, with reasons.
5. Logs outings — who went with whom, whether it happened, and what came of it.
6. Load-balances across the whole ward so participation is wide, not narrow.
7. Gives stake and ward leaders a dashboard showing engagement across all wards.

### What Knit does NOT do (v1)
- No native app for missionaries (Google Sheet is their interface — this is a permanent design choice until church IT approves otherwise).
- No financial, medical, or personally sensitive data.
- No AI-generated messaging to members or friends.
- No calendar integration (too much complexity; weekly exception model is simpler and works).

---

## 2. Tech stack

Match the established pattern from other Gathered apps:

- **Frontend**: React 18 + Vite, TypeScript, Tailwind CSS, shadcn/ui
- **i18n**: `react-i18next` with `/locales/en/` and `/locales/es/` (Spanish stubbed but not translated in v1)
- **Backend**: Supabase (separate project: `knit-production`, not shared with other Gathered apps)
- **Auth**: Supabase Auth for admins (magic link email). Custom token-based access for members.
- **Deployment**: Vercel
- **Cron jobs**: Vercel Cron (weekly availability nudge, post-outing check-in, Sheet sync)
- **SMS**: Via Tidings API — Knit never talks to Twilio directly
- **Member directory source of truth**: Tidings `members` table (read-only for Knit)
- **Google Sheets**: `googleapis` npm package, service account credentials in Vercel env vars

---

## 3. User roles

| Role | How they access | What they can do |
|------|-----------------|------------------|
| Stake President | Supabase magic-link auth (email) | Read all wards in stake, read all analytics. Cannot edit member data. |
| Stake High Councilor (Missionary) | Supabase magic-link auth | Full read/write across all wards in stake. Invite ward admins. |
| Ward Mission Leader | Supabase magic-link auth | Full read/write for their own ward only. Invite members. Manage friends. Configure Sheet. |
| Member | No-login signed token via SMS link | Edit only their own profile (interests, availability, participation styles). View their own outing history. |
| Missionary | Google Sheet only (via their church-approved Google account) | Read Available Members, Friends, Suggestions tabs. Write to Log Outing and Urgent Need tabs. |

---

## 4. Data model

Everything is scoped by `ward_id`. All RLS policies enforce this.

### Entities

```
stakes
  id (uuid)
  name                        -- "Chicago Illinois Stake"
  stake_unit_number           -- "528072"
  created_at

wards
  id (uuid)
  stake_id (fk)
  name                        -- "Hyde Park Ward"
  ward_unit_number
  timezone                    -- "America/Chicago"
  active (bool)
  created_at

members
  id (uuid)
  ward_id (fk)
  tidings_member_id           -- fk into the Tidings project (source of truth for name/phone)
  preferred_name              -- overrides Tidings display name if set
  locale                      -- 'en' | 'es'
  magic_link_token_hash       -- bcrypt hash of the token
  token_issued_at
  token_revoked_at (nullable)
  onboarding_completed_at (nullable)
  paused_until (nullable date) -- member can pause participation
  opted_out_at (nullable)
  notes (text)                -- admin-only notes
  created_at, updated_at

interest_tags
  id (uuid)
  ward_id (fk, nullable)      -- null = global/default tag
  name_en
  name_es (nullable)
  category                    -- 'hobby', 'sport', 'life_stage', 'profession', 'culture'
  active (bool)

member_interests (join table)
  member_id (fk)
  interest_tag_id (fk)
  created_at

participation_styles (enum stored as lookup table)
  key                         -- 'host_meal', 'give_ride', 'attend_lesson',
                              --    'invite_to_activity', 'take_to_event',
                              --    'teach_skill', 'share_testimony'
  label_en, label_es

member_participation_styles (join table)
  member_id (fk)
  style_key (fk)

availability_baselines
  id (uuid)
  member_id (fk)
  day_of_week                 -- 0-6 (Sun-Sat)
  time_slot                   -- 'morning' | 'afternoon' | 'evening'
  -- Presence of row = available. No row = not available.

availability_exceptions
  id (uuid)
  member_id (fk)
  date (date)
  time_slot                   -- nullable means whole-day exception
  available (bool)            -- overrides baseline
  note (text, nullable)
  created_at

friends
  id (uuid)
  ward_id (fk)
  first_name
  last_name (nullable)
  nickname (nullable)
  locale                      -- 'en' | 'es'
  phone (nullable)
  notes (text)
  interests_tags (array of interest_tag_ids) -- what missionaries observed
  teaching_status             -- 'investigating', 'progressing', 'on_date',
                              --    'baptized', 'paused', 'lost_contact'
  typical_availability (text) -- free-form, e.g., "evenings after 6"
  flake_count                 -- derived: count of outings with status 'flaked'
  added_by                    -- missionary name string (they don't have accounts)
  added_at, updated_at

companionships
  id (uuid)
  ward_id (fk)
  name                        -- "Elders Smith & Johnson" or "Hyde Park Sisters"
  google_emails (array)       -- church-approved gmail addresses for Sheet sharing
  active (bool)
  started_at, ended_at

outings
  id (uuid)
  ward_id (fk)
  friend_id (fk)
  member_id (fk)              -- nullable (sometimes missionaries go without a member)
  companionship_id (fk, nullable)
  scheduled_at (timestamptz)
  scheduled_time_slot         -- denormalized for reporting
  status                      -- 'scheduled', 'happened', 'flaked',
                              --    'rescheduled', 'canceled', 'needs_checkin'
  outcome_notes (text)        -- "Friend loved meeting the Johnsons, wants to come to dinner next week"
  logged_by                   -- 'member', 'missionary_sheet', 'admin', 'system'
  logged_at
  check_in_sent_at (nullable)
  member_confirmation_response (nullable) -- 'happened', 'flaked', 'rescheduled'
  created_at, updated_at

outing_suggestions
  id (uuid)
  friend_id (fk)
  time_slot_requested
  suggested_at
  suggested_member_ids (array)
  suggestion_reasons (jsonb)  -- {member_id: ["available Tue eve", "shares cooking"]}
  selected_member_id (nullable fk) -- which one the missionary picked

notifications_log
  id (uuid)
  member_id (fk)
  type                        -- 'weekly_nudge', 'appointment_reminder',
                              --    'post_outing_checkin', 'urgent_need', 'thank_you'
  sent_at
  tidings_message_id          -- reference for correlation
  response (text, nullable)
  response_received_at (nullable)

google_sheet_bindings
  id (uuid)
  ward_id (fk) unique
  sheet_id                    -- Google Sheet ID
  sheet_url
  last_push_at
  last_pull_at
  status                      -- 'healthy', 'error', 'not_configured'
  last_error (text, nullable)

admin_users
  id (uuid) = Supabase auth.user.id
  email
  name
  role                        -- 'stake_president', 'stake_missionary_hc', 'ward_mission_leader'
  stake_id (fk, nullable)
  ward_id (fk, nullable)      -- required if role is ward_mission_leader
  created_at
```

### RLS policies (enforce in Supabase)

- `members`, `friends`, `outings`, `availability_*`, `member_*`: readable/writable by admins whose stake_id or ward_id matches the row's ward.
- `members` (own record): readable/writable by session with valid magic-link token hash matching the row.
- `admin_users`: self-readable only. Inserts done server-side on invitation.
- `interest_tags` where `ward_id IS NULL`: globally readable.
- Service role key (used by Vercel serverless functions for cron jobs and Sheet sync) bypasses RLS.

---

## 5. Security model

### Member magic-link tokens

- Generate a 256-bit random token on member creation (`crypto.randomBytes(32)`).
- Store `bcrypt(token)` in `members.magic_link_token_hash`. Never store the plaintext.
- Link format: `https://knit.app/m/{member_id}/{token}` — include the member ID so the server can fetch the record and verify the hash without scanning.
- On first visit:
  1. Verify token against hash. If valid, issue a signed httpOnly cookie (JWT, 30-day rolling expiration).
  2. Redirect to `/me` (no token in URL).
- Rate limit token verification: 10 attempts per IP per hour.
- `token_revoked_at` set by admin blocks future verification.

### Admin sessions
- Standard Supabase Auth with magic link email.
- Admin invites another admin by email → triggers Supabase invite flow → admin row created with role after first login.

### Data minimization
- The onboarding screen shows members exactly what is stored: "name, phone, what days you're free, what you love doing, how you're willing to help."
- No birthday, address, family detail, or financial info ever collected by Knit.
- Member-entered notes fields are admin-visible but explicitly labeled as such.

### Inbound SMS handling
- Weekly nudge replies (YES, STOP, date strings) route to a Tidings webhook → Knit webhook endpoint.
- All inbound SMS content is treated as untrusted user input, sanitized before display, never executed as any kind of command.

---

## 6. Integrations

### 6.1 Tidings (sibling Gathered app)

**Read: member directory.**
- Knit reads Tidings' `members` table via direct Supabase cross-project query (service-role key) OR via a thin REST endpoint on Tidings. Choose the cross-project query approach — simpler, lower latency, and both projects are trusted first-party.
- Sync cadence: on-demand when admin clicks "Import from Tidings" and nightly cron.
- Only pull members in the relevant ward(s). Store `tidings_member_id` as foreign key.

**Write: outbound SMS.**
- Knit calls Tidings' existing `/api/send` endpoint with sender context `source: 'knit'` and the recipient's tidings_member_id.
- Tidings handles Twilio credentials, delivery status, and inbound reply routing.
- Knit tags each send with a `notification_type` for analytics and reply correlation.

**Inbound replies.**
- Tidings already receives inbound SMS. Add a filter: if the most recent outbound message to the same number came from `source: 'knit'`, forward the reply body to Knit's webhook at `https://knit.app/api/webhooks/tidings-inbound`.
- Knit parses the reply (YES, NO, date strings, free text) against the `notifications_log` entry to determine intent.

### 6.2 Google Sheets (missionary interface)

**One sheet per ward, owned by a Knit service account, shared with the ward's companionship Google emails as Editor.**

Tabs in each sheet:

1. **`Start Here`** — instructions. How to use each tab. Contact info for the ward mission leader.

2. **`Available This Week`** — auto-refreshed each morning at 6am local. Columns:
   `Member Name | Days Available | Time Slots | Interests | Willing To | Languages | Last Outing | Notes`

3. **`Friends We're Teaching`** — the friend roster. Columns:
   `Friend Name | Language | Interests | Teaching Status | Typical Availability | Total Member Outings | Days Since Last Member Outing`

4. **`Suggestions`** — missionary fills in a friend name and time slot, Knit fills in ranked members.
   Missionary row: `Friend Name | When (e.g., "Tue evening") | Needs (host meal / ride / teach / attend) | [Generate]`
   Knit reply rows: `#1 Member | Why | #2 Member | Why | #3 Member | Why | #4 Member | Why | #5 Member | Why`
   Implementation: on a schedule (every 10 minutes during daytime hours), Knit reads rows where the member cells are empty and fills them in.

5. **`Log an Outing`** — missionary logs completed appointments. Columns:
   `Date | Time | Friend | Member | Companionship | What Happened | Outcome Notes | [ Synced ✓ ]`
   Sync pulls rows where Synced column is empty, creates/updates Outing records, writes a ✓ back.

6. **`Urgent Need`** — for last-minute requests. Cell: "I need someone tonight at 7pm who likes basketball." Missionary fills cell, clicks "Send" checkbox. Knit finds matching members and sends a Tidings broadcast SMS: "Elders need a fellowshipper tonight 7pm at [friend name]'s. Reply YES to go." Replies surface in Sheet.

7. **`Recent Outings`** (read-only) — rolling 90-day history.

8. **`Friend Shout-outs`** (optional Phase 2) — missionaries can write thanks for specific members; these get shown to the member on their next visit and can be included in the ward mission leader's "thank them" message.

**Sync mechanics.**
- Service account: `knit-sheets@<gcp-project>.iam.gserviceaccount.com`.
- Ward Mission Leader provides the list of missionary Gmail addresses via admin UI → Knit shares the sheet with those emails as Editor.
- Push direction (Knit → Sheet): batch update on relevant rows, triggered by cron (morning refresh, hourly refresh during daytime).
- Pull direction (Sheet → Knit): polling every 10 minutes during daytime hours for Log an Outing and Suggestions tabs.
- Conflict handling: Knit is source of truth for everything *except* outing logs and urgent-need requests, which are Sheet-authored.
- Revision stored on each sync; if a push and pull race, last-write-wins with audit entry.

### 6.3 No direct missionary app access ever (policy)

The Google Sheet is the missionary interface forever, not temporarily. Building that constraint into the product *permanently* avoids the "we'll eventually get approval" trap and forces the Sheet flow to be genuinely excellent. If church IT eventually approves a native app, Knit can add one without rework — the Sheet interface stays.

---

## 7. Suggestion algorithm

For a given `(friend, requested_time_slot, missionary_need)`:

**Step 1: Hard filters.**
- Member is not paused or opted out.
- Member is available during `requested_time_slot` (baseline + exceptions).
- Member's language matches the friend's language (if friend speaks only Spanish, filter to Spanish-speaking members). Bilingual members match all.
- Member's participation styles include the missionary's stated need (if specified).
- Member is not the same person going out for a different appointment in the same time slot.

**Step 2: Score remaining members.**

```
score =
    5 * language_match_score           // 0 (acceptable) or 1 (native match)
  + 3 * participation_style_match      // 0 or 1
  + 2 * interest_overlap_count         // count of shared tags, capped at 5
  + freshness_score                    // min(days_since_last_outing / 14, 5)
  + reliability_score                  // see below
  + 1 * prior_success_with_friend      // 0 or 1 — pair went out before with outcome=happened
  - 3 * recent_pairing_penalty         // 1 if this member went with this friend in last 30 days (avoid over-pairing)
```

`reliability_score`:
- Start at 3 for every member (neutral).
- +1 per outing with status `happened` in last 90 days, capped at +3.
- −2 per outing where the member was a no-show (different from friend flake).

**Step 3: Return top 5, sorted by score.**

Each returned member includes a reasons array populated from which terms contributed most to their score:
- "Available Tuesday evenings"
- "Shares interest: cooking, basketball"
- "Speaks Spanish"
- "Happy to host meals"
- "Hasn't been out in 78 days"
- "Went with Miguel last time and it went well"

**Edge cases:**
- If fewer than 3 members pass hard filters, return what's available and include a hint: "Consider asking Ward Mission Leader to recruit more Spanish-speaking members" or "No one is available Tue evening — try Wed?"
- If zero pass, return empty with suggestions for relaxing constraints.

---

## 8. Member experience (non-tech-savvy-friendly)

### First visit (SMS link → onboarding)

Single-column, one-question-per-screen flow. Minimum body text 18px. Tap targets ≥48px. No nested menus.

**Screen 1 — Welcome**
> Hi [First Name]. This is Knit.
> Our missionaries are teaching people who could use a friend — a real one, who stays after the missionaries transfer.
> Want to help?
> [ Yes, let's go ] [ Tell me more first ]

**Screen 2 — What we'll ask**
> We'll ask three quick things:
> • What days you're usually free
> • What you love doing
> • How you'd like to help
> We keep just those things. No address, no finances, no family details.
> [ Got it, continue ]

**Screen 3 — Days**
> What days are you usually free in the evening?
> [ Sun ] [ Mon ] [ Tue ] [ Wed ] [ Thu ] [ Fri ] [ Sat ]
> (Big tap-to-toggle buttons; selections highlight)
> [ Also free during the day? Tap to add ]
> [ Next ]

**Screen 4 — Interests**
> What do you love doing?
> (Grid of tappable chips: Cooking, Sports, Music, Reading, Hiking, Gardening, Gaming, Kids, Crafts, Movies, Travel, Service, Teaching...)
> [ Add your own: ___ ]
> [ Next ]

**Screen 5 — How you can help**
> Missionaries need different kinds of help. What are you happy to do?
> (Large card buttons, multi-select):
> 🍽 Host a meal
> 🚗 Give a ride
> 🪑 Sit in on a lesson
> 🎉 Invite a friend to an activity
> 🎓 Share a skill I have
> 💬 Share my testimony
> [ Next ]

**Screen 6 — Confirm**
> Got it! Here's what we have:
> Free: Tue/Thu evenings
> Love: cooking, hiking
> Willing to: host meals, share testimony
> We'll text you every Sunday — just a quick check-in. You can always adjust.
> [ All set ]

### Weekly nudge (Sunday evening, via Tidings SMS)

> Hi [Name] — this is Knit. Are your usual times still good this week? (Tue/Thu eve)
> Reply:
>   YES — still good
>   BUSY — skip me this week
>   or send any dates/times you need to change
>
> Tap to update: [link]

Responses parsed by simple regex/keyword; free-text responses routed to Ward Mission Leader inbox for manual review.

### Return visits

Member hits their personal URL (or tap the link again). Lands on `/me` dashboard:

- 📅 **Your availability** — edit in two taps.
- ❤️ **Your interests** — add or remove chips.
- 🤝 **Your outings** — a list of who you went with and when.
- 🙏 **Thank-yous** — messages from missionaries/friends (Phase 2).
- ⏸ **Pause for a month** — one tap, no form.

---

## 9. Admin experience

### Stake view (Stake President / Stake HC)
- Stake-wide dashboard: active members per ward, outings per ward (this week / this month), friends currently being taught, % of members active in last 30 days.
- Drill-down to any ward.
- "Wards to watch" — flags wards with low engagement.

### Ward Mission Leader view
- Dashboard: this ward's members, friends, upcoming outings, urgent needs.
- **Members** tab: list, status, last outing date, quick send-invite, send-nudge, pause, revoke link.
- **Friends** tab: roster (usually mirrored from Sheet; WML can also add/edit here).
- **Outings** tab: log-view with filters.
- **Sheet** tab: Google Sheet setup — paste missionary Gmail addresses, confirm, Knit provisions the sheet and shares it.
- **Settings** tab: interest tag library for the ward (add ward-specific tags), companionship management.

### Bulk member invite flow
- WML clicks "Invite all members" → Knit pulls ward members from Tidings → displays list with checkboxes → WML confirms → Tidings sends each member their unique magic link with the Screen 1 text.

---

## 10. Cron jobs (Vercel Cron)

| Job | Schedule | What it does |
|-----|----------|-------------|
| `sheets-morning-push` | 6:00 local every day | Refresh Available This Week + Friends + Recent Outings tabs for every active ward. |
| `sheets-daytime-pull` | Every 10 min, 8am–10pm | Poll Log an Outing and Suggestions tabs for new rows in every ward. |
| `weekly-availability-nudge` | Sunday 6pm local | Send weekly SMS to every active, non-paused member. |
| `post-outing-checkin` | Hourly | For outings with status `scheduled` whose scheduled_at was 2–6 hours ago and no check-in sent, send the "did it happen?" SMS to the member. |
| `tidings-member-sync` | Nightly 2am | Pull updated Tidings member list; mark newly added members as needing invite. |
| `load-balance-reminder` | Monthly, 1st at 9am | For each ward: email WML with "these 10 members haven't been out in 90+ days, consider nudging." |

---

## 11. i18n architecture

- `react-i18next` with namespace split: `common`, `onboarding`, `admin`, `sheet`.
- Keys in English, translations in `/locales/{lang}/{namespace}.json`.
- DB strings with `_en` / `_es` columns: `interest_tags.name_en`, `interest_tags.name_es`, `participation_styles.label_en`, `participation_styles.label_es`.
- Members have a `locale` field. SMS templates selected by locale. UI renders in locale.
- In v1: only `/locales/en/*` is populated. `/locales/es/*` files exist with all keys but values are TODOs. Language switcher is hidden in v1 but code path is complete.
- All dates/times rendered with `date-fns` and `date-fns/locale`.

---

## 12. Environment variables

```
# Supabase
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# Tidings cross-project access
TIDINGS_SUPABASE_URL
TIDINGS_SUPABASE_SERVICE_ROLE_KEY   # read-only on members table
TIDINGS_API_BASE                     # for SMS send endpoint
TIDINGS_API_KEY

# Google Sheets service account
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

# App
APP_BASE_URL                         # https://knit.app
MAGIC_LINK_SECRET                    # for bcrypt pepper
```

Manage via Vercel env UI. Never commit.

---

## 13. Build phases

### Phase 0: Setup (half day)
- [ ] `npm create vite@latest` with React + TypeScript template.
- [ ] Install Tailwind, shadcn/ui, react-i18next, @supabase/supabase-js, googleapis, date-fns.
- [ ] Create Supabase project `knit-production`.
- [ ] Connect Supabase MCP server and Vercel MCP server in Claude Code.
- [ ] Repo `knit-app`, push to GitHub, deploy to Vercel.
- [ ] Add all env vars.
- [ ] Set up `/locales/en/*.json` and `/locales/es/*.json` (empty scaffolding).

### Phase 1: Admin + member onboarding (the critical path — ~1 week)
- [ ] Supabase migrations for all tables in section 4.
- [ ] RLS policies for every table.
- [ ] Seed `interest_tags` (global defaults) and `participation_styles`.
- [ ] Admin magic-link auth (Supabase Auth).
- [ ] Admin dashboard shell (role-aware routing).
- [ ] Ward Mission Leader: import members from Tidings (cross-project read).
- [ ] Ward Mission Leader: "Invite all members" → batch SMS via Tidings.
- [ ] Member magic-link route `/m/:id/:token` → cookie session → `/me`.
- [ ] Member onboarding flow (screens 1–6).
- [ ] Member `/me` dashboard with edit-availability, edit-interests, edit-styles, pause, outing history.
- [ ] WML manual outing log entry (since Sheet isn't built yet).
- [ ] WML friends CRUD.
- [ ] Basic suggestion algorithm + "Suggest a member" admin UI.

**Phase 1 exit criteria:** Ward Mission Leader can import members, members can receive links and complete onboarding, WML can add friends and get member suggestions, manually log outings. All in English.

### Phase 2: Google Sheets integration (~1 week)
- [ ] Service account configured; sheet templating.
- [ ] WML "Provision Sheet" action — creates sheet, shares with missionary emails, writes tab templates.
- [ ] Morning push cron.
- [ ] Daytime pull cron for Log an Outing + Suggestions.
- [ ] Sheet binding admin UI (status, re-sync, error messages).
- [ ] End-to-end test with a real missionary email on a staging ward.

**Phase 2 exit criteria:** A missionary can open the sheet, fill in Suggestions request, see 3–5 ranked members with reasons within 10 minutes, log an outing that shows up in admin UI.

### Phase 3: Automated SMS loops (~3 days)
- [ ] Weekly availability nudge cron + reply parser.
- [ ] Post-outing check-in cron + reply parser.
- [ ] Inbound webhook from Tidings.
- [ ] Urgent Need broadcast flow.
- [ ] notifications_log audit UI for admins.

### Phase 4: Dashboards and load balancing (~3 days)
- [ ] Stake dashboard.
- [ ] Ward WML dashboard analytics.
- [ ] Monthly "overlooked members" email to WML.
- [ ] Freshness & reliability weighting tuned with pilot data.

### Phase 5: Spanish (~2 days, post-pilot)
- [ ] Fill in `/locales/es/*.json`.
- [ ] Translate interest tags and participation styles.
- [ ] SMS templates in Spanish.
- [ ] Language switcher visible.
- [ ] QA with a Spanish-speaking member.

### Phase 6 ideas (future, not v1)
- Friend shout-outs tab.
- Cross-ward fellowshipper discovery when in-ward options are weak.
- Baptism/ordinance milestone thank-you automation to members who helped along the way.
- Ministering-assignment awareness (members ministering to the same area).
- Analytics on which interest tags predict successful pairings.
- Native missionary app if/when church IT approves.

---

## 14. Claude Code working instructions

When Claude Code works on this project:

1. **Read this spec first, every session.** If something isn't in the spec, ask before inventing it.
2. **Do not skip phases.** Complete Phase 1 exit criteria before touching Phase 2.
3. **Use subagents** for: database migrations, Google Sheets plumbing, SMS integration — each is a context-heavy area that benefits from isolation.
4. **Supabase MCP**: use for all schema changes and RLS work. Do not hand-write SQL migrations that haven't been applied via MCP.
5. **Vercel MCP**: use for env var management and deployment checks.
6. **Testing**: for each Phase, write at least one end-to-end test. Playwright for UI, Supabase integration tests for RLS.
7. **Commit style**: one commit per meaningful unit. Include the spec section number in the commit message: `Phase 1.3: member magic-link route + cookie session`.
8. **Compact early**: when context hits 70%, run `/compact` and reload this spec before continuing.
9. **Never send live SMS from dev.** All SMS paths must check `process.env.VERCEL_ENV === 'production'` or use a `DRY_RUN` mode logging to console.
10. **Accessibility**: the member flow must work with VoiceOver/TalkBack. Run axe checks on every member-facing screen.

---

## 15. Open questions to resolve during Phase 1

- Confirm Tidings schema for `members` and exact auth approach for cross-project read.
- Decide whether to run Tidings sync on a nightly cron or event-driven via Tidings webhook when members are added/removed.
- Finalize the default global interest tag library (target: 25–40 tags covering hobbies, life stages, cultures).
- Confirm bishop involvement: does the bishop get visibility? (Default: yes, read-only for their ward.)

---

*End of spec.*

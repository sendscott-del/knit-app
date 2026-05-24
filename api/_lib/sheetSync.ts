import { google, type sheets_v4 } from 'googleapis'
import { supabaseAdmin } from './supabaseAdmin.js'
import {
  replaceDataRows,
  writeRange,
  colLetter,
  applyProtectedRanges,
  ensureTabs,
  getAuth,
  getSheetMeta,
  KNIT_PROTECT_TAG,
  type CreatedSheet,
  type ProtectionRule,
} from './sheets.js'

/**
 * Defines the ordered tabs that every ward's sheet has, and the header row
 * for each one. Tabs are created in this order.
 */
export const TABS = {
  START_HERE: 'Start Here',
  // Static instructions tab with the /join self-service link. Moved up to
  // position 2 in v0.40.0 so it sits right after Start Here.
  INVITE_HOWTO: 'How to Invite Members',
  AVAILABLE: 'Available This Week',
  FRIENDS: 'Friends We are Teaching',
  // Missionary entry tab for adding a brand-new friend the ward is starting
  // to teach.
  ADD_FRIEND: 'Add a Friend',
  SUGGESTIONS: 'Suggestions',
  LOG_OUTING: 'Log an Outing',
  RECENT: 'Recent Outings',
  // Missionary-only feedback box.
  FEEDBACK: 'Send Feedback',
  // Hidden — backing list for the Log an Outing → Member dropdown.
  ROSTER: 'Member Roster (do not edit)',
} as const

export const TAB_ORDER: string[] = [
  TABS.START_HERE,
  TABS.INVITE_HOWTO,
  TABS.AVAILABLE,
  TABS.FRIENDS,
  TABS.ADD_FRIEND,
  TABS.SUGGESTIONS,
  TABS.LOG_OUTING,
  TABS.RECENT,
  TABS.FEEDBACK,
  TABS.ROSTER,
]

/**
 * Tabs Knit used to manage but no longer does. populateDataTabs deletes
 * any of these still present so existing sheets are reconciled to the
 * current TAB_ORDER on the next morning push or hourly pull.
 */
export const OBSOLETE_TABS = [
  'Urgent Need',                  // never had real functionality; dropped in v0.38.0
  'Members to Invite',            // replaced by self-service /join + How to Invite tab
  'Recent Outings (read-only)',   // v0.40.0 rename reverted in v0.40.1 in favor of a banner row
] as const

/**
 * Tabs that show a "READ ONLY — DO NOT EDIT" banner in row 1, with headers
 * shifted down. These five tabs are fully Knit-managed (push only); the
 * banner makes the rule visually obvious. populateDataTabs writes the
 * banner on every sync.
 */
export const READ_ONLY_BANNER_TABS: readonly string[] = [
  TABS.START_HERE,
  TABS.INVITE_HOWTO,
  TABS.AVAILABLE,
  TABS.FRIENDS,
  TABS.RECENT,
]

/**
 * For tabs with a banner row in row 1, headers move to row 2 and data starts
 * at row 3. Everything else keeps headers in row 1 and data in row 2+.
 */
export function dataStartRow(tab: string): number {
  if ((READ_ONLY_BANNER_TABS as readonly string[]).includes(tab)) return 3
  return 2
}

export function headerRow(tab: string): number {
  if ((READ_ONLY_BANNER_TABS as readonly string[]).includes(tab)) return 2
  return 1
}

const HEADERS: Record<string, string[]> = {
  [TABS.AVAILABLE]: [
    'Member',
    'Available',
    'Interests',
    'Willing to',
    'Language',
    'Last outing',
    'Days since last',
    'Notes',
  ],
  [TABS.FRIENDS]: [
    'Friend',
    'Language',
    'Interests',
    'Teaching status',
    'Typical availability',
    'Total outings',
    'Days since last',
  ],
  [TABS.SUGGESTIONS]: [
    'Friend name',
    'When (day)',
    'Time of day',
    'Need',
    'Generate',
    '#1',
    'Why #1',
    '#2',
    'Why #2',
    '#3',
    'Why #3',
    '#4',
    'Why #4',
    '#5',
    'Why #5',
  ],
  [TABS.LOG_OUTING]: [
    'Date',
    'Time',
    'Friend',
    'Member',
    'Status',
    'Outcome notes',
    'Synced',
  ],
  [TABS.RECENT]: [
    'Date',
    'Slot',
    'Friend',
    'Member',
    'Status',
    'Outcome notes',
  ],
  // Missionary feedback — typed rows flow into app_suggestions on next pull.
  [TABS.FEEDBACK]: ['Your name', 'Your idea or feedback', 'Status', 'Submitted at'],
  // Missionary entry tab for new friends. Yellow cols (A-E) are entry; gray
  // (F-G) are filled by Knit after the pull picks the row up.
  [TABS.ADD_FRIEND]: [
    'First name',
    'Last name',
    'Language',
    'Teaching status',
    'Notes',
    'Status',
    'Synced at',
  ],
  // Hidden roster — one row per onboarded ward member. Used as a
  // data-validation source for the Log an Outing → Member dropdown.
  [TABS.ROSTER]: ['Member ID', 'Full name', 'Phone'],
}

export async function writeAllHeaders(spreadsheetId: string) {
  // One batchUpdate instead of N sequential values.update calls. Each header
  // row counts as a write request in Sheets' quota; before this every sync
  // burned ~9 of the 60 writes/min/SA budget on headers alone.
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const data = Object.entries(HEADERS).map(([tab, headers]) => {
    const row = headerRow(tab)
    return {
      range: `${tab}!A${row}:${colLetter(headers.length)}${row}`,
      values: [headers],
    }
  })
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  })
}

/** Public read-only access to the canonical headers for a tab. */
export function getExpectedHeaders(tab: string): string[] | null {
  return HEADERS[tab] ?? null
}

/* ============================================================
   Protection rules — what missionaries can't break
   ------------------------------------------------------------
   - Knit-managed read-only tabs (Start Here, Available, Friends,
     Recent Outings) are warning-only protected against any edit:
     they get rebuilt from the DB every morning, so missionary
     edits would be silently overwritten anyway. The warning makes
     that visible up front.
   - Header rows on the mixed tabs (Suggestions, Log an Outing,
     Urgent Need) are hard-locked. Missionaries cannot rename or
     delete them; the service account stays in editors so Knit's
     own header repair writes still work.
   - Knit-fill columns on the mixed tabs are warning-only — a
     missionary may legitimately want to clear a stale row, but
     should be warned first.
   ============================================================ */

const PROTECTION_RULES: ProtectionRule[] = [
  // Read-only Knit-managed tabs — hard-locked. Missionaries never need to
  // type in these so we go beyond warning-only and forbid edits outright.
  {
    tab: TABS.START_HERE,
    description: `${KNIT_PROTECT_TAG} Instructions — auto-managed by Knit`,
    warningOnly: false,
    range: 'whole-sheet',
  },
  {
    tab: TABS.AVAILABLE,
    description: `${KNIT_PROTECT_TAG} Auto-filled from Knit — edit member info in the Knit admin app`,
    warningOnly: false,
    range: 'whole-sheet',
  },
  {
    tab: TABS.FRIENDS,
    description: `${KNIT_PROTECT_TAG} Auto-filled from Knit — edit friends in the Knit admin app`,
    warningOnly: false,
    range: 'whole-sheet',
  },
  {
    tab: TABS.RECENT,
    description: `${KNIT_PROTECT_TAG} Auto-filled history — refreshed every morning`,
    warningOnly: false,
    range: 'whole-sheet',
  },
  {
    tab: TABS.INVITE_HOWTO,
    description: `${KNIT_PROTECT_TAG} Static instructions — do not edit`,
    warningOnly: false,
    range: 'whole-sheet',
  },

  // Header rows on mixed tabs — hard lock so missionaries can't break parsers.
  {
    tab: TABS.SUGGESTIONS,
    description: `${KNIT_PROTECT_TAG} Header row — do not change column titles`,
    warningOnly: false,
    range: { startRow: 0, endRow: 1 },
  },
  {
    tab: TABS.LOG_OUTING,
    description: `${KNIT_PROTECT_TAG} Header row — do not change column titles`,
    warningOnly: false,
    range: { startRow: 0, endRow: 1 },
  },
  {
    tab: TABS.FEEDBACK,
    description: `${KNIT_PROTECT_TAG} Header row — do not change column titles`,
    warningOnly: false,
    range: { startRow: 0, endRow: 1 },
  },
  {
    tab: TABS.ADD_FRIEND,
    description: `${KNIT_PROTECT_TAG} Header row — do not change column titles`,
    warningOnly: false,
    range: { startRow: 0, endRow: 1 },
  },

  // Knit-fill columns on mixed tabs — HARD LOCK so missionaries can't even
  // type in them. Combined with the entry/auto color coding this makes the
  // workspace much harder to break.
  {
    // Suggestions: Knit fills F:O ( #1 / Why #1 ... #5 / Why #5 )
    tab: TABS.SUGGESTIONS,
    description: `${KNIT_PROTECT_TAG} Knit fills these columns automatically`,
    warningOnly: false,
    range: { startCol: 5, endCol: 15 },
  },
  {
    // Log an Outing: Knit writes ✓ in the Synced column (G)
    tab: TABS.LOG_OUTING,
    description: `${KNIT_PROTECT_TAG} Knit writes the Synced check`,
    warningOnly: false,
    range: { startCol: 6, endCol: 7 },
  },
  {
    // Feedback: Knit fills Status (col C) and Submitted at (col D)
    tab: TABS.FEEDBACK,
    description: `${KNIT_PROTECT_TAG} Knit fills these columns automatically`,
    warningOnly: false,
    range: { startCol: 2, endCol: 4 },
  },
  {
    // Add a Friend: Knit fills Status (col F) and Synced at (col G)
    tab: TABS.ADD_FRIEND,
    description: `${KNIT_PROTECT_TAG} Knit fills these columns automatically`,
    warningOnly: false,
    range: { startCol: 5, endCol: 7 },
  },
]

/** Idempotent — removes any prior Knit protections then applies the canonical rule set. */
export async function protectSpreadsheet(spreadsheetId: string) {
  await applyProtectedRanges(spreadsheetId, PROTECTION_RULES)
}

export async function writeStartHere(spreadsheetId: string, wardName: string) {
  const lines: string[][] = [
    [`Knit — ${wardName}`],
    [''],
    ['Welcome, missionaries. This sheet is your workspace.'],
    [''],
    ['Color key'],
    ['• Yellow cells are for YOU to fill in.'],
    ['• Gray cells are filled in by Knit. They are locked — you can\'t type in them.'],
    ['• Plain white cells are pure read-only reference data (also locked).'],
    [''],
    ['How to use each tab:'],
    [''],
    ['• Available This Week — who in the ward is free and what they love doing.'],
    ['  Auto-refreshed.'],
    [''],
    ['• Friends We are Teaching — the friends we are fellowshipping.'],
    ['  Auto-refreshed. To add a new friend, use the next tab.'],
    [''],
    ['• Add a Friend — type a new friend in the yellow cells. On the next'],
    ['  sync Knit adds them to the app and the Friends We are Teaching tab.'],
    [''],
    ['• Suggestions — want ideas for a friend? Fill the yellow cells (friend,'],
    ['  day, time, optional need) and check Generate. Within an hour we will fill'],
    ['  in the gray cells with the top 5 members and the reasons.'],
    [''],
    ['• Log an Outing — after an outing happens, log it here. The Synced cell'],
    ['  flips to a checkmark once we pick it up.'],
    [''],
    ['• How to Invite Members — short instructions for sending the self-service'],
    ['  Knit link to a member who hasn\'t signed up yet.'],
    [''],
    ['• Send Feedback — type any idea, bug, or "this would be nice" in the yellow'],
    ['  cells. It goes straight to the Knit team.'],
    [''],
    ['• Recent Outings — rolling 90-day read-only history.'],
    [''],
    [`Ward contact — ask your ward mission leader if anything looks off.`],
  ]
  // Row 1 is the read-only banner (written separately); content starts at A2.
  await writeRange(spreadsheetId, `${TABS.START_HERE}!A2`, lines)
}

export async function writeInviteHowto(spreadsheetId: string) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VITE_APP_URL ??
    'https://knit-together.vercel.app'
  const joinUrl = `${appUrl}/join`
  const lines: string[][] = [
    ['How to invite a member to Knit'],
    [''],
    ['1. Send the member this link by text:'],
    [`   ${joinUrl}`],
    [''],
    ['2. They type their first name, last name, and phone.'],
    ['   Knit looks them up in the ward roster and texts their'],
    ['   personal survey link.'],
    [''],
    ['3. Once they finish the survey, they appear on the'],
    ['   Available This Week tab automatically (next refresh).'],
    [''],
    ['Tips:'],
    ['• If a member already signed up but lost their link,'],
    ['  they can use the same /join page to get a fresh one.'],
    ['• If they can\'t find themselves, ask your ward mission'],
    ['  leader — they may need to be added to the ward roster'],
    ['  in Tidings first.'],
  ]
  // Row 1 is the read-only banner; instructions start at A2.
  await writeRange(spreadsheetId, `${TABS.INVITE_HOWTO}!A2`, lines)
}

type PopulateArgs = {
  spreadsheetId: string
  wardId: string
}

/**
 * Populates the read-only data tabs (Available, Friends, Recent Outings).
 * Called on initial provisioning and on every refresh / morning-push.
 *
 * Also reconciles the tab list (creating new tabs, removing obsolete ones)
 * and re-applies the entry/auto color coding + dropdowns so old sheets
 * inherit recent template changes on the next sync.
 */
export async function populateDataTabs({ spreadsheetId, wardId }: PopulateArgs) {
  const sb = supabaseAdmin()

  // Make sure tabs match the current TAB_ORDER (creates anything missing).
  // Idempotent.
  await ensureTabs(spreadsheetId, TAB_ORDER)

  // Sweep out any obsolete Knit-managed tabs (Urgent Need, Members to Invite, …)
  // so existing sheets get reconciled to the new shape without manual cleanup.
  await removeObsoleteKnitTabs(spreadsheetId)

  // Reorder so Start Here sits first and the rest match TAB_ORDER.
  await enforceTabOrder(spreadsheetId)

  // Refresh the static instruction tabs and rewrite headers so any new tab
  // additions / column renames land on existing sheets.
  await writeAllHeaders(spreadsheetId)
  await writeInviteHowto(spreadsheetId)
  // Re-write Start Here too so the layout shift (banner row 1 + content
  // starting row 2) reaches existing sheets.
  const { data: wardRow } = await sb
    .from('knit_wards')
    .select('name')
    .eq('id', wardId)
    .maybeSingle()
  await writeStartHere(spreadsheetId, (wardRow as { name?: string } | null)?.name ?? 'your ward')
  // Banner row 1 on the read-only tabs. Done last so the banner overwrites
  // any old row-1 content (e.g. the old header from before we shifted to
  // row 2 in v0.40.1).
  await writeReadOnlyBanners(spreadsheetId)

  // Re-apply the protection ruleset every sync. Idempotent (removes any
  // existing Knit-tagged protections first, then adds them fresh). Closes
  // an edge case where a missionary or Google could silently drop a
  // protection and the tabs went unguarded until the next morning push.
  await protectSpreadsheet(spreadsheetId)

  /* ---- Available This Week ---- */
  const { data: members } = await sb
    .from('knit_members')
    .select(
      `
        id, first_name, last_name, preferred_name, locale, paused_until,
        opted_out_at, onboarding_completed_at, phone,
        availability:knit_availability_baselines(day_of_week, time_slot),
        interests:knit_member_interests(interest_tag:knit_interest_tags(name_en)),
        styles:knit_member_participation_styles(style:knit_participation_styles(label_en))
      `,
    )
    .eq('ward_id', wardId)

  const now = Date.now()

  // Preload last outing timestamps for every member in the ward
  const { data: outings } = await sb
    .from('knit_outings')
    .select('member_id, status, scheduled_at')
    .eq('ward_id', wardId)

  const lastOutingByMember = new Map<string, string>()
  for (const o of outings ?? []) {
    if (!o.member_id || o.status !== 'happened') continue
    const prev = lastOutingByMember.get(o.member_id)
    if (!prev || new Date(o.scheduled_at).getTime() > new Date(prev).getTime()) {
      lastOutingByMember.set(o.member_id, o.scheduled_at)
    }
  }

  // Only members the missionaries can actually act on: opted in, not paused,
  // onboarding done, and with at least one availability baseline row. This
  // matches the "Active" badge gate on /admin/members so the sheet and the
  // admin app agree on who's available. Previously the sheet dumped every
  // synced ward member, which was 3K+ rows of mostly-not-onboarded contacts.
  const availableRows: string[][] = (members ?? [])
    .filter((m) => {
      if (m.opted_out_at) return false
      if (m.paused_until && new Date(m.paused_until).getTime() > now) return false
      if (!m.onboarding_completed_at) return false
      if (!m.availability || m.availability.length === 0) return false
      return true
    })
    .map((m) => {
      const name = m.preferred_name || [m.first_name, m.last_name].filter(Boolean).join(' ')
      const availability = (m.availability ?? [])
        .map((a) => `${dayShort(a.day_of_week)} ${a.time_slot}`)
        .join(', ')
      const interests = (m.interests ?? [])
        .map((i) => {
          const raw = (i as unknown as { interest_tag: unknown }).interest_tag
          const tag = Array.isArray(raw)
            ? (raw[0] as { name_en?: string } | undefined)
            : (raw as { name_en?: string } | null)
          return tag?.name_en
        })
        .filter(Boolean)
        .join(', ')
      const willingTo = (m.styles ?? [])
        .map((s) => {
          const raw = (s as unknown as { style: unknown }).style
          const style = Array.isArray(raw)
            ? (raw[0] as { label_en?: string } | undefined)
            : (raw as { label_en?: string } | null)
          return style?.label_en
        })
        .filter(Boolean)
        .join(', ')
      const last = lastOutingByMember.get(m.id)
      const daysSince = last
        ? Math.floor((now - new Date(last).getTime()) / 86400000).toString()
        : ''
      return [
        name || '—',
        availability || '—',
        interests || '—',
        willingTo || '—',
        m.locale === 'es' ? 'Spanish' : 'English',
        last ? new Date(last).toISOString().slice(0, 10) : '—',
        daysSince,
        '', // notes column (per v1.4 template header)
      ]
    })

  await replaceDataRows(
    spreadsheetId,
    TABS.AVAILABLE,
    8,
    availableRows,
    dataStartRow(TABS.AVAILABLE),
  )

  /* ---- Friends We are Teaching ---- */
  const { data: friends } = await sb
    .from('knit_friends')
    .select('*')
    .eq('ward_id', wardId)
    .neq('teaching_status', 'lost_contact')
    .order('added_at', { ascending: false })

  const { data: friendInterestTags } = friends && friends.length > 0
    ? await sb
        .from('knit_interest_tags')
        .select('id, name_en')
        .in(
          'id',
          Array.from(
            new Set((friends ?? []).flatMap((f) => f.interest_tag_ids ?? [])),
          ),
        )
    : { data: [] as { id: string; name_en: string }[] }

  const interestNameById = new Map<string, string>()
  for (const t of friendInterestTags ?? []) interestNameById.set(t.id, t.name_en)

  // Friend outing stats
  const { data: friendOutings } = await sb
    .from('knit_outings')
    .select('friend_id, status, scheduled_at')
    .eq('ward_id', wardId)

  const friendStats = new Map<
    string,
    { total: number; lastAt: string | null }
  >()
  for (const o of friendOutings ?? []) {
    const s = friendStats.get(o.friend_id) ?? { total: 0, lastAt: null }
    if (o.status === 'happened') {
      s.total += 1
      if (!s.lastAt || new Date(o.scheduled_at).getTime() > new Date(s.lastAt).getTime()) {
        s.lastAt = o.scheduled_at
      }
    }
    friendStats.set(o.friend_id, s)
  }

  const friendRows: string[][] = (friends ?? []).map((f) => {
    const fullName = [f.first_name, f.last_name].filter(Boolean).join(' ')
    const interests = (f.interest_tag_ids ?? [])
      .map((id) => interestNameById.get(id))
      .filter(Boolean)
      .join(', ')
    const stats = friendStats.get(f.id)
    const daysSince = stats?.lastAt
      ? Math.floor((now - new Date(stats.lastAt).getTime()) / 86400000).toString()
      : ''
    return [
      fullName || '—',
      f.locale === 'es' ? 'Spanish' : 'English',
      interests || '—',
      teachingStatusLabel(f.teaching_status),
      f.typical_availability ?? '—',
      (stats?.total ?? 0).toString(),
      daysSince,
    ]
  })

  await replaceDataRows(
    spreadsheetId,
    TABS.FRIENDS,
    7,
    friendRows,
    dataStartRow(TABS.FRIENDS),
  )

  /* ---- Recent Outings (last 90 days) ---- */
  const ninetyAgo = new Date(now - 90 * 86400000).toISOString()
  const { data: recent } = await sb
    .from('knit_outings')
    .select(
      `
        scheduled_at, scheduled_time_slot, status, outcome_notes,
        friend:knit_friends(first_name, last_name),
        member:knit_members(first_name, last_name, preferred_name)
      `,
    )
    .eq('ward_id', wardId)
    .gte('scheduled_at', ninetyAgo)
    .order('scheduled_at', { ascending: false })

  const recentRows: string[][] = (recent ?? []).map((o) => {
    const rawFriend = (o as unknown as { friend: unknown }).friend
    const friend = (Array.isArray(rawFriend) ? rawFriend[0] : rawFriend) as
      | { first_name: string; last_name: string | null }
      | null
    const rawMember = (o as unknown as { member: unknown }).member
    const member = (Array.isArray(rawMember) ? rawMember[0] : rawMember) as
      | { first_name: string | null; last_name: string | null; preferred_name: string | null }
      | null
    return [
      new Date(o.scheduled_at).toISOString().slice(0, 10),
      capitalize(o.scheduled_time_slot),
      friend ? [friend.first_name, friend.last_name].filter(Boolean).join(' ') : '—',
      member
        ? member.preferred_name ||
          [member.first_name, member.last_name].filter(Boolean).join(' ') ||
          '—'
        : '— (no member)',
      capitalize(o.status),
      o.outcome_notes ?? '',
    ]
  })

  await replaceDataRows(
    spreadsheetId,
    TABS.RECENT,
    6,
    recentRows,
    dataStartRow(TABS.RECENT),
  )

  // Member Roster + dropdowns. Extracted so the hourly pull-cron can also
  // refresh this without doing the full Available/Friends/Recent rewrite.
  await populateMemberRoster({ spreadsheetId, wardId })

  // Color-code entry cells (yellow) vs Knit-fill cells (gray). Combined with
  // the protection rules this makes the workspace much harder to break.
  await applyEntryAutoFormatting(spreadsheetId)
}

/**
 * Writes the hidden Member Roster tab (one row per ONBOARDED ward member)
 * and (re)applies the dropdown data-validation rules that depend on it.
 * Idempotent. Called from the morning push via populateDataTabs and from
 * the hourly sheets-pull so dropdowns stay in step with Tidings opt-outs
 * and member self-opt-outs without waiting a full day.
 *
 * Onboarded-only: the only consumer is now Log an Outing → Member, which
 * should never let a missionary pick someone who hasn't actually set their
 * availability yet. The old "Members to Invite" path that needed the
 * broader roster was retired in v0.38.0.
 */
export async function populateMemberRoster({
  spreadsheetId,
  wardId,
}: {
  spreadsheetId: string
  wardId: string
}) {
  const sb = supabaseAdmin()
  const { data: rosterRows } = await sb
    .from('knit_members')
    .select(
      'id, first_name, last_name, preferred_name, phone, opted_out_at, onboarding_completed_at',
    )
    .eq('ward_id', wardId)
    .is('opted_out_at', null)
    .not('onboarding_completed_at', 'is', null)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .limit(5000)

  const rosterValues: string[][] = (rosterRows ?? []).map((m) => {
    const name =
      m.preferred_name ||
      [m.first_name, m.last_name].filter(Boolean).join(' ') ||
      '—'
    return [m.id, name, m.phone ?? '']
  })
  await replaceDataRows(spreadsheetId, TABS.ROSTER, 3, rosterValues)
  await ensureRosterHiddenAndDropdowns(spreadsheetId)
}

/**
 * Makes sure the Member Roster tab is hidden, and re-installs the data
 * validation rules that drive the dropdowns on Log an Outing + Suggestions.
 * Idempotent — runs every morning push and every hourly pull.
 */
export async function ensureRosterHiddenAndDropdowns(spreadsheetId: string) {
  const meta = await getSheetMeta(spreadsheetId)
  const tabId = (name: string) => meta.tabs.find((t) => t.title === name)?.id

  const rosterId = tabId(TABS.ROSTER)
  const logOutingId = tabId(TABS.LOG_OUTING)
  const suggestionsId = tabId(TABS.SUGGESTIONS)
  const friendsId = tabId(TABS.FRIENDS)
  const addFriendId = tabId(TABS.ADD_FRIEND)
  if (!rosterId || !logOutingId || !suggestionsId || !friendsId || !addFriendId) {
    // ensureTabs will create any missing tab on the next run; bail rather
    // than partially apply.
    return
  }

  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const TIME_SLOTS = ['morning', 'afternoon', 'evening']
  const NEEDS = [
    '',
    'Host a meal',
    'Give a ride',
    'Sit in on a lesson',
    'Invite a friend to an activity',
    'Take a friend to an event',
    'Share a skill I have',
    'Share my testimony',
  ]
  const STATUSES = ['Scheduled', 'Happened', "Didn't happen", 'Rescheduled']
  const LANGUAGES = ['English', 'Spanish']
  const TEACHING_STATUSES = [
    'investigating',
    'progressing',
    'on_date',
    'baptized',
    'paused',
    'lost_contact',
  ]
  // Rolling window: the seven most recent dates (today and the six days
  // before). Recomputed every sync so the dropdown always reflects the
  // current week.
  const TODAY = new Date()
  const LAST_7_DAYS: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(TODAY)
    d.setDate(d.getDate() - i)
    LAST_7_DAYS.push(d.toISOString().slice(0, 10))
  }

  const oneOfList = (
    sheetId: number,
    startRow: number,
    endRow: number,
    col: number,
    values: string[],
    inputMessage: string,
  ): sheets_v4.Schema$Request => ({
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: startRow,
        endRowIndex: endRow,
        startColumnIndex: col,
        endColumnIndex: col + 1,
      },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: values.map((v) => ({ userEnteredValue: v })),
        },
        strict: false,
        showCustomUi: true,
        inputMessage,
      },
    },
  })

  const requests: sheets_v4.Schema$Request[] = [
    // Hide the roster tab.
    {
      updateSheetProperties: {
        properties: { sheetId: rosterId, hidden: true },
        fields: 'hidden',
      },
    },

    // Suggestions: When (day) col B, Time of day col C, Need col D dropdowns,
    // Generate col E checkbox.
    oneOfList(suggestionsId, 1, 200, 1, DAYS, 'Pick a day of the week.'),
    oneOfList(suggestionsId, 1, 200, 2, TIME_SLOTS, 'Pick morning, afternoon, or evening.'),
    oneOfList(suggestionsId, 1, 200, 3, NEEDS, 'Pick the kind of help you need (optional).'),
    {
      setDataValidation: {
        range: {
          sheetId: suggestionsId,
          startRowIndex: 1,
          endRowIndex: 200,
          startColumnIndex: 4,
          endColumnIndex: 5,
        },
        rule: {
          condition: { type: 'BOOLEAN' },
          strict: true,
          showCustomUi: true,
          inputMessage: 'Check this box when the row is ready for Knit to fill in the suggestions.',
        },
      },
    },

    // Add a Friend: Language col C dropdown, Teaching status col D dropdown.
    oneOfList(addFriendId, 1, 200, 2, LANGUAGES, 'English or Spanish.'),
    oneOfList(addFriendId, 1, 200, 3, TEACHING_STATUSES, 'Where this friend is in the teaching process.'),

    // Log an Outing — column A (Date), B (Time), E (Status) all dropdowns.
    oneOfList(logOutingId, 1, 200, 0, LAST_7_DAYS, 'Pick a date from the last 7 days.'),
    oneOfList(logOutingId, 1, 200, 1, TIME_SLOTS, 'morning, afternoon, or evening.'),
    oneOfList(logOutingId, 1, 200, 4, STATUSES, 'What happened? Pick a status.'),

    // Log an Outing, column C ("Friend") — dropdown of currently teaching friends.
    {
      setDataValidation: {
        range: {
          sheetId: logOutingId,
          startRowIndex: 1,
          endRowIndex: 200,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
        rule: {
          condition: {
            type: 'ONE_OF_RANGE',
            values: [
              { userEnteredValue: `='${TABS.FRIENDS}'!A2:A` },
            ],
          },
          strict: false,
          showCustomUi: true,
          inputMessage: 'Pick the friend from the Friends We are Teaching tab.',
        },
      },
    },
    // Log an Outing, column D ("Member") — dropdown of active members.
    {
      setDataValidation: {
        range: {
          sheetId: logOutingId,
          startRowIndex: 1,
          endRowIndex: 200,
          startColumnIndex: 3,
          endColumnIndex: 4,
        },
        rule: {
          condition: {
            type: 'ONE_OF_RANGE',
            values: [
              { userEnteredValue: `='${TABS.ROSTER}'!B2:B` },
            ],
          },
          strict: false,
          showCustomUi: true,
          inputMessage: 'Pick the member from the ward roster.',
        },
      },
    },
    // Suggestions, column A ("Friend name") — dropdown of currently teaching friends.
    {
      setDataValidation: {
        range: {
          sheetId: suggestionsId,
          startRowIndex: 1,
          endRowIndex: 200,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_RANGE',
            values: [
              { userEnteredValue: `='${TABS.FRIENDS}'!A2:A` },
            ],
          },
          strict: false,
          showCustomUi: true,
          inputMessage: 'Pick the friend from the Friends We are Teaching tab.',
        },
      },
    },
  ]

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  })
}

/**
 * Writes a "READ ONLY — DO NOT EDIT" banner in row 1 of every tab in
 * READ_ONLY_BANNER_TABS. Merges cells across A:H, paints a bright red
 * background, and bolds the white text. Idempotent — overwrites whatever
 * is currently in row 1.
 */
const BANNER_TEXT = 'READ ONLY — DO NOT EDIT. This tab is auto-managed by Knit.'
const BANNER_BG = { red: 0.86, green: 0.15, blue: 0.15 } as const // red-600
const BANNER_FG = { red: 1, green: 1, blue: 1 } as const // white
const BANNER_MERGE_WIDTH = 8

export async function writeReadOnlyBanners(spreadsheetId: string) {
  const meta = await getSheetMeta(spreadsheetId)
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })

  const requests: sheets_v4.Schema$Request[] = []
  for (const tabName of READ_ONLY_BANNER_TABS) {
    const tab = meta.tabs.find((t) => t.title === tabName)
    if (!tab) continue
    const range = {
      sheetId: tab.id,
      startRowIndex: 0,
      endRowIndex: 1,
      startColumnIndex: 0,
      endColumnIndex: BANNER_MERGE_WIDTH,
    }
    // Idempotent unmerge → merge prevents "already merged" errors.
    requests.push({ unmergeCells: { range } })
    requests.push({ mergeCells: { range, mergeType: 'MERGE_ALL' } })
    requests.push({
      updateCells: {
        range,
        rows: [
          {
            values: [
              {
                userEnteredValue: { stringValue: BANNER_TEXT },
                userEnteredFormat: {
                  backgroundColor: BANNER_BG,
                  horizontalAlignment: 'CENTER',
                  verticalAlignment: 'MIDDLE',
                  textFormat: {
                    foregroundColor: BANNER_FG,
                    bold: true,
                    fontSize: 11,
                  },
                },
              },
            ],
          },
        ],
        fields:
          'userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)',
      },
    })
  }
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    })
  }
}

/**
 * Reorders the tabs to match TAB_ORDER so Start Here sits first, the obsolete
 * ones (if not yet deleted) drift to the right, and any user-added tabs slot
 * after the Knit-managed ones. Idempotent.
 */
export async function enforceTabOrder(spreadsheetId: string) {
  const meta = await getSheetMeta(spreadsheetId)
  const requests: sheets_v4.Schema$Request[] = []
  TAB_ORDER.forEach((title, desiredIndex) => {
    const tab = meta.tabs.find((t) => t.title === title)
    if (!tab) return
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: tab.id, index: desiredIndex },
        fields: 'index',
      },
    })
  })
  if (requests.length === 0) return
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } })
}

/**
 * Deletes any tab Knit used to manage but no longer does. Lets us evolve the
 * template (drop Urgent Need, replace Members to Invite, etc.) without making
 * each ward's WML clean up by hand. Only touches tabs in OBSOLETE_TABS — user
 * tabs and current TAB_ORDER tabs are left alone.
 */
export async function removeObsoleteKnitTabs(spreadsheetId: string) {
  const meta = await getSheetMeta(spreadsheetId)
  const targets = meta.tabs.filter((t) =>
    (OBSOLETE_TABS as readonly string[]).includes(t.title),
  )
  if (targets.length === 0) return
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: targets.map((t) => ({ deleteSheet: { sheetId: t.id } })),
    },
  })
}

/**
 * Color-codes cells so missionaries can tell at a glance which cells they
 * should fill (yellow) and which Knit fills automatically (gray). Combined
 * with the protection rules in protectSpreadsheet() the gray cells are also
 * hard-locked so missionaries can't type in them.
 *
 * Idempotent — every run recomputes the formatting from scratch.
 */
const ENTRY_BG = { red: 1, green: 0.973, blue: 0.847 } as const // light yellow
const AUTO_BG = { red: 0.949, green: 0.949, blue: 0.949 } as const // light gray
const HEADER_BG = { red: 0.870, green: 0.870, blue: 0.870 } as const // darker gray

export async function applyEntryAutoFormatting(spreadsheetId: string) {
  const meta = await getSheetMeta(spreadsheetId)
  const idFor = (name: string) => meta.tabs.find((t) => t.title === name)?.id

  const suggestionsId = idFor(TABS.SUGGESTIONS)
  const logOutingId = idFor(TABS.LOG_OUTING)
  const feedbackId = idFor(TABS.FEEDBACK)
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const requests: sheets_v4.Schema$Request[] = []

  const paint = (
    sheetId: number,
    startCol: number,
    endCol: number,
    bg: { red: number; green: number; blue: number },
    bold = false,
    startRow = 1,
    endRow = 500,
  ) => {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: startRow,
          endRowIndex: endRow,
          startColumnIndex: startCol,
          endColumnIndex: endCol,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: bg,
            textFormat: bold ? { bold: true } : undefined,
          },
        },
        fields: bold
          ? 'userEnteredFormat(backgroundColor,textFormat.bold)'
          : 'userEnteredFormat.backgroundColor',
      },
    })
    // Header row always darker gray + bold.
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: startCol,
          endColumnIndex: endCol,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: HEADER_BG,
            textFormat: { bold: true },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat.bold)',
      },
    })
  }

  if (suggestionsId !== undefined) {
    // Cols A-E are entry (Friend name, When (day), Time of day, Need, Generate)
    paint(suggestionsId, 0, 5, ENTRY_BG)
    // Cols F-O are Knit-fill (#1..#5 + Why)
    paint(suggestionsId, 5, 15, AUTO_BG)
  }
  if (logOutingId !== undefined) {
    // Cols A-F are entry (Date, Time, Friend, Member, What happened, Outcome notes)
    paint(logOutingId, 0, 6, ENTRY_BG)
    // Col G (Synced) is Knit-fill
    paint(logOutingId, 6, 7, AUTO_BG)
  }
  if (feedbackId !== undefined) {
    // Cols A-B are entry (Your name, Your idea or feedback)
    paint(feedbackId, 0, 2, ENTRY_BG)
    // Cols C-D are Knit-fill (Status, Submitted at)
    paint(feedbackId, 2, 4, AUTO_BG)
  }
  const addFriendId = idFor(TABS.ADD_FRIEND)
  if (addFriendId !== undefined) {
    // Cols A-E are entry (First name, Last name, Language, Teaching status, Notes)
    paint(addFriendId, 0, 5, ENTRY_BG)
    // Cols F-G are Knit-fill (Status, Synced at)
    paint(addFriendId, 5, 7, AUTO_BG)
  }

  if (requests.length === 0) return
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  })
}

export async function provisionSpreadsheet(
  sheet: CreatedSheet,
  _wardName: string,
  wardId: string,
) {
  // populateDataTabs already runs writeAllHeaders, writeStartHere, and
  // protectSpreadsheet. Calling them again here doubled the per-ward write
  // count and burned the 60/min service-account quota.
  await populateDataTabs({ spreadsheetId: sheet.spreadsheetId, wardId })
}

/** Run the full provisioning flow against an existing sheet (user-created,
 *  shared with the service account as Editor). Idempotent — safe to re-run. */
export async function bindSpreadsheet(
  spreadsheetId: string,
  _wardName: string,
  wardId: string,
) {
  await populateDataTabs({ spreadsheetId, wardId })
}

/* ---- formatting helpers ---- */

function dayShort(d: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d] ?? '?'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function teachingStatusLabel(s: string): string {
  const map: Record<string, string> = {
    investigating: 'Investigating',
    progressing: 'Progressing',
    on_date: 'On a baptism date',
    baptized: 'Baptized',
    paused: 'Paused',
    lost_contact: 'Lost contact',
  }
  return map[s] ?? s
}

import { supabaseAdmin } from './supabaseAdmin.js'
import {
  replaceDataRows,
  writeRange,
  colLetter,
  applyProtectedRanges,
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
  AVAILABLE: 'Available This Week',
  FRIENDS: 'Friends We are Teaching',
  SUGGESTIONS: 'Suggestions',
  LOG_OUTING: 'Log an Outing',
  URGENT: 'Urgent Need',
  RECENT: 'Recent Outings',
} as const

export const TAB_ORDER: string[] = [
  TABS.START_HERE,
  TABS.AVAILABLE,
  TABS.FRIENDS,
  TABS.SUGGESTIONS,
  TABS.LOG_OUTING,
  TABS.URGENT,
  TABS.RECENT,
]

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
    'What happened',
    'Outcome notes',
    'Synced',
  ],
  [TABS.URGENT]: [
    'Need',
    'Day',
    'Time',
    'Interest hint',
    'Send to ward',
    'Replies',
  ],
  [TABS.RECENT]: [
    'Date',
    'Slot',
    'Friend',
    'Member',
    'Status',
    'Outcome notes',
  ],
}

export async function writeAllHeaders(spreadsheetId: string) {
  for (const [tab, headers] of Object.entries(HEADERS)) {
    await writeRange(spreadsheetId, `${tab}!A1:${colLetter(headers.length)}1`, [
      headers,
    ])
  }
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
  // Read-only Knit-managed tabs
  {
    tab: TABS.START_HERE,
    description: `${KNIT_PROTECT_TAG} Instructions tab — refreshed by Knit, edits will be lost`,
    warningOnly: true,
    range: 'whole-sheet',
  },
  {
    tab: TABS.AVAILABLE,
    description: `${KNIT_PROTECT_TAG} Refreshed every morning — edit member info in the Knit admin app`,
    warningOnly: true,
    range: 'whole-sheet',
  },
  {
    tab: TABS.FRIENDS,
    description: `${KNIT_PROTECT_TAG} Refreshed every morning — edit friends in the Knit admin app`,
    warningOnly: true,
    range: 'whole-sheet',
  },
  {
    tab: TABS.RECENT,
    description: `${KNIT_PROTECT_TAG} Read-only history — refreshed every morning`,
    warningOnly: true,
    range: 'whole-sheet',
  },

  // Header rows on mixed tabs — hard lock so missionaries can't break parsers
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
    tab: TABS.URGENT,
    description: `${KNIT_PROTECT_TAG} Header row — do not change column titles`,
    warningOnly: false,
    range: { startRow: 0, endRow: 1 },
  },

  // Knit-fill columns on mixed tabs — warn before editing
  {
    // Suggestions: Knit fills F:O ( #1 / Why #1 ... #5 / Why #5 )
    tab: TABS.SUGGESTIONS,
    description: `${KNIT_PROTECT_TAG} Knit fills these columns — your edits will be overwritten`,
    warningOnly: true,
    range: { startCol: 5, endCol: 15 },
  },
  {
    // Log an Outing: Knit writes ✓ in the Synced column (G)
    tab: TABS.LOG_OUTING,
    description: `${KNIT_PROTECT_TAG} Knit writes the Synced check — leave this column alone`,
    warningOnly: true,
    range: { startCol: 6, endCol: 7 },
  },
  {
    // Urgent Need: Knit writes Replies in column F
    tab: TABS.URGENT,
    description: `${KNIT_PROTECT_TAG} Knit fills the Replies column`,
    warningOnly: true,
    range: { startCol: 5, endCol: 6 },
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
    ['How to use each tab:'],
    [''],
    ['• Available This Week — who in the ward is free and what they love doing.'],
    ['  Refreshes every morning.'],
    [''],
    ['• Friends We are Teaching — the friends we are fellowshipping. Refreshes'],
    ['  every morning.'],
    [''],
    ['• Suggestions — want ideas for a friend? Fill in the friend name, day,'],
    ['  time, and (optionally) the kind of help you need. Check the Generate'],
    ['  box. Within 10 minutes we will fill in the top 5 members with reasons.'],
    [''],
    ['• Log an Outing — after an outing happens, log it here. The Synced cell'],
    ['  will flip to a checkmark once we pick it up.'],
    [''],
    ['• Urgent Need — need someone tonight? Fill this in and check Send to ward.'],
    ['  (Phase 3 — SMS integration pending.)'],
    [''],
    ['• Recent Outings — rolling 90-day read-only history.'],
    [''],
    [`Ward contact — ask your ward mission leader if anything looks off.`],
    [''],
    ['A note on protections:'],
    ['Some cells are locked or warn before editing — that\'s on purpose. Headers'],
    ['must stay exactly as they are or Knit can\'t read your entries. The'],
    ['Available, Friends, and Recent Outings tabs refresh from Knit every morning,'],
    ['so any edits you make to them will be overwritten.'],
  ]
  await writeRange(
    spreadsheetId,
    `${TABS.START_HERE}!A1`,
    lines,
  )
}

type PopulateArgs = {
  spreadsheetId: string
  wardId: string
}

/**
 * Populates the read-only data tabs (Available, Friends, Recent Outings).
 * Called on initial provisioning and on every refresh / morning-push.
 */
export async function populateDataTabs({ spreadsheetId, wardId }: PopulateArgs) {
  const sb = supabaseAdmin()

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

  const availableRows: string[][] = (members ?? [])
    .filter((m) => {
      if (m.opted_out_at) return false
      if (m.paused_until && new Date(m.paused_until).getTime() > now) return false
      return true
    })
    .map((m) => {
      const name = m.preferred_name || [m.first_name, m.last_name].filter(Boolean).join(' ')
      const availability = (m.availability ?? [])
        .map((a) => `${dayShort(a.day_of_week)} ${a.time_slot}`)
        .join(', ')
      const interests = (m.interests ?? [])
        .map((i) => {
          const tag = (i as { interest_tag: { name_en: string } | null }).interest_tag
          return tag?.name_en
        })
        .filter(Boolean)
        .join(', ')
      const willingTo = (m.styles ?? [])
        .map((s) => {
          const style = (s as { style: { label_en: string } | null }).style
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
        m.onboarding_completed_at ? '' : 'Not yet onboarded',
      ]
    })

  await replaceDataRows(spreadsheetId, TABS.AVAILABLE, 8, availableRows)

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

  await replaceDataRows(spreadsheetId, TABS.FRIENDS, 7, friendRows)

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
    const friend = o.friend as { first_name: string; last_name: string | null } | null
    const member = o.member as {
      first_name: string | null
      last_name: string | null
      preferred_name: string | null
    } | null
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

  await replaceDataRows(spreadsheetId, TABS.RECENT, 6, recentRows)
}

export async function provisionSpreadsheet(
  sheet: CreatedSheet,
  wardName: string,
  wardId: string,
) {
  await writeAllHeaders(sheet.spreadsheetId)
  await writeStartHere(sheet.spreadsheetId, wardName)
  await populateDataTabs({ spreadsheetId: sheet.spreadsheetId, wardId })
  // Apply protections last — once data is in place, missionaries can't break it.
  await protectSpreadsheet(sheet.spreadsheetId)
}

/** Run the full provisioning flow against an existing sheet (user-created,
 *  shared with the service account as Editor). Idempotent — safe to re-run. */
export async function bindSpreadsheet(
  spreadsheetId: string,
  wardName: string,
  wardId: string,
) {
  await writeAllHeaders(spreadsheetId)
  await writeStartHere(spreadsheetId, wardName)
  await populateDataTabs({ spreadsheetId, wardId })
  await protectSpreadsheet(spreadsheetId)
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

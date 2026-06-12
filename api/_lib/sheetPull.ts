import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './supabaseAdmin.js'
import {
  TABS,
  TAB_ORDER,
  getExpectedHeaders,
  populateMemberRoster,
  dataStartRow,
  headerRow,
} from './sheetSync.js'
import { colLetter, ensureTabs, getSheets, retryOn429 } from './sheets.js'
import { chicagoTimeToUtcIso } from './chicagoTime.js'
import {
  suggest,
  memberDisplayName,
  type Candidate,
  type DayOfWeek,
  type TimeSlot,
} from './suggestion.js'

/**
 * Pulls pending rows from the Suggestions and Log Outing tabs of a bound sheet.
 * Uses the service account (which has Editor access on the sheet by design).
 */

type SheetsClient = ReturnType<typeof getSheets>

/** The five missionary-entry tabs the pull scans, in prefetch order. */
const PULL_TABS = [
  TABS.SUGGESTIONS,
  TABS.LOG_OUTING,
  TABS.ADD_FRIEND,
  TABS.FRIENDS,
  TABS.FEEDBACK,
] as const

type TabPrefetch = { header: string[]; rows: string[][] }

function headerRange(tab: string): string {
  const expected = getExpectedHeaders(tab) ?? []
  const row = headerRow(tab)
  return `${tab}!A${row}:${colLetter(expected.length)}${row}`
}

function dataRange(tab: string): string {
  const expected = getExpectedHeaders(tab) ?? []
  const start = dataStartRow(tab)
  const end = tab === TABS.SUGGESTIONS ? 200 : 500
  return `${tab}!A${start}:${colLetter(expected.length)}${end}`
}

/**
 * ONE values.batchGet per spreadsheet for all 5 header rows + all 5 data
 * ranges. Each pass used to issue its own values.get (plus an unconditional
 * getSheetMeta via ensureTabs) — ~11 reads per ward per 5-minute cycle, which
 * brushed Google's 60 reads/min/user quota across 10 bindings and logged
 * intermittent "Quota exceeded" noise on the bindings.
 *
 * ensureTabs is repair-only, so it no longer runs up front: a missing tab
 * makes the batchGet fail with "Unable to parse range", and only then do we
 * repair and retry. The morning push still runs the full ensureTabs
 * reconciliation daily via populateDataTabs.
 *
 * FORMATTED_VALUE for everything: checkboxes render as 'TRUE'/'FALSE'
 * strings, which every consumer already handles.
 */
async function prefetchPullTabs(
  sheets: SheetsClient,
  spreadsheetId: string,
): Promise<Map<string, TabPrefetch>> {
  const ranges = PULL_TABS.flatMap((t) => [headerRange(t), dataRange(t)])
  const doFetch = () =>
    retryOn429(() =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
        valueRenderOption: 'FORMATTED_VALUE',
      }),
    )
  let res
  try {
    res = await doFetch()
  } catch (e) {
    if (!errMsg(e).includes('Unable to parse range')) throw e
    await ensureTabs(spreadsheetId, TAB_ORDER)
    res = await doFetch()
  }
  const out = new Map<string, TabPrefetch>()
  const vrs = res.data.valueRanges ?? []
  PULL_TABS.forEach((tab, i) => {
    out.set(tab, {
      header: (vrs[i * 2]?.values?.[0] ?? []) as string[],
      rows: (vrs[i * 2 + 1]?.values ?? []) as string[][],
    })
  })
  return out
}

export type PullReport = {
  suggestionsProcessed: number
  suggestionErrors: string[]
  outingsInserted: number
  outingErrors: string[]
  feedbackProcessed: number
  feedbackErrors: string[]
  friendsInserted: number
  friendErrors: string[]
  friendsRemoved: number
  friendRemovalErrors: string[]
  /** Tabs whose header row was repaired during this pull (drift detected and rewritten). */
  headersRepaired: string[]
}

/**
 * Compares a tab's (prefetched) header row to the canonical header set. If
 * they don't match (missing, reordered, renamed), rewrites the header row in
 * place and returns repaired=true. Hard-protected ranges still allow
 * service-account writes.
 *
 * The header row itself comes from prefetchPullTabs — which already accounts
 * for the READ ONLY banner offset via headerRow() (banner-prefixed tabs,
 * notably FRIENDS, keep headers in row 2; comparing against row 1's banner
 * text used to flag drift on every pull).
 *
 * repaired=true means the parser should skip this run (data may be in the
 * wrong columns) and let the next cron pull pick up cleanly.
 */
async function verifyAndRestoreHeaders(
  sheets: SheetsClient,
  spreadsheetId: string,
  tab: string,
  actual: string[],
): Promise<{ ok: boolean; repaired: boolean }> {
  const expected = getExpectedHeaders(tab)
  if (!expected) return { ok: true, repaired: false }

  const matches =
    actual.length === expected.length &&
    expected.every((h, i) => (actual[i] ?? '').trim() === h)

  if (matches) return { ok: true, repaired: false }

  // Rewrite headers. We don't try to interpret data rows that may be misaligned;
  // we restore the contract and let the next cycle proceed.
  await retryOn429(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange(tab),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [expected] },
    }),
  )
  return { ok: false, repaired: true }
}

export async function pullSheet(args: {
  wardId: string
  spreadsheetId: string
}): Promise<PullReport> {
  const sb = supabaseAdmin()
  const sheets = getSheets()
  const report: PullReport = {
    suggestionsProcessed: 0,
    suggestionErrors: [],
    outingsInserted: 0,
    outingErrors: [],
    feedbackProcessed: 0,
    feedbackErrors: [],
    friendsInserted: 0,
    friendErrors: [],
    friendsRemoved: 0,
    friendRemovalErrors: [],
    headersRepaired: [],
  }

  // One batched read for every tab's header + data rows (sees the lazy
  // ensureTabs repair inside). If even the repaired fetch fails, the whole
  // pull fails and the cron marks the binding error — same as before.
  const prefetch = await prefetchPullTabs(sheets, args.spreadsheetId)
  const tabData = (tab: string): TabPrefetch =>
    prefetch.get(tab) ?? { header: [], rows: [] }

  /* ---------------- Suggestions tab ---------------- */
  try {
    const check = await verifyAndRestoreHeaders(
      sheets,
      args.spreadsheetId,
      TABS.SUGGESTIONS,
      tabData(TABS.SUGGESTIONS).header,
    )
    if (check.repaired) {
      report.headersRepaired.push(TABS.SUGGESTIONS)
      report.suggestionErrors.push(
        `Suggestions tab headers were missing or changed — restored. Skipping this pass to avoid misreading data; next sync will pick up new requests.`,
      )
    } else {
      await pullSuggestions({
        sb,
        sheets,
        wardId: args.wardId,
        spreadsheetId: args.spreadsheetId,
        report,
        rows: tabData(TABS.SUGGESTIONS).rows,
      })
    }
  } catch (e) {
    report.suggestionErrors.push(errMsg(e))
  }

  /* ---------------- Log an Outing tab ---------------- */
  try {
    const check = await verifyAndRestoreHeaders(
      sheets,
      args.spreadsheetId,
      TABS.LOG_OUTING,
      tabData(TABS.LOG_OUTING).header,
    )
    if (check.repaired) {
      report.headersRepaired.push(TABS.LOG_OUTING)
      report.outingErrors.push(
        `Log an Outing tab headers were missing or changed — restored. Skipping this pass to avoid misreading data; next sync will pick up new entries.`,
      )
    } else {
      await pullOutings({
        sb,
        sheets,
        wardId: args.wardId,
        spreadsheetId: args.spreadsheetId,
        report,
        rows: tabData(TABS.LOG_OUTING).rows,
      })
    }
  } catch (e) {
    report.outingErrors.push(errMsg(e))
  }

  /* ---------------- Add a Friend tab ---------------- */
  try {
    const check = await verifyAndRestoreHeaders(
      sheets,
      args.spreadsheetId,
      TABS.ADD_FRIEND,
      tabData(TABS.ADD_FRIEND).header,
    )
    if (check.repaired) {
      report.headersRepaired.push(TABS.ADD_FRIEND)
      report.friendErrors.push(
        'Add a Friend tab headers were missing or changed — restored. Skipping this pass.',
      )
    } else {
      await pullAddFriend({
        sb,
        sheets,
        wardId: args.wardId,
        spreadsheetId: args.spreadsheetId,
        report,
        rows: tabData(TABS.ADD_FRIEND).rows,
      })
    }
  } catch (e) {
    report.friendErrors.push(errMsg(e))
  }

  /* ---------------- Friends We are Teaching tab (Remove?) ---------------- */
  try {
    const check = await verifyAndRestoreHeaders(
      sheets,
      args.spreadsheetId,
      TABS.FRIENDS,
      tabData(TABS.FRIENDS).header,
    )
    if (check.repaired) {
      report.headersRepaired.push(TABS.FRIENDS)
      report.friendRemovalErrors.push(
        'Friends We are Teaching tab headers were missing or changed — restored. Skipping removal pass.',
      )
    } else {
      await pullFriendRemovals({
        sb,
        sheets,
        wardId: args.wardId,
        spreadsheetId: args.spreadsheetId,
        report,
        rows: tabData(TABS.FRIENDS).rows,
      })
    }
  } catch (e) {
    report.friendRemovalErrors.push(errMsg(e))
  }

  /* ---------------- Send Feedback tab ---------------- */
  try {
    const check = await verifyAndRestoreHeaders(
      sheets,
      args.spreadsheetId,
      TABS.FEEDBACK,
      tabData(TABS.FEEDBACK).header,
    )
    if (check.repaired) {
      report.headersRepaired.push(TABS.FEEDBACK)
      report.feedbackErrors.push(
        'Send Feedback tab headers were missing or changed — restored. Skipping this pass.',
      )
    } else {
      await pullFeedback({
        sb,
        sheets,
        wardId: args.wardId,
        spreadsheetId: args.spreadsheetId,
        report,
        rows: tabData(TABS.FEEDBACK).rows,
      })
    }
  } catch (e) {
    report.feedbackErrors.push(errMsg(e))
  }

  // Refresh the hidden Member Roster + dropdown ranges so any membership
  // change (Tidings sync, member self-opt-out) propagates into the sheet
  // within the hour rather than waiting for the next morning push.
  try {
    await populateMemberRoster({
      spreadsheetId: args.spreadsheetId,
      wardId: args.wardId,
    })
  } catch (e) {
    report.feedbackErrors.push(`roster refresh failed: ${errMsg(e)}`)
  }

  return report
}

/**
 * Processes the Members to Invite tab. For each row where the missionary
 * has checked "Send invite?" and "Sent at" is still blank, look up the
 * matching knit_members row, generate a magic link, write the link + a
 * timestamp back into the sheet. (Retired in v0.38.0 in favor of the
 * self-service /join page; this block is now pullFeedback().)
 */
async function pullFeedback(args: {
  sb: SupabaseClient
  sheets: SheetsClient
  wardId: string
  spreadsheetId: string
  report: PullReport
  /** Prefetched data rows (see prefetchPullTabs). */
  rows: string[][]
}) {
  const { sb, sheets, wardId, spreadsheetId, report, rows } = args
  if (rows.length === 0) return

  // Lazy-load ward name for the suggestion context.
  let wardName: string | null = null
  const wardLookup = async () => {
    if (wardName !== null) return wardName
    const { data } = await sb
      .from('knit_wards')
      .select('name')
      .eq('id', wardId)
      .maybeSingle()
    wardName = (data as { name?: string } | null)?.name ?? wardId
    return wardName
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2
    const name = (row[0] ?? '').trim()
    const body = (row[1] ?? '').trim()
    const status = (row[2] ?? '').trim()
    const submittedAt = (row[3] ?? '').trim()

    // Skip blanks and rows we've already processed.
    if (!body) continue
    if (submittedAt) continue

    const ward = await wardLookup()
    const stamp = new Date().toISOString()
    const submittedLabel = name || 'Missionary (sheet)'
    const pageUrl = `sheet:${ward}:${TABS.FEEDBACK}`

    // Idempotency: insert-then-stamp means a failed stamp (or a concurrent
    // pull) re-inserts the same feedback on the next run. If an identical
    // recent submission exists, skip the insert but still stamp the row.
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data: dupe, error: dupeErr } = await sb
      .from('app_suggestions')
      .select('id')
      .eq('app', 'knit')
      .eq('suggestion', body)
      .eq('page_url', pageUrl)
      .gte('created_at', weekAgo)
      .limit(1)
      .maybeSingle()
    if (dupeErr) {
      report.feedbackErrors.push(`Row ${rowNum}: dedupe check failed: ${dupeErr.message}`)
      continue
    }

    if (!dupe) {
      const { error: insertErr } = await sb.from('app_suggestions').insert({
        app: 'knit',
        suggestion: body,
        submitted_by_name: submittedLabel,
        submitted_by_email: null,
        submitted_by_user_id: null,
        page_url: pageUrl,
        user_agent: 'knit-sheet-feedback',
        status: 'open',
      })
      if (insertErr) {
        report.feedbackErrors.push(`Row ${rowNum}: ${insertErr.message}`)
        continue
      }
    }

    // Stamp Status + Submitted at (cols C, D) so the missionary sees it landed.
    await retryOn429(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${TABS.FEEDBACK}!C${rowNum}:D${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['Received ✓', stamp.slice(0, 10)]],
        },
      }),
    )
    report.feedbackProcessed += 1
  }
}

/**
 * Reads the Add a Friend tab. Each row with First name + Last name + empty
 * Synced at gets inserted into knit_friends with the missionary's notes and
 * the teaching status they picked. After insert we stamp Status + Synced at
 * back into the row so the missionary sees it landed; the existing row stays
 * on this tab for their reference until they choose to delete it.
 */
async function pullAddFriend(args: {
  sb: SupabaseClient
  sheets: SheetsClient
  wardId: string
  spreadsheetId: string
  report: PullReport
  /** Prefetched data rows (see prefetchPullTabs). */
  rows: string[][]
}) {
  const { sb, sheets, wardId, spreadsheetId, report, rows } = args
  if (rows.length === 0) return

  const VALID_TEACHING_STATUSES = new Set([
    'investigating',
    'progressing',
    'on_date',
    'baptized',
    'paused',
    'lost_contact',
  ])

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2
    const firstName = (row[0] ?? '').trim()
    const lastName = (row[1] ?? '').trim()
    const languageRaw = (row[2] ?? '').trim().toLowerCase()
    const teachingStatus = (row[3] ?? '').trim().toLowerCase()
    const notes = (row[4] ?? '').trim()
    const syncedAt = (row[6] ?? '').trim()

    if (!firstName) continue
    if (syncedAt) continue

    const locale = languageRaw.startsWith('s') ? 'es' : 'en'
    const ts = VALID_TEACHING_STATUSES.has(teachingStatus)
      ? teachingStatus
      : 'investigating'

    // Idempotency: a failed stamp-back (or a concurrent pull) used to
    // re-insert the same friend on the next run. If an active friend with
    // this exact name already exists, skip the insert but still stamp.
    let existQuery = sb
      .from('knit_friends')
      .select('id')
      .eq('ward_id', wardId)
      .is('removed_at', null)
      .ilike('first_name', firstName)
    existQuery = lastName
      ? existQuery.ilike('last_name', lastName)
      : existQuery.is('last_name', null)
    const { data: existing, error: existErr } = await existQuery.limit(1).maybeSingle()
    if (existErr) {
      report.friendErrors.push(`Row ${rowNum}: dedupe check failed: ${existErr.message}`)
      continue
    }

    if (!existing) {
      const { error: insertErr } = await sb.from('knit_friends').insert({
        ward_id: wardId,
        first_name: firstName,
        last_name: lastName || null,
        locale,
        teaching_status: ts,
        notes: notes || null,
        added_by: 'Missionary sheet',
      })
      if (insertErr) {
        report.friendErrors.push(`Row ${rowNum}: ${insertErr.message}`)
        continue
      }
      report.friendsInserted += 1
    }
    const stamp = new Date().toISOString().slice(0, 10)
    await retryOn429(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${TABS.ADD_FRIEND}!F${rowNum}:G${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[existing ? 'Already added ✓' : 'Added ✓', stamp]] },
      }),
    )
  }
}

/**
 * Reads the Friends We are Teaching tab for rows with Remove? checked.
 * For each, finds the matching knit_friends row by name + ward, stamps
 * removed_at = now(), and copies the missionary's Reason into
 * removed_reason. The row will fall off the next morning push because
 * populateDataTabs filters `removed_at IS NULL`.
 *
 * Dedup safety: shared_emails matching is by lowercased "First Last".
 * If two friends share the same display name in the same ward, the most
 * recently added wins — that's already how missionaries refer to them
 * in conversation. If neither matches, we record a friendRemovalErrors
 * line so the WML can investigate.
 */
async function pullFriendRemovals(args: {
  sb: SupabaseClient
  sheets: SheetsClient
  wardId: string
  spreadsheetId: string
  report: PullReport
  /** Prefetched data rows (see prefetchPullTabs). FORMATTED_VALUE, so the
   *  Remove? checkbox arrives as the string 'TRUE'/'FALSE' rather than the
   *  boolean the old UNFORMATTED_VALUE read returned — the check below
   *  handles both. */
  rows: string[][]
}) {
  const { sb, sheets, wardId, spreadsheetId, report, rows } = args
  const dataStart = dataStartRow(TABS.FRIENDS) // 1-indexed row of first data row
  if (rows.length === 0) return

  // Hydrate ward's active friends ONCE so we can match by display name.
  const { data: activeFriends } = await sb
    .from('knit_friends')
    .select('id, first_name, last_name, added_at')
    .eq('ward_id', wardId)
    .is('removed_at', null)
    .order('added_at', { ascending: false })
  const byName = new Map<string, { id: string; addedAt: string }>()
  for (const f of (activeFriends ?? []) as Array<{
    id: string
    first_name: string
    last_name: string | null
    added_at: string
  }>) {
    const key = [f.first_name, f.last_name].filter(Boolean).join(' ').toLowerCase().trim()
    if (!key) continue
    // Most recently added wins — already sorted DESC by added_at.
    if (!byName.has(key)) byName.set(key, { id: f.id, addedAt: f.added_at })
  }

  // Column indexes match the HEADERS[TABS.FRIENDS] order: Friend (0),
  // Language (1), Interests (2), Teaching status (3), Typical availability (4),
  // Total outings (5), Days since last (6), Remove? (7), Reason (8).
  const NAME_COL = 0
  const REMOVE_COL = 7
  const REASON_COL = 8

  const rowsToClear: number[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    // FORMATTED_VALUE renders the checkbox as 'TRUE'/'FALSE'.
    const remove = String(row[REMOVE_COL] ?? '').toUpperCase() === 'TRUE'
    if (!remove) continue

    const sheetRowNum = dataStart + i // 1-indexed sheet row of this entry
    const displayName = String(row[NAME_COL] ?? '').trim()
    const reason = String(row[REASON_COL] ?? '').trim()
    if (!displayName) {
      report.friendRemovalErrors.push(
        `Row ${sheetRowNum}: Remove? checked but no friend name in column A.`,
      )
      continue
    }
    const match = byName.get(displayName.toLowerCase())
    if (!match) {
      report.friendRemovalErrors.push(
        `Row ${sheetRowNum}: couldn't find an active friend named "${displayName}" — already removed?`,
      )
      // Still queue the row for clearing so the missionary doesn't see the
      // stale check next time.
      rowsToClear.push(sheetRowNum)
      continue
    }

    const { error: updErr } = await sb
      .from('knit_friends')
      .update({
        removed_at: new Date().toISOString(),
        removed_reason: reason || null,
      })
      .eq('id', match.id)
      .is('removed_at', null) // race guard against concurrent admin-side removal
    if (updErr) {
      report.friendRemovalErrors.push(
        `Row ${sheetRowNum} (${displayName}): ${updErr.message}`,
      )
      continue
    }

    // Append reason to notes for visibility on /admin/friends. Two-step is
    // fine: this loop iterates a small number of rows per pull.
    if (reason) {
      const { data: f } = await sb
        .from('knit_friends')
        .select('notes')
        .eq('id', match.id)
        .single()
      const stampedNote = `[Removed via sheet] ${reason}`
      const merged = f?.notes ? `${f.notes}\n${stampedNote}` : stampedNote
      await sb
        .from('knit_friends')
        .update({ notes: merged })
        .eq('id', match.id)
    }

    report.friendsRemoved += 1
    rowsToClear.push(sheetRowNum)
  }

  // Clear the Remove? + Reason cells we just processed so the same request
  // doesn't keep firing on every 5-min pull. One batchUpdate instead of a
  // write per row — each values.update counted against the 60/min quota.
  if (rowsToClear.length > 0) {
    await retryOn429(() =>
      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: rowsToClear.map((sheetRowNum) => ({
            range: `${TABS.FRIENDS}!H${sheetRowNum}:I${sheetRowNum}`,
            values: [[false, '']],
          })),
        },
      }),
    )
  }
}

async function pullSuggestions(args: {
  sb: SupabaseClient
  sheets: SheetsClient
  wardId: string
  spreadsheetId: string
  report: PullReport
  /** Prefetched data rows (see prefetchPullTabs). */
  rows: string[][]
}) {
  const { sb, sheets, wardId, spreadsheetId, report, rows } = args
  if (rows.length === 0) return

  // The Generate checkbox (col E): Start Here tells missionaries to check it
  // when the row is ready. The parser previously ignored it and processed any
  // row with friend+day+slot — including rows still being typed.
  const isGenerateChecked = (row: string[]) =>
    String(row[4] ?? '').trim().toUpperCase() === 'TRUE'
  const isPending = (row: string[]) =>
    isGenerateChecked(row) && !(row[5] ?? '').trim()

  // Only pay for the member/friend/outing preloads when at least one row is
  // actually pending — previously any non-empty Suggestions tab (including
  // fully processed rows) triggered the full ward preload every 5 minutes.
  if (!rows.some(isPending)) return

  // Preload data we'll reuse across rows
  const { data: friends } = await sb
    .from('knit_friends')
    .select('id, first_name, last_name, nickname, locale, interest_tag_ids')
    .eq('ward_id', wardId)
    .is('removed_at', null)
  const { data: members } = await sb
    .from('knit_members')
    .select(
      `id, first_name, last_name, preferred_name, locale,
       paused_until, opted_out_at,
       availability:knit_availability_baselines(day_of_week, time_slot),
       interests:knit_member_interests(interest_tag_id),
       styles:knit_member_participation_styles(style_key)`,
    )
    .eq('ward_id', wardId)
    .not('onboarding_completed_at', 'is', null)
    .limit(2000)
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString()
  const { data: outings } = await sb
    .from('knit_outings')
    .select('id, member_id, friend_id, status, scheduled_at')
    .eq('ward_id', wardId)
    .gte('scheduled_at', ninetyAgo)
  const { data: styles } = await sb
    .from('knit_participation_styles')
    .select('key, label_en')
  const { data: allTags } = await sb
    .from('knit_interest_tags')
    .select('id, name_en')

  const styleLabelByKey = new Map<string, string>()
  const styleKeyByLabel = new Map<string, string>()
  for (const s of (styles ?? []) as { key: string; label_en: string }[]) {
    styleLabelByKey.set(s.key, s.label_en)
    styleKeyByLabel.set(s.label_en.toLowerCase(), s.key)
  }
  const interestNameById = new Map<string, string>()
  for (const t of (allTags ?? []) as { id: string; name_en: string }[]) {
    interestNameById.set(t.id, t.name_en)
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // 1-based, plus header

    const friendName = (row[0] ?? '').trim()
    const dayRaw = (row[1] ?? '').trim()
    const slotRaw = (row[2] ?? '').trim()
    const needRaw = (row[3] ?? '').trim()
    const alreadyFilled = (row[5] ?? '').trim()

    if (!friendName && !dayRaw && !slotRaw) continue // empty row
    if (alreadyFilled) continue // already processed (col F non-empty)
    // Respect the Generate checkbox: a half-typed row isn't a request yet.
    if (!isGenerateChecked(row)) continue
    if (!friendName || !dayRaw || !slotRaw) {
      report.suggestionErrors.push(
        `Row ${rowNum}: need friend + day + time to generate suggestions`,
      )
      continue
    }

    const day = parseDayOfWeek(dayRaw)
    if (day === null) {
      report.suggestionErrors.push(
        `Row ${rowNum}: couldn't parse day "${dayRaw}"`,
      )
      continue
    }
    const slot = parseTimeSlot(slotRaw)
    if (slot === null) {
      report.suggestionErrors.push(
        `Row ${rowNum}: couldn't parse time of day "${slotRaw}" (use morning / afternoon / evening)`,
      )
      continue
    }
    const need = needRaw ? matchStyleKey(needRaw, styleKeyByLabel) : null
    if (needRaw && !need) {
      // Soft failure: log and proceed without need filter
      report.suggestionErrors.push(
        `Row ${rowNum}: couldn't match need "${needRaw}"; suggesting anyway without a need filter`,
      )
    }

    const friend = matchFriend(friendName, friends ?? [])
    if (!friend) {
      report.suggestionErrors.push(
        `Row ${rowNum}: couldn't find a friend named "${friendName}"`,
      )
      continue
    }

    const result = suggest({
      friend: {
        id: friend.id,
        first_name: friend.first_name,
        locale: friend.locale,
        interest_tag_ids: friend.interest_tag_ids,
      },
      dayOfWeek: day,
      timeSlot: slot,
      need,
      candidates: (members ?? []) as Candidate[],
      recentOutings: outings ?? [],
      interestNameById,
      styleLabelByKey,
    })

    // Write columns F-O for this row: #1, Why #1, #2, Why #2, ... #5, Why #5
    const topCells: string[] = []
    for (let k = 0; k < 5; k++) {
      const s = result.top[k]
      if (s) {
        topCells.push(memberDisplayName(s.candidate))
        topCells.push(s.reasons.join(' · '))
      } else {
        topCells.push('')
        topCells.push('')
      }
    }
    if (result.hint && !result.top.length) {
      // No matches: col F (the "already processed" marker) MUST still get a
      // value — leaving it empty meant the row was re-processed (and a fresh
      // audit row inserted) on every 5-minute pull, forever.
      topCells[0] = '— no matches —'
      topCells[1] = result.hint
    }

    // Write E:O — uncheck Generate alongside the fill so the checkbox state
    // reads as "done" and the row can't re-trigger.
    await retryOn429(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${TABS.SUGGESTIONS}!E${rowNum}:O${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[false, ...topCells]] },
      }),
    )

    // Log the audit row (useful for analytics later)
    await sb.from('knit_outing_suggestions').insert({
      friend_id: friend.id,
      time_slot_requested: slot,
      suggested_member_ids: result.top.map((s) => s.candidate.id),
      suggestion_reasons: Object.fromEntries(
        result.top.map((s) => [s.candidate.id, s.reasons]),
      ),
    })

    report.suggestionsProcessed += 1
  }
}

async function pullOutings(args: {
  sb: SupabaseClient
  sheets: SheetsClient
  wardId: string
  spreadsheetId: string
  report: PullReport
  /** Prefetched data rows (see prefetchPullTabs). */
  rows: string[][]
}) {
  const { sb, sheets, wardId, spreadsheetId, report, rows } = args
  if (rows.length === 0) return

  const { data: friends } = await sb
    .from('knit_friends')
    .select('id, first_name, last_name, nickname')
    .eq('ward_id', wardId)
    .is('removed_at', null)
  const { data: members } = await sb
    .from('knit_members')
    .select('id, first_name, last_name, preferred_name')
    .eq('ward_id', wardId)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    const dateRaw = (row[0] ?? '').trim()
    const timeRaw = (row[1] ?? '').trim()
    const friendName = (row[2] ?? '').trim()
    const memberName = (row[3] ?? '').trim()
    const statusRaw = (row[4] ?? '').trim()
    const notes = (row[5] ?? '').trim()
    const synced = (row[6] ?? '').trim()

    if (!dateRaw && !friendName) continue // empty
    if (synced) continue // already processed
    if (!dateRaw || !friendName) {
      report.outingErrors.push(
        `Row ${rowNum}: need at least date + friend name`,
      )
      continue
    }

    const date = parseDate(dateRaw)
    if (!date) {
      report.outingErrors.push(
        `Row ${rowNum}: couldn't parse date "${dateRaw}" (try YYYY-MM-DD)`,
      )
      continue
    }
    const slot = parseTimeSlot(timeRaw) ?? 'evening'
    const scheduledAt = composeScheduledAt(date, slot)

    const friend = matchFriend(friendName, friends ?? [])
    if (!friend) {
      report.outingErrors.push(
        `Row ${rowNum}: couldn't find friend "${friendName}"`,
      )
      continue
    }

    let memberId: string | null = null
    if (memberName) {
      const m = matchMember(memberName, members ?? [])
      if (!m) {
        report.outingErrors.push(
          `Row ${rowNum}: couldn't find member "${memberName}"`,
        )
        continue
      }
      memberId = m.id
    }

    const status = parseOutingStatus(statusRaw) ?? 'happened'

    const { error } = await sb.from('knit_outings').insert({
      ward_id: wardId,
      friend_id: friend.id,
      member_id: memberId,
      scheduled_at: scheduledAt,
      scheduled_time_slot: slot,
      status,
      outcome_notes: notes || null,
      logged_by: 'missionary_sheet',
      logged_at: new Date().toISOString(),
    })

    // 23505 = the knit_outings_sheet_dedupe_idx unique index caught a
    // duplicate (a previous run inserted this outing but its ✓ stamp-back
    // failed, or a concurrent pull won the race). The outing is in the DB —
    // treat as success so the row finally gets its checkmark instead of
    // re-inserting forever.
    const isDupe = error?.code === '23505'
    if (error && !isDupe) {
      report.outingErrors.push(`Row ${rowNum}: ${error.message}`)
      continue
    }

    // Write checkmark in Synced column
    await retryOn429(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${TABS.LOG_OUTING}!G${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['✓']] },
      }),
    )

    if (!isDupe) report.outingsInserted += 1
  }
}

/* ------- Parsing + matching helpers ------- */

function parseDayOfWeek(raw: string): DayOfWeek | null {
  const s = raw.toLowerCase().trim()
  const map: Record<string, DayOfWeek> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  }
  return map[s] ?? null
}

function parseTimeSlot(raw: string): TimeSlot | null {
  const s = raw.toLowerCase().trim()
  if (s.startsWith('morn') || s === 'am') return 'morning'
  if (s.startsWith('after') || s === 'pm' || s === 'noon') return 'afternoon'
  if (s.startsWith('even') || s === 'night') return 'evening'
  return null
}

function matchStyleKey(
  raw: string,
  styleKeyByLabel: Map<string, string>,
): string | null {
  const s = raw.toLowerCase().trim()
  if (styleKeyByLabel.has(s)) return styleKeyByLabel.get(s)!
  // key-form match (user might type "host_meal")
  for (const [label, key] of styleKeyByLabel) {
    if (key.toLowerCase() === s) return key
    if (label.includes(s) || s.includes(label)) return key
  }
  return null
}

type FriendLookup = {
  id: string
  first_name: string
  last_name: string | null
  nickname: string | null
}

// Generic over the row shape: pullSuggestions passes rows with locale +
// interest_tag_ids, pullOutings only the name columns.
function matchFriend<T extends FriendLookup>(
  name: string,
  friends: T[],
): T | null {
  const s = name.toLowerCase().trim()
  const exactFullMatches = friends.filter((f) => {
    const full = [f.first_name, f.last_name].filter(Boolean).join(' ').toLowerCase()
    return full === s
  })
  if (exactFullMatches.length === 1) return exactFullMatches[0]
  const nickMatches = friends.filter(
    (f) => (f.nickname ?? '').toLowerCase() === s,
  )
  if (nickMatches.length === 1) return nickMatches[0]
  const firstMatches = friends.filter(
    (f) => f.first_name.toLowerCase() === s,
  )
  if (firstMatches.length === 1) return firstMatches[0]
  return null
}

function matchMember(
  name: string,
  members: Array<{
    id: string
    first_name: string | null
    last_name: string | null
    preferred_name: string | null
  }>,
): (typeof members)[number] | null {
  const s = name.toLowerCase().trim()
  const preferredMatches = members.filter(
    (m) => (m.preferred_name ?? '').toLowerCase() === s,
  )
  if (preferredMatches.length === 1) return preferredMatches[0]
  const fullMatches = members.filter((m) => {
    const full = [m.first_name, m.last_name].filter(Boolean).join(' ').toLowerCase()
    return full === s
  })
  if (fullMatches.length === 1) return fullMatches[0]
  const firstMatches = members.filter(
    (m) => (m.first_name ?? '').toLowerCase() === s,
  )
  if (firstMatches.length === 1) return firstMatches[0]
  return null
}

function parseDate(raw: string): Date | null {
  // Try ISO / locale-neutral first
  const parsed = Date.parse(raw)
  if (!Number.isNaN(parsed)) return new Date(parsed)
  // M/D/YYYY fallback
  const m = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/)
  if (m) {
    let y = parseInt(m[3], 10)
    if (y < 100) y += 2000
    const mo = parseInt(m[1], 10) - 1
    const d = parseInt(m[2], 10)
    return new Date(Date.UTC(y, mo, d, 12, 0, 0))
  }
  return null
}

function composeScheduledAt(date: Date, slot: TimeSlot): string {
  // The slot hour is CHICAGO wall-clock time. setHours() on a UTC server put
  // "evening" at 19:00 UTC = 1–2pm Chicago, shifting every days-since-last
  // calculation by 5–6 hours. parseDate anchors the date in UTC (midnight or
  // noon), so the UTC Y/M/D fields are the calendar date the missionary picked.
  const hour = slot === 'morning' ? 9 : slot === 'afternoon' ? 14 : 19
  return chicagoTimeToUtcIso(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
  )
}

function parseOutingStatus(raw: string): string | null {
  const s = raw.toLowerCase().trim()
  // Canonical DB enum values stay valid for backward compat.
  const valid = [
    'scheduled',
    'happened',
    'flaked',
    'rescheduled',
    'canceled',
    'needs_checkin',
  ]
  if (valid.includes(s)) return s
  // Map the sheet's 4 dropdown labels (and a few common synonyms) to the
  // DB enum. "Didn't happen" is the new app/sheet label for what the DB
  // calls 'flaked'.
  if (s.startsWith("didn") || s === 'flake' || s === 'no-show' || s === 'missed')
    return 'flaked'
  if (s.startsWith('happen') || s === 'done' || s === 'completed' || s === 'yes')
    return 'happened'
  if (s === 'cancelled') return 'canceled'
  if (s === 'reschedule') return 'rescheduled'
  return null
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

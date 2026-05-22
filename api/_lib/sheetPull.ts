import { google } from 'googleapis'
import { supabaseAdmin } from './supabaseAdmin.js'
import { TABS, getExpectedHeaders } from './sheetSync.js'
import { colLetter } from './sheets.js'
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

type SheetsClient = ReturnType<typeof google.sheets>

function getSheetsClient(): SheetsClient {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const keyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  if (!email || !keyRaw) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set',
    )
  }
  const jwt = new google.auth.JWT({
    email,
    key: keyRaw.replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  })
  return google.sheets({ version: 'v4', auth: jwt })
}

export type PullReport = {
  suggestionsProcessed: number
  suggestionErrors: string[]
  outingsInserted: number
  outingErrors: string[]
  invitesProcessed: number
  invitesErrors: string[]
  /** Tabs whose header row was repaired during this pull (drift detected and rewritten). */
  headersRepaired: string[]
}

/**
 * Reads row 1 of a tab and compares to the canonical header set. If they don't
 * match (missing, reordered, renamed), rewrites the header row in place and
 * returns true. Hard-protected ranges still allow service-account writes.
 *
 * Returning true means the parser should still skip this run (data may be in
 * the wrong columns) and let the next cron pull pick up cleanly.
 */
async function verifyAndRestoreHeaders(
  sheets: SheetsClient,
  spreadsheetId: string,
  tab: string,
): Promise<{ ok: boolean; repaired: boolean }> {
  const expected = getExpectedHeaders(tab)
  if (!expected) return { ok: true, repaired: false }

  const range = `${tab}!A1:${colLetter(expected.length)}1`
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const actual = (res.data.values?.[0] ?? []) as string[]

  const matches =
    actual.length === expected.length &&
    expected.every((h, i) => (actual[i] ?? '').trim() === h)

  if (matches) return { ok: true, repaired: false }

  // Rewrite headers. We don't try to interpret data rows that may be misaligned;
  // we restore the contract and let the next cycle proceed.
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [expected] },
  })
  return { ok: false, repaired: true }
}

export async function pullSheet(args: {
  wardId: string
  spreadsheetId: string
}): Promise<PullReport> {
  const sb = supabaseAdmin()
  const sheets = getSheetsClient()
  const report: PullReport = {
    suggestionsProcessed: 0,
    suggestionErrors: [],
    outingsInserted: 0,
    outingErrors: [],
    invitesProcessed: 0,
    invitesErrors: [],
    headersRepaired: [],
  }

  /* ---------------- Suggestions tab ---------------- */
  try {
    const check = await verifyAndRestoreHeaders(
      sheets,
      args.spreadsheetId,
      TABS.SUGGESTIONS,
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
      })
    }
  } catch (e) {
    report.outingErrors.push(errMsg(e))
  }

  /* ---------------- Members to Invite tab ---------------- */
  try {
    const check = await verifyAndRestoreHeaders(
      sheets,
      args.spreadsheetId,
      TABS.INVITE_MEMBERS,
    )
    if (check.repaired) {
      report.headersRepaired.push(TABS.INVITE_MEMBERS)
      report.invitesErrors.push(
        'Members to Invite tab headers were missing or changed — restored. Skipping this pass.',
      )
    } else {
      await pullInvites({
        sb,
        sheets,
        wardId: args.wardId,
        spreadsheetId: args.spreadsheetId,
        report,
      })
    }
  } catch (e) {
    report.invitesErrors.push(errMsg(e))
  }

  return report
}

/**
 * Processes the Members to Invite tab. For each row where the missionary
 * has checked "Send invite?" and "Sent at" is still blank, look up the
 * matching knit_members row, generate a magic link, write the link + a
 * timestamp back into the sheet.
 *
 * Server-side auto-send: when the matched member has an email AND the
 * RESEND_API_KEY env var is set, this function POSTs to Resend's send API
 * with a short pre-formatted invitation. On success the row gets
 * "Emailed YYYY-MM-DD" in the Status column. If the email send fails or
 * the member has no email on file, we fall back to the v0.31.0 behavior:
 * write the link + a Sent At timestamp to the sheet so the missionary can
 * copy + send manually. SMS auto-send is still a follow-up (would require
 * cross-project plumbing to Tidings' Twilio integration).
 */
async function sendInviteEmail(
  toEmail: string,
  firstName: string,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not set' }

  const from = process.env.KNIT_INVITE_FROM ?? 'Knit <noreply@gathered.app>'
  const subject = 'Your Knit availability survey'
  const text = `Hi ${firstName || 'there'},

Here's your personal link to fill in your Knit availability so the missionaries can pair you with people who'd be a great fit for the times you're free. Takes about a minute.

${url}

This link is unique to you and valid for 30 days. Thanks!`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: toEmail, subject, text }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 180)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function sendInviteSms(
  toPhone: string,
  firstName: string,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const smsUrl = process.env.TIDINGS_SMS_URL
  const secret = process.env.TIDINGS_INTERNAL_FN_SECRET
  if (!smsUrl || !secret) return { ok: false, error: 'TIDINGS_SMS_URL / TIDINGS_INTERNAL_FN_SECRET not set' }

  const body = `Hi ${firstName || 'there'} — here's your Knit availability survey so we can pair you with missionaries you'd be a great fit for. Takes about a minute. ${url}`

  try {
    const res = await fetch(smsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone: toPhone, body, audit_tag: 'knit-invite' }),
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `gather-send-invite-sms ${res.status}: ${text.slice(0, 180)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function pullInvites(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any
  sheets: SheetsClient
  wardId: string
  spreadsheetId: string
  report: PullReport
}) {
  const { sb, sheets, wardId, spreadsheetId, report } = args
  const expected = getExpectedHeaders(TABS.INVITE_MEMBERS) ?? []
  const range = `${TABS.INVITE_MEMBERS}!A2:${colLetter(expected.length)}500`

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = (res.data.values ?? []) as string[][]
  if (rows.length === 0) return

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // 1-indexed, +1 for header
    const fullName = (row[0] ?? '').trim()
    const phone = (row[1] ?? '').trim()
    const email = (row[2] ?? '').trim()
    const sendFlag = (row[3] ?? '').trim().toLowerCase()
    const sentAt = (row[6] ?? '').trim()

    // Skip if not requested, already sent, or no name
    if (!fullName) continue
    const isChecked =
      sendFlag === 'true' || sendFlag === 'yes' || sendFlag === 'y' || sendFlag === '✓' || sendFlag === '✔'
    if (!isChecked) continue
    if (sentAt) continue

    // Find the member. Match by ward + (name OR phone OR email).
    // Names are split first_name + last_name in the table; reconstruct full
    // name (or use preferred_name when set) and match case-insensitive.
    const { data: candidates, error } = await sb
      .from('knit_members')
      .select('id, first_name, last_name, preferred_name, phone, email, opted_out_at')
      .eq('ward_id', wardId)
    if (error) {
      report.invitesErrors.push(`Row ${rowNum}: ${error.message}`)
      continue
    }
    const normalizedName = fullName.toLowerCase()
    const normalizedPhone = phone.replace(/[\s\-()+]/g, '')
    const normalizedEmail = email.toLowerCase()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = (candidates ?? []).find((m: any) => {
      if (m.opted_out_at) return false
      const memberFull = (m.preferred_name || [m.first_name, m.last_name].filter(Boolean).join(' ')).toLowerCase()
      if (memberFull && memberFull === normalizedName) return true
      if (normalizedPhone && (m.phone ?? '').replace(/[\s\-()+]/g, '') === normalizedPhone) return true
      if (normalizedEmail && (m.email ?? '').toLowerCase() === normalizedEmail) return true
      return false
    })

    if (!match) {
      // Write a not-found status; clear send flag so this row doesn't keep retrying.
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${TABS.INVITE_MEMBERS}!D${rowNum}:E${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['', 'Not found — add them in /admin/members first']] },
      })
      report.invitesErrors.push(`Row ${rowNum}: no matching knit_members row for "${fullName}"`)
      continue
    }

    // Generate the magic link
    const { data: token, error: tokenErr } = await sb.rpc('knit_generate_member_magic_link', {
      p_member_id: match.id,
    })
    if (tokenErr || !token) {
      report.invitesErrors.push(`Row ${rowNum}: ${tokenErr?.message ?? 'no token returned'}`)
      continue
    }

    const origin =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.VITE_APP_URL ??
      'https://knit-app.vercel.app'
    const url = `${origin}/m/${match.id}/${token}`

    // Auto-send routing:
    //   1. Prefer email if there's an address on file (or typed into the sheet)
    //   2. Fall back to SMS via Tidings' gather-send-invite-sms edge function
    //   3. If neither works, status notes the link was generated only
    // The link is always written to the sheet so the missionary has a record.
    const stamp = new Date().toISOString().slice(0, 10)
    const recipientEmail = email || (match.email ?? '')
    const recipientPhone = phone || (match.phone ?? '')
    const firstName =
      match.preferred_name ||
      match.first_name ||
      (fullName.split(/\s+/)[0] ?? 'there')

    let status = `Invited ${stamp}`

    if (recipientEmail) {
      const sendRes = await sendInviteEmail(recipientEmail, firstName, url)
      if (sendRes.ok) {
        status = `Emailed ${stamp}`
      } else {
        report.invitesErrors.push(`Row ${rowNum}: email send failed — ${sendRes.error}`)
        // Try SMS as a fallback if a phone is on file
        if (recipientPhone) {
          const smsRes = await sendInviteSms(recipientPhone, firstName, url)
          if (smsRes.ok) {
            status = `Texted ${stamp} (email failed)`
          } else {
            status = `Link generated ${stamp} (email + SMS failed)`
            report.invitesErrors.push(`Row ${rowNum}: SMS fallback also failed — ${smsRes.error}`)
          }
        } else {
          status = `Link generated ${stamp} (email failed: ${(sendRes.error ?? '').slice(0, 80)})`
        }
      }
    } else if (recipientPhone) {
      const smsRes = await sendInviteSms(recipientPhone, firstName, url)
      if (smsRes.ok) {
        status = `Texted ${stamp}`
      } else {
        status = `Link generated ${stamp} (SMS failed: ${(smsRes.error ?? '').slice(0, 80)})`
        report.invitesErrors.push(`Row ${rowNum}: SMS send failed — ${smsRes.error}`)
      }
    } else {
      status = `Link generated ${stamp} (no contact info)`
    }

    // Clear Send flag (D), write Status (E), Invite link (F), Sent at (G).
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TABS.INVITE_MEMBERS}!D${rowNum}:G${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['', status, url, stamp]],
      },
    })
    report.invitesProcessed += 1
  }
}

async function pullSuggestions(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any
  sheets: SheetsClient
  wardId: string
  spreadsheetId: string
  report: PullReport
}) {
  const { sb, sheets, wardId, spreadsheetId, report } = args
  const range = `${TABS.SUGGESTIONS}!A2:O200`

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = (res.data.values ?? []) as string[][]
  if (rows.length === 0) return

  // Preload data we'll reuse across rows
  const { data: friends } = await sb
    .from('knit_friends')
    .select('id, first_name, last_name, nickname, locale, interest_tag_ids')
    .eq('ward_id', wardId)
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
      // Put the hint in the #1 "why" cell so missionaries see something
      topCells[0] = ''
      topCells[1] = result.hint
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TABS.SUGGESTIONS}!F${rowNum}:O${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [topCells] },
    })

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any
  sheets: SheetsClient
  wardId: string
  spreadsheetId: string
  report: PullReport
}) {
  const { sb, sheets, wardId, spreadsheetId, report } = args
  const range = `${TABS.LOG_OUTING}!A2:G500`

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = (res.data.values ?? []) as string[][]
  if (rows.length === 0) return

  const { data: friends } = await sb
    .from('knit_friends')
    .select('id, first_name, last_name, nickname')
    .eq('ward_id', wardId)
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

    if (error) {
      report.outingErrors.push(`Row ${rowNum}: ${error.message}`)
      continue
    }

    // Write checkmark in Synced column
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TABS.LOG_OUTING}!G${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['✓']] },
    })

    report.outingsInserted += 1
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
  locale: 'en' | 'es'
  interest_tag_ids: string[] | null
}

function matchFriend(
  name: string,
  friends: FriendLookup[],
): FriendLookup | null {
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
  const hour = slot === 'morning' ? 9 : slot === 'afternoon' ? 14 : 19
  const d = new Date(date)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

function parseOutingStatus(raw: string): string | null {
  const s = raw.toLowerCase().trim()
  const valid = [
    'scheduled',
    'happened',
    'flaked',
    'rescheduled',
    'canceled',
    'needs_checkin',
  ]
  if (valid.includes(s)) return s
  if (s.startsWith('happen') || s === 'done' || s === 'completed' || s === 'yes')
    return 'happened'
  if (s === 'flake' || s === 'no-show' || s === 'missed') return 'flaked'
  if (s === 'cancelled') return 'canceled'
  if (s === 'reschedule') return 'rescheduled'
  return null
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

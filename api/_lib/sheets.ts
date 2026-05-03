import { google, type sheets_v4 } from 'googleapis'

/**
 * Convert a googleapis / GaxiosError into a readable string.
 * Pulls the HTTP status, message, and first "reason" (e.g. accessNotConfigured).
 */
export function formatGoogleError(e: unknown): string {
  if (!e) return 'Unknown error'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = e as any
  const status = err.code ?? err.response?.status
  const errors =
    err.errors ?? err.response?.data?.error?.errors ?? []
  const firstReason = errors?.[0]?.reason
  const firstDomain = errors?.[0]?.domain
  const msg =
    err.message ?? err.response?.data?.error?.message ?? 'Unknown error'
  const parts: string[] = [msg]
  if (status) parts.push(`HTTP ${status}`)
  if (firstReason) parts.push(`reason=${firstReason}`)
  if (firstDomain) parts.push(`domain=${firstDomain}`)
  // Useful: the service account + project that's being used
  const sa = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  if (sa) parts.push(`sa=${sa}`)
  return parts.join(' · ')
}

/**
 * Google Sheets + Drive client wrapper. Service-account-based.
 * Env vars required:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  (newlines can be escaped as \n)
 */

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const keyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  if (!email || !keyRaw) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set in this environment.',
    )
  }
  const privateKey = keyRaw.replace(/\\n/g, '\n')
  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  })
}

export type CreatedSheet = {
  spreadsheetId: string
  spreadsheetUrl: string
  defaultSheetId: number
}

export function extractSpreadsheetId(url: string): string | null {
  // Handles both /spreadsheets/d/<id>/... and bare id pastes.
  const m1 = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (m1) return m1[1]
  const m2 = url.trim().match(/^[a-zA-Z0-9_-]{20,}$/)
  if (m2) return m2[0]
  return null
}

export async function getSheetMeta(spreadsheetId: string) {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties(title),sheets(properties(sheetId,title))',
  })
  return {
    title: res.data.properties?.title ?? '',
    tabs: (res.data.sheets ?? []).map((s) => ({
      id: s.properties?.sheetId ?? 0,
      title: s.properties?.title ?? '',
    })),
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  }
}

/**
 * Idempotent. For each tab in `required` that isn't already present, creates
 * it. If a default "Sheet1" is still hanging around, deletes it at the end.
 * Leaves any other non-required tabs alone (doesn't wipe user content).
 */
export async function ensureTabs(
  spreadsheetId: string,
  required: string[],
) {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const meta = await getSheetMeta(spreadsheetId)
  const existingTitles = new Map<string, number>()
  for (const t of meta.tabs) existingTitles.set(t.title, t.id)

  const toAdd = required.filter((t) => !existingTitles.has(t))
  const sheet1Id = existingTitles.get('Sheet1')
  const sheet1IsExtra = sheet1Id !== undefined && !required.includes('Sheet1')

  const requests: sheets_v4.Schema$Request[] = []
  toAdd.forEach((title, idx) => {
    requests.push({
      addSheet: {
        properties: {
          title,
          index: idx,
          gridProperties: { rowCount: 200, columnCount: 16 },
        },
      },
    })
  })
  // Only delete Sheet1 if we've added at least one tab (so we don't leave the
  // spreadsheet empty), or if other tabs already exist beyond Sheet1.
  const otherTabsRemain = meta.tabs.length > (sheet1IsExtra ? 1 : 0)
  if (sheet1IsExtra && (toAdd.length > 0 || otherTabsRemain)) {
    requests.push({ deleteSheet: { sheetId: sheet1Id! } })
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    })
  }
}

export async function createSpreadsheet(title: string): Promise<CreatedSheet> {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.create({
    requestBody: { properties: { title } },
  })
  const spreadsheetId = res.data.spreadsheetId
  const spreadsheetUrl = res.data.spreadsheetUrl
  const defaultSheetId = res.data.sheets?.[0]?.properties?.sheetId ?? 0
  if (!spreadsheetId || !spreadsheetUrl) {
    throw new Error('Sheets API returned no spreadsheetId/url')
  }
  return { spreadsheetId, spreadsheetUrl, defaultSheetId }
}

/**
 * Create a spreadsheet under a user's OAuth2 credentials. The resulting file
 * lives in that user's Drive (and uses their quota). We then share it with the
 * service account so ongoing writes don't require OAuth.
 */
export async function createSpreadsheetAsUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oauthClient: any,
  title: string,
): Promise<CreatedSheet> {
  const sheets = google.sheets({ version: 'v4', auth: oauthClient })
  const res = await sheets.spreadsheets.create({
    requestBody: { properties: { title } },
  })
  const spreadsheetId = res.data.spreadsheetId
  const spreadsheetUrl = res.data.spreadsheetUrl
  const defaultSheetId = res.data.sheets?.[0]?.properties?.sheetId ?? 0
  if (!spreadsheetId || !spreadsheetUrl) {
    throw new Error('Sheets API returned no spreadsheetId/url')
  }
  return { spreadsheetId, spreadsheetUrl, defaultSheetId }
}

/**
 * Share a file (under user OAuth creds) with the given emails as Editor.
 * Notifications disabled — these are usually service account + other apps.
 */
export async function shareFileAsUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oauthClient: any,
  fileId: string,
  emails: string[],
  { sendNotificationEmail = false } = {},
) {
  if (emails.length === 0) return
  const drive = google.drive({ version: 'v3', auth: oauthClient })
  for (const email of emails) {
    const trimmed = email.trim()
    if (!trimmed) continue
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'writer',
        type: 'user',
        emailAddress: trimmed,
      },
      sendNotificationEmail,
    })
  }
}

export async function shareWithEmails(fileId: string, emails: string[]) {
  if (emails.length === 0) return
  const auth = getAuth()
  const drive = google.drive({ version: 'v3', auth })
  for (const email of emails) {
    const trimmed = email.trim()
    if (!trimmed) continue
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'writer',
        type: 'user',
        emailAddress: trimmed,
      },
      sendNotificationEmail: true,
    })
  }
}

/**
 * Replaces the spreadsheet's tabs with the given ordered list and removes
 * the default tab. Each tab gets created empty; write headers + data
 * separately via `writeRange`.
 */
export async function setupTabs(
  spreadsheetId: string,
  tabTitles: string[],
  defaultSheetIdToDelete: number,
) {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })

  const requests: sheets_v4.Schema$Request[] = tabTitles.map((title, index) => ({
    addSheet: {
      properties: {
        title,
        index,
        gridProperties: { rowCount: 200, columnCount: 14 },
      },
    },
  }))
  requests.push({ deleteSheet: { sheetId: defaultSheetIdToDelete } })

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  })
}

export async function writeRange(
  spreadsheetId: string,
  range: string,
  values: (string | number | boolean | null)[][],
) {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  })
}

/**
 * Clear all rows below the header of a tab, then write fresh data.
 * Leaves row 1 (the header) intact.
 */
export async function replaceDataRows(
  spreadsheetId: string,
  tab: string,
  headerColumnCount: number,
  rows: (string | number | boolean | null)[][],
) {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  // Clear everything below row 1 up to a large row count.
  const endCol = colLetter(headerColumnCount)
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${tab}!A2:${endCol}1000`,
  })
  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    })
  }
}

export function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/* ============================================================
   Protected ranges
   ------------------------------------------------------------
   Applies sheet-level protections so missionaries can't
   accidentally delete columns, rows, or headers that Knit
   depends on. Idempotent: any existing protection whose
   description starts with KNIT_PROTECT_TAG is removed and
   re-created on every call. Safe to invoke from
   provision / refresh / cron paths.
   ============================================================ */

export const KNIT_PROTECT_TAG = '[knit-protect]'

export type ProtectionRule = {
  /** Tab title to resolve to a sheetId */
  tab: string
  /** Human-readable label — must begin with KNIT_PROTECT_TAG so we can find it later */
  description: string
  /** true = popup warning + can override; false = hard lock (editors only) */
  warningOnly: boolean
  /**
   * The range to protect within the tab. Omit any of startRow/endRow/startCol/endCol
   * to extend to the sheet bounds in that direction. `'whole-sheet'` protects the
   * entire tab.
   *
   * Indexes are 0-based, end-exclusive (so row 0..1 = "row 1 only").
   */
  range:
    | 'whole-sheet'
    | {
        startRow?: number
        endRow?: number
        startCol?: number
        endCol?: number
      }
}

/**
 * Apply a list of protected ranges to a spreadsheet, removing any prior Knit
 * protections first so the result is deterministic. Hard-protected ranges
 * (warningOnly=false) include the service account in the editors list so our
 * API writes still go through; the file owner can always edit.
 */
export async function applyProtectedRanges(
  spreadsheetId: string,
  rules: ProtectionRule[],
) {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title),protectedRanges(protectedRangeId,description))',
  })

  // Resolve title -> sheetId
  const sheetIdByTitle = new Map<string, number>()
  for (const s of meta.data.sheets ?? []) {
    const id = s.properties?.sheetId
    const title = s.properties?.title
    if (id != null && title) sheetIdByTitle.set(title, id)
  }

  // Find existing Knit protections to remove
  const removals: sheets_v4.Schema$Request[] = []
  for (const s of meta.data.sheets ?? []) {
    for (const p of s.protectedRanges ?? []) {
      if ((p.description ?? '').startsWith(KNIT_PROTECT_TAG) && p.protectedRangeId != null) {
        removals.push({
          deleteProtectedRange: { protectedRangeId: p.protectedRangeId },
        })
      }
    }
  }

  // Build add requests
  const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? ''
  const additions: sheets_v4.Schema$Request[] = []
  for (const rule of rules) {
    const sheetId = sheetIdByTitle.get(rule.tab)
    if (sheetId == null) continue // tab missing — skip silently; ensureTabs handles repair

    const range: sheets_v4.Schema$GridRange =
      rule.range === 'whole-sheet'
        ? { sheetId }
        : {
            sheetId,
            ...(rule.range.startRow != null ? { startRowIndex: rule.range.startRow } : {}),
            ...(rule.range.endRow != null ? { endRowIndex: rule.range.endRow } : {}),
            ...(rule.range.startCol != null ? { startColumnIndex: rule.range.startCol } : {}),
            ...(rule.range.endCol != null ? { endColumnIndex: rule.range.endCol } : {}),
          }

    // For hard locks the SA must be in editors so our own writes still work.
    // For warning-only, editors is unused (anyone with edit can override).
    const editors = rule.warningOnly
      ? undefined
      : { users: saEmail ? [saEmail] : [] }

    additions.push({
      addProtectedRange: {
        protectedRange: {
          range,
          description: rule.description,
          warningOnly: rule.warningOnly,
          ...(editors ? { editors } : {}),
        },
      },
    })
  }

  const requests = [...removals, ...additions]
  if (requests.length === 0) return
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  })
}

/** Read row 1 of a tab. Returns the cell values as strings. */
export async function readHeaderRow(
  spreadsheetId: string,
  tab: string,
  expectedColumnCount: number,
): Promise<string[]> {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const range = `${tab}!A1:${colLetter(expectedColumnCount)}1`
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const row = (res.data.values?.[0] ?? []) as string[]
  return row
}

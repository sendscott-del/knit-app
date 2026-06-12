import { sheets as sheetsApi, type sheets_v4 } from '@googleapis/sheets'
import { drive as driveApi } from '@googleapis/drive'
import { JWT } from 'google-auth-library'

/**
 * Returns true if the given googleapis error is a rate-limit / quota response
 * that's safe to retry (HTTP 429 or 403 with rateLimitExceeded / userRateLimitExceeded).
 */
export function isRateLimitError(e: unknown): boolean {
  if (!e) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = e as any
  const status = err.code ?? err.response?.status
  if (status === 429) return true
  const errors = err.errors ?? err.response?.data?.error?.errors ?? []
  const reason = errors?.[0]?.reason
  return (
    reason === 'rateLimitExceeded' ||
    reason === 'userRateLimitExceeded' ||
    reason === 'quotaExceeded'
  )
}

/**
 * Retry an async Sheets/Drive call on rate-limit errors with exponential
 * backoff + jitter. Defaults: 5 tries, base 1.1s, cap 30s. Non-rate-limit
 * errors throw immediately.
 *
 * Granularity: every helper in this file already wraps its own API calls, so
 * callers should NOT wrap whole multi-call routines (pullSheet,
 * populateDataTabs) in retryOn429 — that re-runs every previous read/write
 * when one late call hits quota, which multiplies API usage exactly when
 * quota is exhausted.
 */
export async function retryOn429<T>(
  fn: () => Promise<T>,
  { maxAttempts = 5, baseMs = 1100, capMs = 30_000 } = {},
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (e) {
      attempt += 1
      if (attempt >= maxAttempts || !isRateLimitError(e)) throw e
      const backoff = Math.min(capMs, baseMs * 2 ** (attempt - 1))
      const jittered = backoff * (0.5 + Math.random())
      await new Promise((r) => setTimeout(r, jittered))
    }
  }
}

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
 *
 * The JWT client and the Sheets/Drive clients are cached at module level —
 * a fresh JWT per call meant a fresh OAuth token exchange per helper call
 * (~15 extra round-trips per ward per morning push).
 */

let cachedJwt: JWT | null = null
let cachedSheets: sheets_v4.Sheets | null = null

export function getAuth(): JWT {
  if (cachedJwt) return cachedJwt
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const keyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  if (!email || !keyRaw) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set in this environment.',
    )
  }
  const privateKey = keyRaw.replace(/\\n/g, '\n')
  cachedJwt = new JWT({
    email,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  })
  return cachedJwt
}

/** Shared, cached Sheets client (service account). */
export function getSheets(): sheets_v4.Sheets {
  if (cachedSheets) return cachedSheets
  cachedSheets = sheetsApi({ version: 'v4', auth: getAuth() })
  return cachedSheets
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

export type SheetMeta = {
  title: string
  tabs: { id: number; title: string; rowCount: number }[]
  spreadsheetUrl: string
}

export async function getSheetMeta(spreadsheetId: string): Promise<SheetMeta> {
  const sheets = getSheets()
  const res = await retryOn429(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields:
        'properties(title),sheets(properties(sheetId,title,gridProperties(rowCount)))',
    }),
  )
  return {
    title: res.data.properties?.title ?? '',
    tabs: (res.data.sheets ?? []).map((s) => ({
      id: s.properties?.sheetId ?? 0,
      title: s.properties?.title ?? '',
      rowCount: s.properties?.gridProperties?.rowCount ?? 0,
    })),
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  }
}

/** Knit-managed tabs are kept at (at least) this many rows so data writes and
 *  formatting ranges never hit "exceeds grid limits". */
export const MIN_TAB_ROWS = 1000

/**
 * Idempotent. For each tab in `required` that isn't already present, creates
 * it. Existing required tabs smaller than MIN_TAB_ROWS are expanded — tabs
 * used to be created at 200 rows, which made roster/formatting writes fail
 * once a ward crossed ~200 members. If a default "Sheet1" is still hanging
 * around, deletes it at the end. Leaves any other non-required tabs alone
 * (doesn't wipe user content).
 */
export async function ensureTabs(
  spreadsheetId: string,
  required: string[],
) {
  const sheets = getSheets()
  const meta = await getSheetMeta(spreadsheetId)
  const existing = new Map<string, { id: number; rowCount: number }>()
  for (const t of meta.tabs) existing.set(t.title, { id: t.id, rowCount: t.rowCount })

  const toAdd = required.filter((t) => !existing.has(t))
  const sheet1 = existing.get('Sheet1')
  const sheet1IsExtra = sheet1 !== undefined && !required.includes('Sheet1')

  const requests: sheets_v4.Schema$Request[] = []
  toAdd.forEach((title, idx) => {
    requests.push({
      addSheet: {
        properties: {
          title,
          index: idx,
          gridProperties: { rowCount: MIN_TAB_ROWS, columnCount: 16 },
        },
      },
    })
  })
  // Expand undersized existing required tabs.
  for (const title of required) {
    const t = existing.get(title)
    if (t && t.rowCount > 0 && t.rowCount < MIN_TAB_ROWS) {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId: t.id, gridProperties: { rowCount: MIN_TAB_ROWS } },
          fields: 'gridProperties.rowCount',
        },
      })
    }
  }
  // Only delete Sheet1 if we've added at least one tab (so we don't leave the
  // spreadsheet empty), or if other tabs already exist beyond Sheet1.
  const otherTabsRemain = meta.tabs.length > (sheet1IsExtra ? 1 : 0)
  if (sheet1IsExtra && (toAdd.length > 0 || otherTabsRemain)) {
    requests.push({ deleteSheet: { sheetId: sheet1!.id } })
  }

  if (requests.length > 0) {
    await retryOn429(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      }),
    )
  }
}

export async function createSpreadsheet(title: string): Promise<CreatedSheet> {
  const sheets = getSheets()
  const res = await retryOn429(() =>
    sheets.spreadsheets.create({
      requestBody: { properties: { title } },
    }),
  )
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
  const sheets = sheetsApi({ version: 'v4', auth: oauthClient })
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
  const drive = driveApi({ version: 'v3', auth: oauthClient })
  // Per-email try/catch: a single bad address (non-existent Google account,
  // invalid email format) no longer aborts the whole share batch. Errors are
  // logged; other recipients still get access.
  for (const email of emails) {
    const trimmed = email.trim()
    if (!trimmed) continue
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: 'writer',
          type: 'user',
          emailAddress: trimmed,
        },
        sendNotificationEmail,
      })
    } catch (err) {
      console.error(`[shareFileAsUser] failed to share ${fileId} with ${trimmed}:`, err instanceof Error ? err.message : String(err))
    }
  }
}

export async function writeRange(
  spreadsheetId: string,
  range: string,
  values: (string | number | boolean | null)[][],
) {
  const sheets = getSheets()
  await retryOn429(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    }),
  )
}

/**
 * Clear all rows from `startRow` (default 2 — leaves the header alone) down
 * to MIN_TAB_ROWS, then write fresh data starting at `startRow`. Pass
 * startRow=3 for tabs that have a banner row in row 1 + headers in row 2.
 */
export async function replaceDataRows(
  spreadsheetId: string,
  tab: string,
  headerColumnCount: number,
  rows: (string | number | boolean | null)[][],
  startRow: number = 2,
) {
  const sheets = getSheets()
  const endCol = colLetter(headerColumnCount)
  // Clamp to the managed grid size so the write can't exceed grid limits
  // (ensureTabs keeps Knit tabs at MIN_TAB_ROWS).
  const maxRows = MIN_TAB_ROWS - startRow
  const boundedRows = rows.length > maxRows ? rows.slice(0, maxRows) : rows
  await retryOn429(() =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${tab}!A${startRow}:${endCol}${MIN_TAB_ROWS}`,
    }),
  )
  if (boundedRows.length > 0) {
    await retryOn429(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!A${startRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: boundedRows },
      }),
    )
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
  const sheets = getSheets()

  const meta = await retryOn429(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(sheetId,title),protectedRanges(protectedRangeId,description))',
    }),
  )

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
    // domainUsersCanEdit=false closes the implicit "everyone in our Workspace
    // domain can edit" path that Google enables by default — without it a
    // missionary on the same domain as the file owner can sometimes edit
    // protected ranges without the popup.
    const editors = rule.warningOnly
      ? undefined
      : {
          users: saEmail ? [saEmail] : [],
          domainUsersCanEdit: false,
        }

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
  await retryOn429(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    }),
  )
}

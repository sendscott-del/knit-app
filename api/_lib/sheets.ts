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

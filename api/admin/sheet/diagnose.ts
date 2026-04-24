import type { VercelRequest, VercelResponse } from '@vercel/node'
import { google } from 'googleapis'
import { requireAdmin } from '../../_lib/auth.js'
import { formatGoogleError } from '../../_lib/sheets.js'

function getJwtAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const keyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  if (!email || !keyRaw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set')
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

/**
 * Diagnostic endpoint: probes each step of the sheet-provisioning flow and
 * returns which step failed plus the full Google error text. Admin-gated.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const report: Record<string, unknown> = {
    env_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    env_private_key_len: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.length ?? 0,
  }

  let jwt
  try {
    jwt = getJwtAuth()
    await jwt.authorize()
    report.step1_authorize = 'ok'
  } catch (e) {
    report.step1_authorize = `FAILED: ${formatGoogleError(e)}`
    return res.status(200).json(report)
  }

  // Step 2: drive.about.get — tells us WHO we are (service account identity) + quotas
  try {
    const drive = google.drive({ version: 'v3', auth: jwt })
    const about = await drive.about.get({
      fields: 'user(displayName,emailAddress),storageQuota(limit,usage)',
    })
    report.step2_drive_about = {
      ok: true,
      sa_identity: about.data.user,
      storage: about.data.storageQuota,
    }
  } catch (e) {
    report.step2_drive_about = `FAILED: ${formatGoogleError(e)}`
    return res.status(200).json(report)
  }

  // Step 3: sheets.spreadsheets.create — the call that's actually failing in provision
  let createdId: string | null = null
  try {
    const sheets = google.sheets({ version: 'v4', auth: jwt })
    const created = await sheets.spreadsheets.create({
      requestBody: { properties: { title: 'Knit diagnostic — delete me' } },
    })
    createdId = created.data.spreadsheetId ?? null
    report.step3_create_sheet = {
      ok: true,
      spreadsheetId: createdId,
      spreadsheetUrl: created.data.spreadsheetUrl,
    }
  } catch (e) {
    report.step3_create_sheet = `FAILED: ${formatGoogleError(e)}`
    return res.status(200).json(report)
  }

  // Step 4: delete the diagnostic sheet so we don't litter
  if (createdId) {
    try {
      const drive = google.drive({ version: 'v3', auth: jwt })
      await drive.files.delete({ fileId: createdId })
      report.step4_cleanup = 'ok'
    } catch (e) {
      report.step4_cleanup = `WARN: ${formatGoogleError(e)}`
    }
  }

  return res.status(200).json(report)
}

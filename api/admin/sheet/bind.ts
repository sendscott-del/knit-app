import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  requireAdmin,
  adminCanActOnWard,
  roleIsWritable,
} from '../../_lib/auth.js'
import { supabaseAdmin } from '../../_lib/supabaseAdmin.js'
import {
  extractSpreadsheetId,
  getSheetMeta,
  ensureTabs,
  shareWithEmails,
  formatGoogleError,
} from '../../_lib/sheets.js'
import { bindSpreadsheet, TAB_ORDER } from '../../_lib/sheetSync.js'

/**
 * Binds Knit to a user-created Google Sheet (shared with the service account
 * as Editor). This is the supported flow for projects without Drive storage
 * quota (personal Gmail + non-Workspace GCP project).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const { wardId, sheetUrl, emails } = (req.body ?? {}) as {
    wardId?: string
    sheetUrl?: string
    emails?: string[]
  }
  if (!wardId || !sheetUrl) {
    return res.status(400).json({ error: 'Missing wardId or sheetUrl' })
  }
  if (!roleIsWritable(auth.admin.role)) {
    return res.status(403).json({ error: 'Your role cannot bind a sheet' })
  }
  if (!(await adminCanActOnWard(auth.admin, wardId))) {
    return res.status(403).json({ error: 'This ward is outside your scope' })
  }

  const spreadsheetId = extractSpreadsheetId(sheetUrl)
  if (!spreadsheetId) {
    return res
      .status(400)
      .json({ error: 'Could not find a spreadsheet ID in that URL' })
  }

  const normalizedEmails = (emails ?? [])
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && e.includes('@'))

  const sb = supabaseAdmin()

  const { data: ward, error: wardErr } = await sb
    .from('knit_wards')
    .select('id, name')
    .eq('id', wardId)
    .single()
  if (wardErr || !ward) {
    return res.status(404).json({ error: 'Ward not found' })
  }

  try {
    // 1. Verify the SA can read the sheet (confirms it's been shared)
    const meta = await getSheetMeta(spreadsheetId)

    // 2. Add our tabs (idempotent) + drop default Sheet1 if present
    await ensureTabs(spreadsheetId, TAB_ORDER)

    // 3. Write headers + Start Here + populate data
    await bindSpreadsheet(spreadsheetId, ward.name, wardId)

    // 4. Optionally share with missionary gmails (only works if the sheet's
    //    owner has granted the SA permission to share — skip silently if not)
    if (normalizedEmails.length > 0) {
      try {
        await shareWithEmails(spreadsheetId, normalizedEmails)
      } catch (e) {
        // Non-fatal: the owner can share manually if the SA lacks permission.
        console.warn('shareWithEmails failed:', formatGoogleError(e))
      }
    }

    // 5. Persist binding
    const nowIso = new Date().toISOString()
    const payload = {
      ward_id: wardId,
      sheet_id: spreadsheetId,
      sheet_url: meta.spreadsheetUrl,
      shared_emails: normalizedEmails,
      status: 'healthy' as const,
      last_push_at: nowIso,
      last_error: null,
    }

    const { data: existing } = await sb
      .from('knit_google_sheet_bindings')
      .select('id')
      .eq('ward_id', wardId)
      .maybeSingle()

    if (existing) {
      await sb
        .from('knit_google_sheet_bindings')
        .update(payload)
        .eq('id', existing.id)
    } else {
      await sb.from('knit_google_sheet_bindings').insert(payload)
    }

    return res.status(200).json({
      binding: {
        sheet_id: spreadsheetId,
        sheet_url: meta.spreadsheetUrl,
        shared_emails: normalizedEmails,
        status: 'healthy',
        last_push_at: nowIso,
        sheet_title: meta.title,
      },
    })
  } catch (e) {
    const message = formatGoogleError(e)
    await sb
      .from('knit_google_sheet_bindings')
      .upsert(
        {
          ward_id: wardId,
          sheet_id: spreadsheetId,
          status: 'error',
          last_error: message,
          shared_emails: normalizedEmails,
        },
        { onConflict: 'ward_id' },
      )
    return res.status(500).json({ error: message })
  }
}

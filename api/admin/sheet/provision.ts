import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin, adminCanActOnWard, roleIsWritable } from '../../_lib/auth.js'
import { supabaseAdmin } from '../../_lib/supabaseAdmin.js'
import {
  createSpreadsheet,
  shareWithEmails,
  setupTabs,
  formatGoogleError,
} from '../../_lib/sheets.js'
import { provisionSpreadsheet, TAB_ORDER } from '../../_lib/sheetSync.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const { wardId, emails } = (req.body ?? {}) as {
    wardId?: string
    emails?: string[]
  }
  if (!wardId || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'Missing wardId or emails[]' })
  }
  if (!roleIsWritable(auth.admin.role)) {
    return res.status(403).json({ error: 'Your role cannot provision a sheet' })
  }
  if (!(await adminCanActOnWard(auth.admin, wardId))) {
    return res.status(403).json({ error: 'This ward is outside your scope' })
  }

  const normalizedEmails = emails
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && e.includes('@'))

  const sb = supabaseAdmin()

  // Existing binding?
  const { data: existing } = await sb
    .from('knit_google_sheet_bindings')
    .select('*')
    .eq('ward_id', wardId)
    .maybeSingle()

  if (existing && existing.sheet_id && existing.status === 'healthy') {
    return res
      .status(409)
      .json({
        error:
          'A sheet is already bound to this ward. Use Refresh or Unbind first.',
        binding: existing,
      })
  }

  const { data: ward, error: wardErr } = await sb
    .from('knit_wards')
    .select('id, name')
    .eq('id', wardId)
    .single()
  if (wardErr || !ward) {
    return res.status(404).json({ error: 'Ward not found' })
  }

  try {
    const title = `Knit — ${ward.name}`
    const sheet = await createSpreadsheet(title)
    await setupTabs(sheet.spreadsheetId, TAB_ORDER, sheet.defaultSheetId)
    await shareWithEmails(sheet.spreadsheetId, normalizedEmails)
    await provisionSpreadsheet(sheet, ward.name, wardId)

    const nowIso = new Date().toISOString()
    const payload = {
      ward_id: wardId,
      sheet_id: sheet.spreadsheetId,
      sheet_url: sheet.spreadsheetUrl,
      shared_emails: normalizedEmails,
      status: 'healthy' as const,
      last_push_at: nowIso,
      last_error: null,
    }

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
        sheet_id: sheet.spreadsheetId,
        sheet_url: sheet.spreadsheetUrl,
        shared_emails: normalizedEmails,
        status: 'healthy',
        last_push_at: nowIso,
      },
    })
  } catch (e) {
    const message = formatGoogleError(e)
    await sb
      .from('knit_google_sheet_bindings')
      .upsert(
        {
          ward_id: wardId,
          status: 'error',
          last_error: message,
          shared_emails: normalizedEmails,
        },
        { onConflict: 'ward_id' },
      )
    return res.status(500).json({ error: message })
  }
}

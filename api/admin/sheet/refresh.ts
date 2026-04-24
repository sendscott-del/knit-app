import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin, adminCanActOnWard, roleIsWritable } from '../../_lib/auth.js'
import { supabaseAdmin } from '../../_lib/supabaseAdmin.js'
import { populateDataTabs } from '../../_lib/sheetSync.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const { wardId } = (req.body ?? {}) as { wardId?: string }
  if (!wardId) return res.status(400).json({ error: 'Missing wardId' })
  if (!roleIsWritable(auth.admin.role)) {
    return res.status(403).json({ error: 'Your role cannot refresh the sheet' })
  }
  if (!(await adminCanActOnWard(auth.admin, wardId))) {
    return res.status(403).json({ error: 'This ward is outside your scope' })
  }

  const sb = supabaseAdmin()
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('*')
    .eq('ward_id', wardId)
    .maybeSingle()
  if (!binding || !binding.sheet_id) {
    return res.status(404).json({ error: 'No sheet bound for this ward' })
  }

  try {
    await populateDataTabs({ spreadsheetId: binding.sheet_id, wardId })
    const nowIso = new Date().toISOString()
    await sb
      .from('knit_google_sheet_bindings')
      .update({
        status: 'healthy',
        last_push_at: nowIso,
        last_error: null,
      })
      .eq('id', binding.id)
    return res.status(200).json({ last_push_at: nowIso })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await sb
      .from('knit_google_sheet_bindings')
      .update({
        status: 'error',
        last_error: message,
      })
      .eq('id', binding.id)
    return res.status(500).json({ error: message })
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  requireAdmin,
  adminCanActOnWard,
  roleIsWritable,
} from '../../_lib/auth.js'
import { supabaseAdmin } from '../../_lib/supabaseAdmin.js'
import { pullSheet } from '../../_lib/sheetPull.js'

/**
 * Admin-initiated version of the daytime pull. One ward at a time.
 */
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
    return res.status(403).json({ error: 'Your role cannot sync sheets' })
  }
  if (!(await adminCanActOnWard(auth.admin, wardId))) {
    return res.status(403).json({ error: 'This ward is outside your scope' })
  }

  const sb = supabaseAdmin()
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, sheet_id')
    .eq('ward_id', wardId)
    .maybeSingle()
  if (!binding?.sheet_id) {
    return res.status(404).json({ error: 'No sheet bound for this ward' })
  }

  try {
    const report = await pullSheet({
      wardId,
      spreadsheetId: binding.sheet_id,
    })
    await sb
      .from('knit_google_sheet_bindings')
      .update({ last_pull_at: new Date().toISOString() })
      .eq('id', binding.id)
    return res.status(200).json({ report })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return res.status(500).json({ error: msg })
  }
}

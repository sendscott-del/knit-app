import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin, adminCanActOnWard } from '../../_lib/auth'
import { supabaseAdmin } from '../../_lib/supabaseAdmin'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const wardId = (req.query.wardId as string | undefined) ?? ''
  if (!wardId) return res.status(400).json({ error: 'Missing wardId' })

  if (!(await adminCanActOnWard(auth.admin, wardId))) {
    return res.status(403).json({ error: 'This ward is outside your scope' })
  }

  const sb = supabaseAdmin()
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('*')
    .eq('ward_id', wardId)
    .maybeSingle()

  return res.status(200).json({ binding })
}

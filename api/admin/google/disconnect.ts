import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../../_lib/auth.js'
import { supabaseAdmin } from '../../_lib/supabaseAdmin.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  if (!auth.admin.stake_id) return res.status(400).json({ error: 'No stake' })

  const sb = supabaseAdmin()
  await sb
    .from('knit_google_oauth')
    .delete()
    .eq('stake_id', auth.admin.stake_id)
  return res.status(200).json({ ok: true })
}

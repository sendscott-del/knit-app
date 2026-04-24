import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../../_lib/auth.js'
import { supabaseAdmin } from '../../_lib/supabaseAdmin.js'

/** Returns {connected, email, granted_at} for the current admin's stake. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  if (!auth.admin.stake_id) {
    return res.status(200).json({ connected: false })
  }

  const sb = supabaseAdmin()
  const { data } = await sb
    .from('knit_google_oauth')
    .select('granted_by_email, granted_at')
    .eq('stake_id', auth.admin.stake_id)
    .maybeSingle()

  if (!data) return res.status(200).json({ connected: false })
  return res
    .status(200)
    .json({ connected: true, email: data.granted_by_email, granted_at: data.granted_at })
}

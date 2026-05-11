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
  if (!auth.admin.is_super_admin && auth.admin.role !== 'stake_presidency') {
    return res.status(403).json({ error: 'Only stake presidency or super admins can remove admins' })
  }

  const userId = (req.body as { userId?: string } | undefined)?.userId
  if (!userId) return res.status(400).json({ error: 'Missing userId' })
  if (userId === auth.admin.id) {
    return res.status(400).json({ error: "You can't remove yourself" })
  }

  const sb = supabaseAdmin()

  // Verify target is in the caller's stake (unless super admin).
  const { data: target } = await sb
    .from('knit_admin_users')
    .select('id, stake_id, is_super_admin')
    .eq('id', userId)
    .maybeSingle()
  if (!target) return res.status(404).json({ error: 'Admin not found' })
  if (
    !auth.admin.is_super_admin &&
    (target as { stake_id: string }).stake_id !== auth.admin.stake_id
  ) {
    return res.status(403).json({ error: 'Admin is outside your stake' })
  }
  if ((target as { is_super_admin: boolean }).is_super_admin && !auth.admin.is_super_admin) {
    return res.status(403).json({ error: 'Only a super admin can remove a super admin' })
  }

  const { error: delErr } = await sb.from('knit_admin_users').delete().eq('id', userId)
  if (delErr) return res.status(500).json({ error: delErr.message })

  return res.status(200).json({ ok: true })
}

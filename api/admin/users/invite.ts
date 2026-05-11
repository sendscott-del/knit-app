import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../../_lib/auth.js'
import { supabaseAdmin } from '../../_lib/supabaseAdmin.js'
import type { AdminRole } from '../../_lib/types.js'

type InvitePayload = {
  email: string
  name: string | null
  role: AdminRole
  ward_id: string | null
  is_super_admin?: boolean
}

const VALID_ROLES: AdminRole[] = [
  'stake_presidency',
  'high_councilor',
  'ward_mission_leader',
  'relief_society_presidency',
  'elders_quorum_presidency',
]

const WARD_SCOPED: AdminRole[] = [
  'ward_mission_leader',
  'relief_society_presidency',
  'elders_quorum_presidency',
]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  if (!auth.admin.is_super_admin && auth.admin.role !== 'stake_presidency') {
    return res.status(403).json({ error: 'Only stake presidency or super admins can invite admins' })
  }
  if (!auth.admin.stake_id) {
    return res.status(400).json({ error: 'Your admin row has no stake assigned' })
  }

  const body = req.body as InvitePayload | undefined
  if (!body?.email || !body?.role) {
    return res.status(400).json({ error: 'Missing email or role' })
  }
  const email = String(body.email).trim().toLowerCase()
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' })
  }
  if (!VALID_ROLES.includes(body.role)) {
    return res.status(400).json({ error: 'Invalid role' })
  }
  if (WARD_SCOPED.includes(body.role) && !body.ward_id) {
    return res.status(400).json({ error: 'Ward is required for this role' })
  }

  const sb = supabaseAdmin()

  // Verify ward belongs to caller's stake.
  if (body.ward_id) {
    const { data: ward } = await sb
      .from('knit_wards')
      .select('id, stake_id')
      .eq('id', body.ward_id)
      .maybeSingle()
    if (!ward) return res.status(404).json({ error: 'Ward not found' })
    if (
      !auth.admin.is_super_admin &&
      (ward as { stake_id: string }).stake_id !== auth.admin.stake_id
    ) {
      return res.status(403).json({ error: 'Ward is outside your stake' })
    }
  }

  // Reuse an existing auth user if one exists, otherwise invite.
  let userId: string | null = null
  const { data: existing } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
  const found = existing?.users?.find((u) => u.email?.toLowerCase() === email)
  if (found) {
    userId = found.id
  } else {
    const { data: invited, error: inviteErr } =
      await sb.auth.admin.inviteUserByEmail(email)
    if (inviteErr || !invited?.user) {
      return res.status(500).json({ error: inviteErr?.message ?? 'Invite failed' })
    }
    userId = invited.user.id
  }

  // Upsert the knit_admin_users row.
  const { error: upsertErr } = await sb.from('knit_admin_users').upsert(
    {
      id: userId,
      email,
      name: body.name?.trim() || null,
      role: body.role,
      stake_id: auth.admin.stake_id,
      ward_id: WARD_SCOPED.includes(body.role) ? body.ward_id : null,
      is_super_admin:
        auth.admin.is_super_admin && body.is_super_admin === true ? true : false,
    },
    { onConflict: 'id' },
  )
  if (upsertErr) {
    return res.status(500).json({ error: upsertErr.message })
  }

  return res.status(200).json({ ok: true, userId })
}

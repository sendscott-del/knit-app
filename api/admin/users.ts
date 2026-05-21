import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import type { AdminRole } from '../_lib/types.js'

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

type InvitePayload = {
  action: 'invite'
  email: string
  name?: string | null
  role: AdminRole
  ward_id?: string | null
  is_super_admin?: boolean
}

type RemovePayload = {
  action: 'remove'
  userId: string
}

type Payload = InvitePayload | RemovePayload

/**
 * Single endpoint for admin user management — keeps us under Vercel Hobby's
 * 12-function cap. POST with action: 'invite' to create/upgrade an admin,
 * or action: 'remove' to delete one.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  if (!auth.admin.is_super_admin && auth.admin.role !== 'stake_presidency') {
    return res
      .status(403)
      .json({ error: 'Only stake presidency or super admins can manage admins' })
  }
  if (!auth.admin.stake_id) {
    return res.status(400).json({ error: 'Your admin row has no stake assigned' })
  }

  const body = req.body as Payload | undefined
  if (!body?.action) return res.status(400).json({ error: 'Missing action' })

  if (body.action === 'invite') return invite(req, res, auth.admin, body)
  if (body.action === 'remove') return remove(req, res, auth.admin, body)
  return res.status(400).json({ error: 'Unknown action' })
}

async function invite(
  _req: VercelRequest,
  res: VercelResponse,
  caller: { id: string; stake_id: string | null; is_super_admin: boolean },
  body: InvitePayload,
) {
  if (!body.email || !body.role) {
    return res.status(400).json({ error: 'Missing email or role' })
  }
  const email = String(body.email).trim().toLowerCase()
  if (!email.includes('@')) return res.status(400).json({ error: 'Invalid email' })
  if (!VALID_ROLES.includes(body.role)) {
    return res.status(400).json({ error: 'Invalid role' })
  }
  if (WARD_SCOPED.includes(body.role) && !body.ward_id) {
    return res.status(400).json({ error: 'Ward is required for this role' })
  }

  const sb = supabaseAdmin()

  if (body.ward_id) {
    const { data: ward } = await sb
      .from('knit_wards')
      .select('id, stake_id')
      .eq('id', body.ward_id)
      .maybeSingle()
    if (!ward) return res.status(404).json({ error: 'Ward not found' })
    if (
      !caller.is_super_admin &&
      (ward as { stake_id: string }).stake_id !== caller.stake_id
    ) {
      return res.status(403).json({ error: 'Ward is outside your stake' })
    }
  }

  // Reuse existing auth user if email matches one already in auth.users.
  // Uses a SECURITY DEFINER RPC because PostgREST does not expose `auth` and
  // supabase-js auth.admin.listUsers is paginated/ordering-sensitive, which
  // made "is this email taken?" unreliable and caused inviteUserByEmail to
  // throw "A user with this email address has already been registered."
  let userId: string | null = null
  const { data: existingId, error: lookupErr } = await sb.rpc(
    'knit_find_user_id_by_email',
    { p_email: email },
  )
  if (lookupErr) {
    return res.status(500).json({ error: lookupErr.message })
  }
  if (existingId) {
    userId = existingId as string
  } else {
    const { data: invited, error: inviteErr } =
      await sb.auth.admin.inviteUserByEmail(email)
    if (inviteErr || !invited?.user) {
      return res.status(500).json({ error: inviteErr?.message ?? 'Invite failed' })
    }
    userId = invited.user.id
  }

  const { error: upsertErr } = await sb.from('knit_admin_users').upsert(
    {
      id: userId,
      email,
      name: body.name?.trim() || null,
      role: body.role,
      stake_id: caller.stake_id,
      ward_id: WARD_SCOPED.includes(body.role) ? body.ward_id ?? null : null,
      is_super_admin:
        caller.is_super_admin && body.is_super_admin === true ? true : false,
    },
    { onConflict: 'id' },
  )
  if (upsertErr) return res.status(500).json({ error: upsertErr.message })

  return res.status(200).json({ ok: true, userId })
}

async function remove(
  _req: VercelRequest,
  res: VercelResponse,
  caller: { id: string; stake_id: string | null; is_super_admin: boolean },
  body: RemovePayload,
) {
  if (!body.userId) return res.status(400).json({ error: 'Missing userId' })
  if (body.userId === caller.id) {
    return res.status(400).json({ error: "You can't remove yourself" })
  }

  const sb = supabaseAdmin()
  const { data: target } = await sb
    .from('knit_admin_users')
    .select('id, stake_id, is_super_admin')
    .eq('id', body.userId)
    .maybeSingle()
  if (!target) return res.status(404).json({ error: 'Admin not found' })
  if (
    !caller.is_super_admin &&
    (target as { stake_id: string }).stake_id !== caller.stake_id
  ) {
    return res.status(403).json({ error: 'Admin is outside your stake' })
  }
  if (
    (target as { is_super_admin: boolean }).is_super_admin &&
    !caller.is_super_admin
  ) {
    return res.status(403).json({ error: 'Only a super admin can remove a super admin' })
  }

  const { error: delErr } = await sb
    .from('knit_admin_users')
    .delete()
    .eq('id', body.userId)
  if (delErr) return res.status(500).json({ error: delErr.message })

  return res.status(200).json({ ok: true })
}

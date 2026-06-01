import type { VercelRequest, VercelResponse } from '@vercel/node'
import { google } from 'googleapis'
import { requireAdmin } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import type { AdminRole } from '../_lib/types.js'
import { getAuth as getServiceAccountAuth } from '../_lib/sheets.js'

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
    // Tag the new auth user with app='knit' so the shared handle_new_user
    // trigger doesn't fall through and Magnify/Squarecana never create a
    // phantom pending profile for an admin Scott invited into Knit. (See
    // v0.44.0 changelog — that fix only covered the Signup.tsx self-serve
    // path; this is the missing equivalent for the invite path.)
    const { data: invited, error: inviteErr } =
      await sb.auth.admin.inviteUserByEmail(email, {
        data: { app: 'knit' },
      })
    if (inviteErr || !invited?.user) {
      return res.status(500).json({ error: inviteErr?.message ?? 'Invite failed' })
    }
    userId = invited.user.id
  }

  const wardId = WARD_SCOPED.includes(body.role) ? body.ward_id ?? null : null
  const { error: upsertErr } = await sb.from('knit_admin_users').upsert(
    {
      id: userId,
      email,
      name: body.name?.trim() || null,
      role: body.role,
      stake_id: caller.stake_id,
      ward_id: wardId,
      is_super_admin:
        caller.is_super_admin && body.is_super_admin === true ? true : false,
    },
    { onConflict: 'id' },
  )
  if (upsertErr) return res.status(500).json({ error: upsertErr.message })

  // Best-effort: register Knit in Gathered's user_apps so the suite shell
  // surfaces the Knit tile. Non-fatal — Knit access itself is gated by
  // knit_admin_users (upserted above); user_apps drives the tile visibility.
  const { error: appAccessErr } = await sb.from('user_apps').upsert(
    {
      user_id: userId,
      app_name: 'knit',
      role: body.role,
      granted_by: caller.id,
    },
    { onConflict: 'user_id,app_name' },
  )
  if (appAccessErr) {
    console.warn(`Knit user_apps grant failed for ${email}: ${appAccessErr.message}`)
  }

  // Best-effort: also share the relevant Google Sheet(s) with this admin so
  // they can open them without a separate Google "Request access" round-trip.
  // Ward-scoped roles get the one sheet for their ward; stake roles get every
  // bound ward in the stake. Failures are non-fatal — we still return ok and
  // surface them in the response for visibility. (caller.stake_id is
  // non-null here — the handler returned early above if it was missing.)
  const sheetShare = await shareSheetsWithAdmin({
    sb,
    email,
    stakeId: caller.stake_id as string,
    wardId,
  })

  return res.status(200).json({ ok: true, userId, sheetShare })
}

type SheetShareReport = {
  attempted: number
  shared: string[]
  alreadyShared: string[]
  skipped: string[]
  errors: string[]
}

async function shareSheetsWithAdmin({
  sb,
  email,
  stakeId,
  wardId,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any
  email: string
  stakeId: string
  wardId: string | null
}): Promise<SheetShareReport> {
  const report: SheetShareReport = {
    attempted: 0,
    shared: [],
    alreadyShared: [],
    skipped: [],
    errors: [],
  }

  // Pick the bindings to share with. Ward-scoped admin = that ward's sheet
  // only. Stake-scoped (no ward_id) = every bound ward in the stake.
  let bindingsQuery = sb
    .from('knit_google_sheet_bindings')
    .select('id, sheet_id, shared_emails, ward_id, knit_wards!inner(stake_id, name)')
    .not('sheet_id', 'is', null)
  if (wardId) {
    bindingsQuery = bindingsQuery.eq('ward_id', wardId)
  } else {
    bindingsQuery = bindingsQuery.eq('knit_wards.stake_id', stakeId)
  }
  const { data: bindings } = await bindingsQuery
  if (!bindings || bindings.length === 0) {
    return report
  }

  // Service account — see api/_lib/sheetAccess.ts comment for why.
  const drive = google.drive({ version: 'v3', auth: getServiceAccountAuth() })
  const normalized = email.toLowerCase()

  for (const b of bindings as Array<{
    id: string
    sheet_id: string
    shared_emails: string[] | null
    ward_id: string
    knit_wards: { name: string } | { name: string }[]
  }>) {
    report.attempted += 1
    const wardName = Array.isArray(b.knit_wards)
      ? b.knit_wards[0]?.name
      : b.knit_wards?.name
    const existing = (b.shared_emails ?? []).map((e) => e.toLowerCase())
    if (existing.includes(normalized)) {
      report.alreadyShared.push(wardName ?? b.ward_id)
      continue
    }
    // Verify against Drive first — shared_emails has lied in the past.
    let livePerms: Set<string> = new Set()
    try {
      const r = await drive.permissions.list({
        fileId: b.sheet_id,
        fields: 'permissions(emailAddress, type)',
      })
      for (const p of (r.data.permissions ?? []) as Array<{
        emailAddress?: string | null
        type?: string | null
      }>) {
        if (p.type === 'user' && p.emailAddress) {
          livePerms.add(p.emailAddress.toLowerCase())
        }
      }
    } catch {
      // fall through; treat as no perms
    }
    if (livePerms.has(normalized)) {
      const merged = Array.from(new Set([...(b.shared_emails ?? []), email]))
      await sb
        .from('knit_google_sheet_bindings')
        .update({ shared_emails: merged })
        .eq('id', b.id)
      report.alreadyShared.push(wardName ?? b.ward_id)
      continue
    }
    try {
      await drive.permissions.create({
        fileId: b.sheet_id,
        requestBody: { role: 'writer', type: 'user', emailAddress: email },
        sendNotificationEmail: true,
      })
      const merged = Array.from(new Set([...(b.shared_emails ?? []), email]))
      await sb
        .from('knit_google_sheet_bindings')
        .update({ shared_emails: merged })
        .eq('id', b.id)
      report.shared.push(wardName ?? b.ward_id)
    } catch (err) {
      // Real error — surface it instead of pretending success.
      report.errors.push(
        `${wardName ?? b.ward_id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return report
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

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import {
  sendInviteEmail,
  sendInviteSms,
  memberInviteUrl,
} from '../_lib/inviteSend.js'

type SendPayload = {
  action: 'send'
  member_id: string
  channel: 'email' | 'sms'
}

type Payload = SendPayload

function getBearer(req: VercelRequest): string | null {
  const h = req.headers.authorization ?? req.headers.Authorization
  const raw = Array.isArray(h) ? h[0] : h
  if (!raw) return null
  if (!raw.toLowerCase().startsWith('bearer ')) return null
  return raw.slice(7).trim()
}

/**
 * POST /api/admin/invitations
 *   { action: 'send', member_id, channel }
 *
 * Authorization is intentionally NOT routed through requireAdmin (which
 * gates on knit_admin_users). Instead we evaluate knit_is_app_super_admin()
 * and knit_is_ward_super_admin(ward_id) on a JWT-bound client, so stake
 * president / stake clerk / hc_missionary_work / WMLs from the
 * gather_user_roles catalog can also send — matching the new Invitations
 * page's audience.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const body = req.body as Payload | undefined
  if (!body?.action) return res.status(400).json({ error: 'Missing action' })
  if (body.action !== 'send') return res.status(400).json({ error: 'Unknown action' })
  if (!body.member_id) return res.status(400).json({ error: 'Missing member_id' })
  if (body.channel !== 'email' && body.channel !== 'sms') {
    return res.status(400).json({ error: 'channel must be "email" or "sms"' })
  }

  const token = getBearer(req)
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const sb = supabaseAdmin()

  // 1) Verify the JWT and identify the caller.
  const { data: userData, error: userErr } = await sb.auth.getUser(token)
  if (userErr || !userData.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const userId = userData.user.id
  const userEmail = userData.user.email ?? ''

  // 2) Look up the member.
  const { data: member, error: memberErr } = await sb
    .from('knit_members')
    .select(
      'id, ward_id, first_name, last_name, preferred_name, email, phone, opted_out_at',
    )
    .eq('id', body.member_id)
    .maybeSingle()
  if (memberErr) return res.status(500).json({ error: memberErr.message })
  if (!member) return res.status(404).json({ error: 'Member not found' })
  const m = member as {
    id: string
    ward_id: string
    first_name: string | null
    last_name: string | null
    preferred_name: string | null
    email: string | null
    phone: string | null
    opted_out_at: string | null
  }
  if (m.opted_out_at) {
    return res.status(400).json({ error: 'Member has opted out of Knit' })
  }

  // 3) Permission: evaluate is-app-super-admin / is-ward-super-admin via the
  //    caller's JWT. The helpers honor knit_admin_users AND gather_user_roles.
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anonKey =
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ error: 'Server is missing SUPABASE_URL / SUPABASE_ANON_KEY' })
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const [appSuperRes, wardSuperRes] = await Promise.all([
    userClient.rpc('knit_is_app_super_admin'),
    userClient.rpc('knit_is_ward_super_admin', { p_ward_id: m.ward_id }),
  ])
  if (appSuperRes.error) return res.status(500).json({ error: appSuperRes.error.message })
  if (wardSuperRes.error) return res.status(500).json({ error: wardSuperRes.error.message })
  const allowed = Boolean(appSuperRes.data) || Boolean(wardSuperRes.data)
  if (!allowed) {
    return res.status(403).json({ error: 'You do not have permission to invite this member.' })
  }

  // 4) Resolve recipient.
  const recipient =
    body.channel === 'email' ? (m.email ?? '').trim() : (m.phone ?? '').trim()
  if (!recipient) {
    return res
      .status(400)
      .json({ error: body.channel === 'email' ? 'No email on file.' : 'No phone on file.' })
  }

  // 5) Generate the magic link (service role bypasses RLS; we've already
  //    permission-checked above).
  const { data: tokenValue, error: tokenErr } = await sb.rpc(
    'knit_generate_member_magic_link',
    { p_member_id: m.id },
  )
  if (tokenErr || !tokenValue) {
    return res.status(500).json({ error: tokenErr?.message ?? 'Could not generate link' })
  }
  const url = memberInviteUrl(m.id, tokenValue as string)
  const firstName =
    m.preferred_name || m.first_name || (m.last_name ? `` : 'there')

  // 6) Send.
  const sendResult =
    body.channel === 'email'
      ? await sendInviteEmail(recipient, firstName, url)
      : await sendInviteSms(recipient, firstName, url)

  // 7) Record audit row. sent_by_admin_id is only set when the caller has a
  //    knit_admin_users row; gather_user_roles-only callers (stake_clerk,
  //    hc_missionary_work without an admin row) are still recorded by email.
  const { data: adminRow } = await sb
    .from('knit_admin_users')
    .select('id, name')
    .eq('id', userId)
    .maybeSingle()
  const sentByAdminId = adminRow ? (adminRow as { id: string }).id : null
  const sentByLabel =
    (adminRow as { name?: string | null } | null)?.name ?? userEmail ?? null

  const { error: auditErr } = await sb.from('knit_member_invitations').insert({
    member_id: m.id,
    ward_id: m.ward_id,
    sent_by_admin_id: sentByAdminId,
    sent_by_label: sentByLabel,
    source: 'admin_app',
    channel: body.channel,
    recipient,
    outcome: sendResult.ok ? 'sent' : 'failed',
    outcome_detail: sendResult.ok ? null : sendResult.error ?? 'unknown error',
    provider_message_id: sendResult.providerMessageId ?? null,
  })
  if (auditErr) {
    // The send may have already gone through. Surface both pieces of info so
    // the UI can show "sent, but audit log failed" instead of pretending it
    // failed entirely.
    return res.status(500).json({
      ok: sendResult.ok,
      error: `Audit log insert failed: ${auditErr.message}`,
      sendOutcome: sendResult.ok ? 'sent' : 'failed',
      sendError: sendResult.error ?? null,
    })
  }

  if (!sendResult.ok) {
    return res.status(502).json({
      ok: false,
      outcome: 'failed',
      channel: body.channel,
      recipient,
      error: sendResult.error ?? 'Send failed',
    })
  }
  return res.status(200).json({
    ok: true,
    outcome: 'sent',
    channel: body.channel,
    recipient,
  })
}

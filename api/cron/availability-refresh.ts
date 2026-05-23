import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyCron } from '../_lib/cronAuth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { memberInviteUrl, appOriginFromEnv } from '../_lib/inviteSend.js'

/**
 * Daily: text each active member whose last availability refresh was 90+
 * days ago (or who has never been refreshed yet) and ask them to confirm
 * or update their availability. Replaces the original spec's weekly nudge —
 * Scott's call is a 90-day cadence is more respectful of members' time.
 *
 * "Active" means: onboarding completed, not paused, not opted out, has a
 * phone number on file. We cap each run at MAX_PER_RUN sends so a flood
 * of due members (e.g. on rollout day) doesn't drain Twilio in one hit.
 */
const MAX_PER_RUN = 200
const REFRESH_INTERVAL_DAYS = 90

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!verifyCron(req)) return res.status(401).json({ error: 'Unauthorized' })

  const sb = supabaseAdmin()
  const cutoffIso = new Date(
    Date.now() - REFRESH_INTERVAL_DAYS * 86400_000,
  ).toISOString()
  const todayIso = new Date().toISOString().slice(0, 10)

  // Candidate set: active members with a phone, ordered by oldest sync first
  // so backlog gets worked through deterministically.
  const { data: candidates, error: candErr } = await sb
    .from('knit_members')
    .select(
      'id, first_name, last_name, preferred_name, phone, ward_id, paused_until',
    )
    .not('onboarding_completed_at', 'is', null)
    .is('opted_out_at', null)
    .not('phone', 'is', null)
    .order('created_at', { ascending: true })
    .limit(2000)
  if (candErr) {
    return res.status(500).json({ error: candErr.message })
  }

  let processed = 0
  let sent = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  for (const m of candidates ?? []) {
    if (processed >= MAX_PER_RUN) break

    // Skip paused members until paused_until is in the past.
    if (m.paused_until && m.paused_until >= todayIso) {
      skipped += 1
      continue
    }

    // Has a refresh been sent to this member in the last 90 days?
    const { data: recent, error: recentErr } = await sb
      .from('knit_notifications_log')
      .select('id')
      .eq('member_id', m.id)
      .eq('type', 'availability_refresh')
      .gte('sent_at', cutoffIso)
      .limit(1)
      .maybeSingle()
    if (recentErr) {
      errors.push(`${m.id}: lookup failed — ${recentErr.message}`)
      continue
    }
    if (recent) {
      skipped += 1
      continue
    }

    // Mint a fresh magic link. This rotates any prior token, but that's
    // intended — the member's session cookie expires after 30 days, so
    // they'd need a fresh link to log back in anyway after 90 days.
    const { data: tokenValue, error: tokenErr } = await sb.rpc(
      'knit_generate_member_magic_link',
      { p_member_id: m.id },
    )
    if (tokenErr || !tokenValue) {
      failed += 1
      errors.push(`${m.id}: token mint failed — ${tokenErr?.message ?? 'no token'}`)
      continue
    }
    const url = memberInviteUrl(m.id, tokenValue as string, appOriginFromEnv())
    const firstName = m.preferred_name || m.first_name || 'there'

    // Refresh-specific SMS copy. Distinct from the initial invite so the
    // member knows this is a check-in, not a brand new request.
    const body = `Hi ${firstName} — it's been a while since you set your Knit availability. Tap to keep it the same or update it: ${url}`
    const sendRes = await sendSms(m.phone as string, body)

    // Audit log: always record, success or failure.
    await sb.from('knit_notifications_log').insert({
      member_id: m.id,
      type: 'availability_refresh',
      tidings_message_id: sendRes.providerMessageId ?? null,
      context: {
        ward_id: m.ward_id,
        outcome: sendRes.ok ? 'sent' : 'failed',
        error: sendRes.ok ? null : sendRes.error ?? null,
        recipient: m.phone,
      },
    })

    if (sendRes.ok) {
      sent += 1
    } else {
      failed += 1
      errors.push(`${m.id}: ${sendRes.error}`)
    }
    processed += 1
  }

  return res.status(200).json({
    ok: true,
    processed,
    sent,
    skipped,
    failed,
    errors: errors.slice(0, 20),
    cap: MAX_PER_RUN,
  })
}

/**
 * Direct call to the Tidings cross-project SMS edge function. The cron uses
 * a refresh-flavored message body (not the onboarding-flavored one in
 * sendInviteSms), so we inline the transport rather than build a per-template
 * wrapper. Mirrors the shape in api/_lib/inviteSend.ts so swapping is easy.
 */
async function sendSms(toPhone: string, body: string) {
  const smsUrl = process.env.TIDINGS_SMS_URL
  const secret = process.env.TIDINGS_INTERNAL_FN_SECRET
  if (!smsUrl || !secret) {
    return { ok: false, error: 'TIDINGS_SMS_URL / TIDINGS_INTERNAL_FN_SECRET not set', providerMessageId: null as string | null }
  }
  try {
    const res = await fetch(smsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone: toPhone, body, audit_tag: 'knit-availability-refresh' }),
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `gather-send-invite-sms ${res.status}: ${text.slice(0, 180)}`, providerMessageId: null as string | null }
    }
    const data = (await res.json().catch(() => null)) as { sid?: string; message_sid?: string } | null
    return { ok: true, providerMessageId: (data?.sid ?? data?.message_sid ?? null) as string | null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), providerMessageId: null as string | null }
  }
}

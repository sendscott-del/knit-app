import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyCron } from '../_lib/cronAuth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { memberInviteUrl, appOriginFromEnv } from '../_lib/inviteSend.js'
import { logServerEvent } from '../_lib/logEvent.js'

/**
 * Daily: text each active member whose last availability refresh was 90+
 * days ago (or who has never been refreshed yet) and ask them to confirm
 * or update their availability.
 *
 * Previously the dedupe check for "has this member been refreshed recently?"
 * ran a separate Supabase query PER MEMBER inside the loop — up to 2000
 * round-trips before the MAX_PER_RUN cap. Replaced with a single batched
 * IN query up front, then filter in memory. Much faster and eliminates the
 * cron-timeout risk on large wards.
 *
 * Also fixed: audit-write failures are now surfaced so a failed write
 * doesn't silently cause duplicate SMS on the next run.
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

  // Candidate set: active members with a phone, ordered by oldest first.
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
    await logServerEvent({
      name: 'cron_availability_refresh_failed',
      message: candErr.message,
      route: '/api/cron/availability-refresh',
    })
    return res.status(500).json({ error: candErr.message })
  }

  const candidateIds = (candidates ?? []).map((m) => m.id)

  // Single batch query: which of these members already received a refresh
  // in the last 90 days? This replaces the per-member IN-loop query that
  // produced up to 2000 Postgres round-trips.
  const alreadyRefreshed = new Set<string>()
  if (candidateIds.length > 0) {
    const { data: recentLogs } = await sb
      .from('knit_notifications_log')
      .select('member_id')
      .in('member_id', candidateIds)
      .eq('type', 'availability_refresh')
      .gte('sent_at', cutoffIso)
    for (const row of recentLogs ?? []) {
      alreadyRefreshed.add(row.member_id)
    }
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

    // Skip if already refreshed in the last 90 days (batched check above).
    if (alreadyRefreshed.has(m.id)) {
      skipped += 1
      continue
    }

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

    const body = `Hi ${firstName} — it's been a while since you set your Knit availability. Tap to keep it the same or update it: ${url}`
    const sendRes = await sendSms(m.phone as string, body)

    // Audit log — write and check error. If the write fails the next run will
    // re-send (no dedupe). Surface the failure so it's visible in the response
    // rather than silently producing duplicate SMS.
    const { error: auditErr } = await sb.from('knit_notifications_log').insert({
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
    if (auditErr) {
      errors.push(`${m.id}: audit write failed — ${auditErr.message} (SMS ${sendRes.ok ? 'sent' : 'failed'})`)
    }

    if (sendRes.ok) {
      sent += 1
    } else {
      failed += 1
      if (!auditErr) errors.push(`${m.id}: ${sendRes.error}`)
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

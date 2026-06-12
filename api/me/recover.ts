import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { memberInviteUrl, appOriginFromEnv } from '../_lib/inviteSend.js'

/**
 * Public, unauthenticated endpoint that lets a ward member (or someone a
 * missionary just shared the generic /join link with) self-recover or
 * self-start. The member types their first/last name and phone number; we
 * look them up in the synced ward roster (knit_members fed from Tidings),
 * mint a fresh magic-link token, and text it to them.
 *
 * Privacy: we always respond with the same generic 200 message — never leak
 * whether a phone number exists in the directory. The actual outcome (sent
 * vs not found vs rate-limited) is in the audit log only.
 *
 * Anti-abuse: we throttle by phone (one send per 5 minutes for the same
 * phone) using the recent knit_notifications_log rows as the rate-limit
 * state. Good enough for current scale; can swap to a proper IP rate limit
 * later if abuse appears.
 */

const THROTTLE_MINUTES = 5
const DAILY_CAP = 5
const GENERIC_OK = {
  ok: true,
  message:
    "If we found you in your ward roster, we just texted your Knit link to that number. Tap it to open your survey.",
}

type RecoverPayload = {
  first_name?: string
  last_name?: string
  phone?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = (req.body ?? {}) as RecoverPayload
  const firstName = (body.first_name ?? '').trim()
  const lastName = (body.last_name ?? '').trim()
  const phoneRaw = (body.phone ?? '').trim()
  if (!firstName || !lastName || !phoneRaw) {
    return res.status(400).json({
      ok: false,
      error: 'Please fill in your first name, last name, and phone number.',
    })
  }
  const phoneDigits = phoneRaw.replace(/\D+/g, '')
  if (phoneDigits.length < 10) {
    return res.status(400).json({
      ok: false,
      error: 'That phone number doesn\'t look right. Try the 10-digit number you usually get texts on.',
    })
  }

  const sb = supabaseAdmin()

  // Match strategy:
  //   1) Pull candidates by exact case-insensitive last name AND first name
  //      (or preferred name) server-side — the JS filter below requires exact
  //      equality anyway, so wildcards only inflated the candidate set; with
  //      a common last name the real member could fall outside the 50-row cap
  //      and the caller got a silent miss.
  //   2) Phone match happens in JS (no normalized phone column server-side).
  //
  // Opted-out members are matched on purpose: the dashboard their link opens
  // has a Rejoin button, and excluding them left anyone whose link expired
  // permanently stuck ("we texted you" + nothing arrives).
  const last10 = phoneDigits.slice(-10)
  const escapePattern = (s: string) => s.replace(/[%_\\]/g, ' ').replace(/,/g, ' ')

  const { data: candidates, error: candErr } = await sb
    .from('knit_members')
    .select(
      'id, ward_id, first_name, last_name, preferred_name, phone, opted_out_at, paused_until, onboarding_completed_at, created_at',
    )
    .ilike('last_name', escapePattern(lastName))
    .or(
      `first_name.ilike.${escapePattern(firstName)},preferred_name.ilike.${escapePattern(firstName)}`,
    )
    .limit(50)
  if (candErr) {
    return res.status(500).json({ ok: false, error: candErr.message })
  }

  const firstNeedle = firstName.toLowerCase()
  const lastNeedle = lastName.toLowerCase()
  const matches = (candidates ?? []).filter((m) => {
    const ln = (m.last_name ?? '').toLowerCase()
    if (ln !== lastNeedle) return false
    const fn = (m.first_name ?? '').toLowerCase()
    const pn = (m.preferred_name ?? '').toLowerCase()
    if (fn !== firstNeedle && pn !== firstNeedle) return false
    const memberPhone = (m.phone ?? '').replace(/\D+/g, '')
    // Require a full 10-digit suffix match. The old fallback
    // (last10.endsWith(memberPhone.slice(-10))) let a 7-digit legacy number
    // match any input ending in those 7 digits — which could text member A's
    // magic link to a stranger's number that happens to share a name.
    if (memberPhone.length < 10) return false
    return memberPhone.endsWith(last10)
  })

  // Tie-break: prefer the row that has already completed onboarding (so a
  // returning member always lands on their existing data). If neither is
  // onboarded, prefer the older row — manually-added rows pre-date the
  // Tidings sync and tend to be the "real" one. Same-name duplicates can
  // arise when a member was added in /admin/members before the Tidings sync
  // first ran (the sync didn't see a tidings_member_id and inserted a new
  // shell). Cleaning up duplicates is a separate follow-up.
  matches.sort((a, b) => {
    if (a.onboarding_completed_at && !b.onboarding_completed_at) return -1
    if (!a.onboarding_completed_at && b.onboarding_completed_at) return 1
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })
  const match = matches[0] ?? null

  if (!match) {
    // No match. Log the attempt so we can see legitimate misses (and abuse
    // patterns) without telling the caller anything.
    await sb.from('knit_notifications_log').insert({
      member_id: null,
      type: 'self_recovery',
      context: {
        outcome: 'not_found',
        first_name: firstName,
        last_name: lastName,
        phone_last4: phoneDigits.slice(-4),
      },
    })
    return res.status(200).json(GENERIC_OK)
  }

  // Throttle: if we've sent this exact member a recovery in the last N
  // minutes, just respond OK without re-sending. Stops accidental
  // double-submits and dumb spamming.
  const throttleCutoff = new Date(
    Date.now() - THROTTLE_MINUTES * 60_000,
  ).toISOString()
  const { data: recent } = await sb
    .from('knit_notifications_log')
    .select('id')
    .eq('member_id', match.id)
    .eq('type', 'self_recovery')
    .gte('sent_at', throttleCutoff)
    .limit(1)
    .maybeSingle()
  if (recent) {
    return res.status(200).json(GENERIC_OK)
  }

  // Daily cap: each send rotates the member's token (invalidating their
  // previous link), so someone who knows a name+phone shouldn't be able to
  // churn it every 5 minutes forever — that's Twilio cost plus a permanently
  // unstable link for the member.
  const dayCutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const { count: sentToday } = await sb
    .from('knit_notifications_log')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', match.id)
    .eq('type', 'self_recovery')
    .gte('sent_at', dayCutoff)
  if ((sentToday ?? 0) >= DAILY_CAP) {
    await sb.from('knit_notifications_log').insert({
      member_id: match.id,
      type: 'self_recovery',
      context: { outcome: 'daily_cap', phone_last4: phoneDigits.slice(-4) },
    })
    return res.status(200).json(GENERIC_OK)
  }

  // Rotate token + text the link.
  const { data: tokenValue, error: tokenErr } = await sb.rpc(
    'knit_generate_member_magic_link',
    { p_member_id: match.id },
  )
  if (tokenErr || !tokenValue) {
    await sb.from('knit_notifications_log').insert({
      member_id: match.id,
      type: 'self_recovery',
      context: { outcome: 'token_failed', error: tokenErr?.message ?? null },
    })
    return res.status(200).json(GENERIC_OK)
  }
  const url = memberInviteUrl(match.id, tokenValue as string, appOriginFromEnv())
  const recipientPhone = (match.phone ?? '').trim()
  const firstNameOut = match.preferred_name || match.first_name || 'there'

  const smsUrl = process.env.TIDINGS_SMS_URL
  const secret = process.env.TIDINGS_INTERNAL_FN_SECRET
  let sendOk = false
  let sendError: string | null = null
  let providerMessageId: string | null = null

  if (!smsUrl || !secret) {
    sendError = 'TIDINGS_SMS_URL / TIDINGS_INTERNAL_FN_SECRET not set'
  } else {
    const body = match.opted_out_at
      ? `Hi ${firstNameOut} — here's your Knit link. You're currently opted out; tap it if you'd like to rejoin: ${url}`
      : `Hi ${firstNameOut} — here's your Knit availability survey link. Tap to open or update: ${url}`
    try {
      const resp = await fetch(smsUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone: recipientPhone, body, audit_tag: 'knit-self-recovery' }),
      })
      if (!resp.ok) {
        const text = await resp.text()
        sendError = `gather-send-invite-sms ${resp.status}: ${text.slice(0, 180)}`
      } else {
        const data = (await resp.json().catch(() => null)) as
          | { sid?: string; message_sid?: string }
          | null
        providerMessageId = data?.sid ?? data?.message_sid ?? null
        sendOk = true
      }
    } catch (e) {
      sendError = e instanceof Error ? e.message : String(e)
    }
  }

  await sb.from('knit_notifications_log').insert({
    member_id: match.id,
    type: 'self_recovery',
    tidings_message_id: providerMessageId,
    context: {
      ward_id: match.ward_id,
      outcome: sendOk ? 'sent' : 'failed',
      error: sendError,
      recipient: recipientPhone,
    },
  })

  // Always respond with the generic message — never reveal whether the
  // phone is in the directory or whether the send actually succeeded.
  return res.status(200).json(GENERIC_OK)
}

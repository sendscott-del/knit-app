// Shared invitation senders. Used by /api/admin/invitations (admin app
// "Send invite" button) and by api/_lib/sheetPull.ts (missionary sheet sweep).

export type InviteSendResult = {
  ok: boolean
  error?: string
  providerMessageId?: string | null
}

export async function sendInviteEmail(
  toEmail: string,
  firstName: string,
  url: string,
): Promise<InviteSendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not set' }

  const from = process.env.KNIT_INVITE_FROM ?? 'Knit <noreply@gathered.app>'
  const subject = 'Your Knit availability survey'
  const text = `Hi ${firstName || 'there'},

Here's your personal link to fill in your Knit availability so the missionaries can pair you with people who'd be a great fit for the times you're free. Takes about a minute.

${url}

This link is unique to you and valid for 30 days. Thanks!`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: toEmail, subject, text }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 180)}` }
    }
    const data = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, providerMessageId: data?.id ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function sendInviteSms(
  toPhone: string,
  firstName: string,
  url: string,
): Promise<InviteSendResult> {
  const smsUrl = process.env.TIDINGS_SMS_URL
  const secret = process.env.TIDINGS_INTERNAL_FN_SECRET
  if (!smsUrl || !secret) {
    return { ok: false, error: 'TIDINGS_SMS_URL / TIDINGS_INTERNAL_FN_SECRET not set' }
  }

  const body = `Hi ${firstName || 'there'} — here's your Knit availability survey so we can pair you with missionaries you'd be a great fit for. Takes about a minute. ${url}`

  try {
    const res = await fetch(smsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone: toPhone, body, audit_tag: 'knit-invite' }),
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `gather-send-invite-sms ${res.status}: ${text.slice(0, 180)}` }
    }
    const data = (await res.json().catch(() => null)) as { sid?: string; message_sid?: string } | null
    return {
      ok: true,
      providerMessageId: data?.sid ?? data?.message_sid ?? null,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function appOriginFromEnv(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VITE_APP_URL ??
    'https://knit-app.vercel.app'
  )
}

export function memberInviteUrl(memberId: string, token: string, origin?: string): string {
  const base = origin ?? appOriginFromEnv()
  return `${base}/m/${memberId}/${token}`
}

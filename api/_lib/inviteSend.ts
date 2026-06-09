// Shared invitation sender. Used by /api/admin/invitations (Invitations
// page "Send by text" button) and by api/_lib/sheetPull.ts (missionary
// sheet sweep). SMS-only as of v0.34.4 — Tidings doesn't carry email
// addresses, so the email path was always going to fall back to this.

export type InviteSendResult = {
  ok: boolean
  error?: string
  providerMessageId?: string | null
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
  // Default points at the actual production alias for this project. The
  // earlier "knit-app.vercel.app" guess was unclaimed and 404'd, breaking
  // every magic link sent before the env var was set. Set NEXT_PUBLIC_APP_URL
  // (or VITE_APP_URL) on Vercel to override if the alias changes.
  // Use || (not ??) so an empty-string env value falls through to the fallback
  // rather than producing a domain-less relative link.
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VITE_APP_URL ||
    'https://knit.gatheredin.app'
  )
}

export function memberInviteUrl(memberId: string, token: string, origin?: string): string {
  const base = origin ?? appOriginFromEnv()
  return `${base}/m/${memberId}/${token}`
}

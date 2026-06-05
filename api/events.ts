import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'

/**
 * Public, unauthenticated write endpoint for client telemetry (errors today,
 * named usage events later). The browser cannot insert into knit_events
 * directly — RLS only allows app-super-admin reads — so this endpoint takes
 * a scrubbed payload and writes it with the service role.
 *
 * Why unauthenticated: a member hitting a render error on the magic-link
 * page has no Supabase session, and that's exactly the error we most want to
 * see. So we accept anonymous reports but defend the table:
 *  - allow-list the fields; ignore anything caller-supplied beyond them
 *  - hard length caps so payloads can't bloat the table
 *  - validate enums; reject junk with 400
 *  - never trust caller-supplied identity (no admin_id accepted here)
 *
 * Church-lane note: callers are instructed not to send PII; we additionally
 * cap message/detail size. We do not attempt server-side name redaction —
 * runtime error strings rarely contain member data, and only the stake
 * presidency can read the table.
 */

const ALLOWED_KIND = new Set(['error', 'event'])
const ALLOWED_SEVERITY = new Set(['info', 'warning', 'error'])
const ALLOWED_SOURCE = new Set(['client'])

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // sendBeacon delivers a Blob; Vercel may hand us a string body.
  let body: Record<string, unknown>
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  const kind = typeof body.kind === 'string' ? body.kind : 'error'
  const source = typeof body.source === 'string' ? body.source : 'client'
  const severity = typeof body.severity === 'string' ? body.severity : 'error'
  const name = clampStr(body.name, 120)

  if (!name) return res.status(400).json({ error: 'name required' })
  if (!ALLOWED_KIND.has(kind)) return res.status(400).json({ error: 'bad kind' })
  if (!ALLOWED_SOURCE.has(source)) return res.status(400).json({ error: 'bad source' })
  if (!ALLOWED_SEVERITY.has(severity)) return res.status(400).json({ error: 'bad severity' })

  // detail: accept a plain object only, re-serialize through a size cap.
  let detail: Record<string, unknown> = {}
  if (body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail)) {
    try {
      const json = JSON.stringify(body.detail)
      detail = json.length > 2000 ? { truncated: true } : (body.detail as Record<string, unknown>)
    } catch {
      detail = {}
    }
  }

  try {
    const { error } = await supabaseAdmin()
      .from('knit_events')
      .insert({
        kind,
        name,
        severity,
        source: 'client',
        route: clampStr(body.route, 200),
        message: clampStr(body.message, 1000),
        detail,
        app_version: clampStr(body.app_version, 40),
        user_agent: clampStr(req.headers['user-agent'], 400),
      })
    if (error) {
      // Don't leak DB internals to an anonymous caller; just signal failure.
      return res.status(500).json({ ok: false })
    }
    return res.status(202).json({ ok: true })
  } catch {
    return res.status(500).json({ ok: false })
  }
}

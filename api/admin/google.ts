import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomBytes } from 'node:crypto'
import { requireAdmin } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { authUrlFor } from '../_lib/googleOAuth.js'
import { setCookie } from '../_lib/cookies.js'

/**
 * Consolidated Google-integration admin endpoint. Folds the former
 * /api/admin/google/{authorize,disconnect,status} endpoints into one to stay
 * under Vercel Hobby's 12-function cap. The OAuth callback remains at
 * /api/admin/google/callback because Google redirects there directly and the
 * URI is registered in the OAuth client config.
 *
 * Routing:
 *   GET  /api/admin/google?action=status      -> status
 *   GET  /api/admin/google                    -> status (default)
 *   POST /api/admin/google  { action: 'authorize' }
 *   POST /api/admin/google  { action: 'disconnect' }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return status(req, res)
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = (req.body ?? {}) as { action?: string }
  switch (body.action) {
    case 'authorize':
      return authorize(req, res)
    case 'disconnect':
      return disconnect(req, res)
    case 'status':
      return status(req, res)
    default:
      return res.status(400).json({ error: 'Unknown action' })
  }
}

async function authorize(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  if (!auth.admin.stake_id) {
    return res.status(400).json({ error: 'Your admin account has no stake.' })
  }
  try {
    const state = randomBytes(24).toString('hex')
    setCookie(res, 'knit_oauth_state', state, { maxAgeSeconds: 600 })
    const url = authUrlFor(state)
    return res.status(200).json({ url })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return res.status(500).json({ error: message })
  }
}

async function disconnect(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  if (!auth.admin.stake_id) return res.status(400).json({ error: 'No stake' })

  const sb = supabaseAdmin()
  await sb
    .from('knit_google_oauth')
    .delete()
    .eq('stake_id', auth.admin.stake_id)
  return res.status(200).json({ ok: true })
}

async function status(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  if (!auth.admin.stake_id) {
    return res.status(200).json({ connected: false })
  }

  const sb = supabaseAdmin()
  const { data } = await sb
    .from('knit_google_oauth')
    .select('granted_by_email, granted_at')
    .eq('stake_id', auth.admin.stake_id)
    .maybeSingle()

  if (!data) return res.status(200).json({ connected: false })
  return res
    .status(200)
    .json({ connected: true, email: data.granted_by_email, granted_at: data.granted_at })
}

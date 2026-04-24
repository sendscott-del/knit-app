import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomBytes } from 'node:crypto'
import { requireAdmin } from '../../_lib/auth.js'
import { authUrlFor } from '../../_lib/googleOAuth.js'
import { setCookie } from '../../_lib/cookies.js'

/**
 * Returns a Google OAuth consent URL. The admin's client redirects the browser
 * there. On callback we verify the state matches what's in our cookie.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

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

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAdmin } from '../../_lib/auth.js'

/** Returns the service account email the admin needs to share the sheet with. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  return res.status(200).json({
    service_account_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
  })
}

import type { VercelRequest } from '@vercel/node'

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is
 * set in the project's env. Only endpoints called by the cron runner should pass.
 */
export function verifyCron(req: VercelRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const h = req.headers.authorization ?? req.headers.Authorization
  const raw = Array.isArray(h) ? h[0] : h
  if (!raw?.toLowerCase().startsWith('bearer ')) return false
  return raw.slice(7).trim() === expected
}

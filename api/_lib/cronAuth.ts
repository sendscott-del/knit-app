import type { VercelRequest } from '@vercel/node'
import { timingSafeEqual } from 'node:crypto'

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is
 * set in the project's env. Only endpoints called by the cron runner should pass.
 *
 * Constant-time comparison: `===` short-circuits on the first differing byte,
 * which leaks prefix-match timing to an attacker probing the secret.
 */
export function verifyCron(req: VercelRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const h = req.headers.authorization ?? req.headers.Authorization
  const raw = Array.isArray(h) ? h[0] : h
  if (!raw?.toLowerCase().startsWith('bearer ')) return false
  const provided = raw.slice(7).trim()
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

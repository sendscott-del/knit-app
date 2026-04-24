import type { VercelRequest } from '@vercel/node'
import { supabaseAdmin } from './supabaseAdmin.js'
import type { AdminRole, AdminRow } from './types.js'

export type AuthenticatedAdmin = {
  userId: string
  email: string
  admin: AdminRow
}

function getBearerToken(req: VercelRequest): string | null {
  const h = req.headers.authorization ?? req.headers.Authorization
  const raw = Array.isArray(h) ? h[0] : h
  if (!raw) return null
  if (!raw.toLowerCase().startsWith('bearer ')) return null
  return raw.slice(7).trim()
}

/**
 * Verifies the Supabase access token on the request and resolves the caller's
 * Knit admin row. Returns null if unauthenticated or not a Knit admin.
 */
export async function requireAdmin(
  req: VercelRequest,
): Promise<AuthenticatedAdmin | null> {
  const token = getBearerToken(req)
  if (!token) return null

  const sb = supabaseAdmin()
  const { data: userData, error: userErr } = await sb.auth.getUser(token)
  if (userErr || !userData.user) return null
  const user = userData.user

  const { data: admin } = await sb
    .from('knit_admin_users')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()
  if (!admin) return null
  return { userId: user.id, email: user.email ?? '', admin: admin as AdminRow }
}

export async function adminCanActOnWard(
  admin: AdminRow,
  wardId: string,
): Promise<boolean> {
  if (admin.role === 'ward_mission_leader') {
    return admin.ward_id === wardId
  }
  const sb = supabaseAdmin()
  const { data: ward } = await sb
    .from('knit_wards')
    .select('id, stake_id')
    .eq('id', wardId)
    .maybeSingle()
  if (!ward) return false
  return (ward as { stake_id: string }).stake_id === admin.stake_id
}

export function roleIsWritable(role: AdminRole): boolean {
  return role === 'ward_mission_leader' || role === 'stake_missionary_hc'
}

import type { VercelRequest } from '@vercel/node'
import { supabaseAdmin } from './supabaseAdmin.js'
import type { AdminRole, AdminRow } from './types.js'
import { WARD_EDIT_ROLES } from './types.js'

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

/**
 * True when this admin is allowed to write to records under the given ward.
 * Super admins always pass. Ward-edit roles must match the ward.
 * Stake-view roles (stake_presidency, high_councilor) never write — they're
 * view-only by design.
 */
export async function adminCanActOnWard(
  admin: AdminRow,
  wardId: string,
): Promise<boolean> {
  if (admin.is_super_admin) return true
  if ((WARD_EDIT_ROLES as readonly AdminRole[]).includes(admin.role)) {
    return admin.ward_id === wardId
  }
  return false
}

/**
 * True when this admin can at least read records under the given ward.
 * Super admins always pass. Stake-view roles see anything in their stake.
 */
export async function adminCanViewWard(
  admin: AdminRow,
  wardId: string,
): Promise<boolean> {
  if (admin.is_super_admin) return true
  if ((WARD_EDIT_ROLES as readonly AdminRole[]).includes(admin.role)) {
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
  return (WARD_EDIT_ROLES as readonly AdminRole[]).includes(role)
}

import type { Database } from './database.types'
import type { AdminProfile } from './useAdmin'

export type AdminRole = Database['public']['Enums']['knit_admin_role']

export const ROLE_LABELS: Record<AdminRole, string> = {
  stake_presidency: 'Stake Presidency',
  high_councilor: 'High Councilor',
  ward_mission_leader: 'Ward Mission Leader',
  relief_society_presidency: 'Relief Society Presidency',
  elders_quorum_presidency: 'Elders Quorum Presidency',
}

export const WARD_EDIT_ROLES: readonly AdminRole[] = [
  'ward_mission_leader',
  'relief_society_presidency',
  'elders_quorum_presidency',
]

export const STAKE_VIEW_ROLES: readonly AdminRole[] = [
  'stake_presidency',
  'high_councilor',
]

export function isWardScoped(role: AdminRole): boolean {
  return WARD_EDIT_ROLES.includes(role)
}

export function isStakeScoped(role: AdminRole): boolean {
  return STAKE_VIEW_ROLES.includes(role)
}

/** True if this admin can write data in their assigned scope. */
export function canEdit(profile: Pick<AdminProfile, 'role' | 'is_super_admin'>): boolean {
  if (profile.is_super_admin) return true
  return WARD_EDIT_ROLES.includes(profile.role)
}

/** True if this admin manages the stake itself (admins, ward roster). */
export function canManageStake(
  profile: Pick<AdminProfile, 'role' | 'is_super_admin'>,
): boolean {
  return profile.is_super_admin || profile.role === 'stake_presidency'
}

/**
 * True if this admin can send member invitations and view the invitations
 * audit page. Covers ward-edit roles (WML / RS / EQ presidencies) and any
 * "app super admin" — i.e. stake_president, stake_clerk, hc_missionary_work
 * (via gather_user_roles) or knit_admin_users.is_super_admin. Server enforces
 * the same gate via knit_is_app_super_admin / knit_is_ward_super_admin.
 */
export function canSendInvitations(
  profile: Pick<AdminProfile, 'role' | 'is_super_admin' | 'is_app_super_admin'>,
): boolean {
  if (profile.is_super_admin || profile.is_app_super_admin) return true
  return WARD_EDIT_ROLES.includes(profile.role)
}

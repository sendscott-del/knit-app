import type { TFunction } from 'i18next'
import type { Database } from './database.types'
import type { AdminProfile } from './useAdmin'

export type AdminRole = Database['public']['Enums']['knit_admin_role']

/**
 * English fallback labels for AdminRole values. Use `roleLabel(role, t)`
 * in components so the EN/ES toggle works; this map is the source of truth
 * for the EN string and is also used when no `t` is available (e.g.
 * server-side log messages).
 */
export const ROLE_LABELS: Record<AdminRole, string> = {
  stake_presidency: 'Stake Presidency',
  high_councilor: 'High Councilor',
  ward_mission_leader: 'Ward Mission Leader',
  relief_society_presidency: 'Relief Society Presidency',
  elders_quorum_presidency: 'Elders Quorum Presidency',
}

/**
 * Localized label for an AdminRole. Components should call this with the
 * useTranslation 't' so role chips and breadcrumbs follow the language
 * toggle. Falls back to the English label in ROLE_LABELS if the key isn't
 * translated yet.
 */
export function roleLabel(role: AdminRole, t: TFunction): string {
  const translated = t(`roles.${role}`, { defaultValue: ROLE_LABELS[role] })
  return translated || ROLE_LABELS[role]
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

/**
 * True if this admin can write data in their assigned scope.
 *
 * Honors both the `knit_admin_users.is_super_admin` column AND the derived
 * `is_app_super_admin` flag (true when the user has a Knit-super-admin
 * Gathered role: stake_president, stake_clerk, hc_missionary_work). A
 * super admin should be able to do everything any other user can do —
 * the column-only check missed users who earned super-admin status via
 * the Gathered roles catalog instead of the explicit column toggle.
 */
export function canEdit(
  profile: Pick<AdminProfile, 'role' | 'is_super_admin' | 'is_app_super_admin'>,
): boolean {
  if (profile.is_super_admin || profile.is_app_super_admin) return true
  return WARD_EDIT_ROLES.includes(profile.role)
}

/**
 * True if this admin manages the stake itself (admins, ward roster).
 *
 * Honors both the `knit_admin_users.is_super_admin` column AND the derived
 * `is_app_super_admin` flag (true for the Knit-super-admin Gathered roles:
 * stake_president, stake_clerk, hc_missionary_work). The column-only check
 * locked app super admins (e.g. the HC over Missionary Work) out of the
 * Users & roles page even though canEdit / canSendInvitations and the
 * server-side requireAdmin overlay already treat them as super admins.
 */
export function canManageStake(
  profile: Pick<AdminProfile, 'role' | 'is_super_admin' | 'is_app_super_admin'>,
): boolean {
  if (profile.is_super_admin || profile.is_app_super_admin) return true
  return profile.role === 'stake_presidency'
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

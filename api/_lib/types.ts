// Minimal types used by /api/. Kept local so the serverless bundle doesn't
// need to reach into src/, which Vercel may not include in the function bundle.

export type AdminRole =
  | 'stake_presidency'
  | 'high_councilor'
  | 'ward_mission_leader'
  | 'relief_society_presidency'
  | 'elders_quorum_presidency'

export const WARD_EDIT_ROLES = [
  'ward_mission_leader',
  'relief_society_presidency',
  'elders_quorum_presidency',
] as const satisfies readonly AdminRole[]

export const STAKE_VIEW_ROLES = [
  'stake_presidency',
  'high_councilor',
] as const satisfies readonly AdminRole[]

export type AdminRow = {
  id: string
  email: string
  name: string | null
  role: AdminRole
  stake_id: string | null
  ward_id: string | null
  is_super_admin: boolean
  created_at: string
}

export type SheetStatus = 'healthy' | 'error' | 'not_configured'

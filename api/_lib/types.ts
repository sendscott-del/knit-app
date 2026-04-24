// Minimal types used by /api/. Kept local so the serverless bundle doesn't
// need to reach into src/, which Vercel may not include in the function bundle.

export type AdminRole =
  | 'stake_president'
  | 'stake_missionary_hc'
  | 'ward_mission_leader'

export type AdminRow = {
  id: string
  email: string
  name: string | null
  role: AdminRole
  stake_id: string | null
  ward_id: string | null
  created_at: string
}

export type SheetStatus = 'healthy' | 'error' | 'not_configured'

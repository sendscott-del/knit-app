import { createClient } from '@supabase/supabase-js'

// Cross-project client pointed at the Tidings Supabase project so Knit's
// /admin/gather screen can surface and manage Tidings users without forcing
// the super admin to hop apps.
//
// Env vars (set in Vercel + .env.local):
//   VITE_GATHER_TIDINGS_SUPABASE_URL      — defaults to jdlykebsqafcngpntxma.supabase.co
//   VITE_GATHER_TIDINGS_SUPABASE_ANON_KEY — required (publishable key)
const url =
  (import.meta.env.VITE_GATHER_TIDINGS_SUPABASE_URL as string | undefined) ??
  'https://jdlykebsqafcngpntxma.supabase.co'

const anon = import.meta.env.VITE_GATHER_TIDINGS_SUPABASE_ANON_KEY as
  | string
  | undefined

export const gatherTidingsClient =
  url && anon
    ? createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    : null

export interface TidingsUser {
  id: string
  email: string
  full_name: string | null
  role: string | null
  ward: string | null
}

export async function fetchTidingsUsers(): Promise<TidingsUser[] | null> {
  if (!gatherTidingsClient) return null
  const { data, error } = await gatherTidingsClient.rpc('gather_tidings_users')
  if (error) {
    console.warn('[gather] Tidings users RPC error:', error.message)
    return null
  }
  if (!Array.isArray(data)) return null
  return data as TidingsUser[]
}

export async function grantTidingsUser(
  email: string,
  fullName: string | null,
  role: string,
  ward: string | null,
): Promise<string | null> {
  if (!gatherTidingsClient) return null
  const { data, error } = await gatherTidingsClient.rpc('gather_tidings_grant_user', {
    p_email: email,
    p_full_name: fullName,
    p_role: role,
    p_ward: ward,
  })
  if (error) {
    console.warn('[gather] grantTidingsUser error:', error.message)
    return null
  }
  return data as string
}

export async function updateTidingsUser(
  id: string,
  role: string | null,
  ward: string | null,
): Promise<boolean> {
  if (!gatherTidingsClient) return false
  const { error } = await gatherTidingsClient.rpc('gather_tidings_update_user', {
    p_id: id,
    p_role: role,
    p_ward: ward,
  })
  if (error) {
    console.warn('[gather] updateTidingsUser error:', error.message)
    return false
  }
  return true
}

export async function revokeTidingsUser(id: string): Promise<boolean> {
  if (!gatherTidingsClient) return false
  const { error } = await gatherTidingsClient.rpc('gather_tidings_revoke_user', {
    p_id: id,
  })
  if (error) {
    console.warn('[gather] revokeTidingsUser error:', error.message)
    return false
  }
  return true
}

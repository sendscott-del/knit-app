import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import type { Database } from './database.types'

type AdminRow = Database['public']['Tables']['knit_admin_users']['Row']
type StakeRow = Database['public']['Tables']['knit_stakes']['Row']
type WardRow = Database['public']['Tables']['knit_wards']['Row']

export type AdminProfile = AdminRow & {
  stake: StakeRow | null
  ward: WardRow | null
  // True when the caller qualifies as an "app super admin" via either
  // knit_admin_users.is_super_admin OR the gather_user_roles catalog
  // (stake_president, stake_clerk, hc_missionary_work). Populated by the
  // knit_is_app_super_admin() RPC.
  is_app_super_admin: boolean
}

type AdminState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'no_admin_row'; email: string }
  | { status: 'ready'; profile: AdminProfile }
  | { status: 'error'; message: string }

export function useAdmin(): AdminState {
  const { user, loading } = useAuth()
  const [state, setState] = useState<AdminState>({ status: 'loading' })

  useEffect(() => {
    if (loading) {
      setState({ status: 'loading' })
      return
    }
    if (!user) {
      setState({ status: 'unauthenticated' })
      return
    }

    let cancelled = false

    ;(async () => {
      const [adminRes, appSuperRes] = await Promise.all([
        supabase
          .from('knit_admin_users')
          .select(
            'id, email, name, role, stake_id, ward_id, is_super_admin, created_at, stake:knit_stakes(*), ward:knit_wards(*)',
          )
          .eq('id', user.id)
          .maybeSingle(),
        supabase.rpc('knit_is_app_super_admin'),
      ])

      if (cancelled) return

      if (adminRes.error) {
        setState({ status: 'error', message: adminRes.error.message })
        return
      }
      if (!adminRes.data) {
        setState({ status: 'no_admin_row', email: user.email ?? '' })
        return
      }
      // Don't silently downgrade: if the super-admin RPC errors, the stake
      // president quietly loses Users & roles for the session with no signal.
      if (appSuperRes.error) {
        console.warn('knit_is_app_super_admin failed:', appSuperRes.error.message)
      }
      const isAppSuper =
        Boolean(adminRes.data.is_super_admin) || Boolean(appSuperRes.data)
      setState({
        status: 'ready',
        profile: {
          ...adminRes.data,
          stake: Array.isArray(adminRes.data.stake)
            ? adminRes.data.stake[0] ?? null
            : adminRes.data.stake,
          ward: Array.isArray(adminRes.data.ward)
            ? adminRes.data.ward[0] ?? null
            : adminRes.data.ward,
          is_app_super_admin: isAppSuper,
        } as AdminProfile,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [user, loading])

  return state
}

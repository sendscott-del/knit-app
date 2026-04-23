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
      const { data, error } = await supabase
        .from('knit_admin_users')
        .select(
          'id, email, name, role, stake_id, ward_id, created_at, stake:knit_stakes(*), ward:knit_wards(*)',
        )
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        setState({ status: 'error', message: error.message })
        return
      }
      if (!data) {
        setState({ status: 'no_admin_row', email: user.email ?? '' })
        return
      }
      setState({
        status: 'ready',
        profile: {
          ...data,
          stake: Array.isArray(data.stake) ? data.stake[0] ?? null : data.stake,
          ward: Array.isArray(data.ward) ? data.ward[0] ?? null : data.ward,
        } as AdminProfile,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [user, loading])

  return state
}

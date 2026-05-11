import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { AdminProfile } from './useAdmin'
import { isWardScoped } from './roles'

export type WardOption = { id: string; name: string; stake_id: string }

/**
 * Returns the wards this admin is allowed to act in.
 *   - Super admin: all wards in their stake (or all, if no stake set)
 *   - Stake-view roles: all wards in their stake
 *   - Ward-edit roles: just their own ward
 */
export function useWardOptions(profile: AdminProfile) {
  const [wards, setWards] = useState<WardOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      let q
      if (isWardScoped(profile.role) && !profile.is_super_admin) {
        q = supabase
          .from('knit_wards')
          .select('id, name, stake_id')
          .eq('id', profile.ward_id ?? '')
      } else if (profile.stake_id) {
        q = supabase
          .from('knit_wards')
          .select('id, name, stake_id')
          .eq('stake_id', profile.stake_id)
          .order('name')
      } else {
        q = supabase.from('knit_wards').select('id, name, stake_id').order('name')
      }

      const { data, error } = await q
      if (cancelled) return
      if (error) setError(error.message)
      else setWards(data ?? [])
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [profile.role, profile.stake_id, profile.ward_id, profile.is_super_admin])

  return { wards, loading, error }
}

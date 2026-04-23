import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { AdminProfile } from './useAdmin'

export type WardOption = { id: string; name: string; stake_id: string }

export function useWardOptions(profile: AdminProfile) {
  const [wards, setWards] = useState<WardOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      const q =
        profile.role === 'ward_mission_leader'
          ? supabase
              .from('knit_wards')
              .select('id, name, stake_id')
              .eq('id', profile.ward_id ?? '')
          : supabase
              .from('knit_wards')
              .select('id, name, stake_id')
              .eq('stake_id', profile.stake_id ?? '')
              .order('name')

      const { data, error } = await q
      if (cancelled) return
      if (error) setError(error.message)
      else setWards(data ?? [])
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [profile.role, profile.stake_id, profile.ward_id])

  return { wards, loading, error }
}

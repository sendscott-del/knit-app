import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type KnitDemoRole =
  | 'stake_president'
  | 'stake_missionary_hc'
  | 'ward_mission_leader'
  | 'member'

export const KNIT_DEMO_ROLE_LABELS: Record<KnitDemoRole, string> = {
  stake_president: 'Stake President',
  stake_missionary_hc: 'Stake HC (Missionary)',
  ward_mission_leader: 'Ward Mission Leader',
  member: 'Member',
}

interface DemoMode {
  /** True when the trainer wants the role-switcher banner visible. */
  demoBannerOn: boolean
  /** Role the viewer is "logged in as" while demoing. */
  demoRole: KnitDemoRole
  setDemoBannerOn: (on: boolean) => void
  setDemoRole: (role: KnitDemoRole) => void
}

const Ctx = createContext<DemoMode | null>(null)
const KEY_BANNER = 'knit.demoBannerOn'
const KEY_ROLE = 'knit.demoRole'

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [demoBannerOn, setBanner] = useState(false)
  const [demoRole, setRole] = useState<KnitDemoRole>('stake_missionary_hc')

  useEffect(() => {
    if (typeof window === 'undefined') return
    setBanner(window.localStorage.getItem(KEY_BANNER) === 'on')
    const r = window.localStorage.getItem(KEY_ROLE) as KnitDemoRole | null
    if (r && r in KNIT_DEMO_ROLE_LABELS) setRole(r)
  }, [])

  const setDemoBannerOn = useCallback((on: boolean) => {
    setBanner(on)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(KEY_BANNER, on ? 'on' : 'off')
    }
  }, [])

  const setDemoRole = useCallback((role: KnitDemoRole) => {
    setRole(role)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(KEY_ROLE, role)
    }
  }, [])

  return (
    <Ctx.Provider value={{ demoBannerOn, demoRole, setDemoBannerOn, setDemoRole }}>
      {children}
    </Ctx.Provider>
  )
}

export function useDemoMode(): DemoMode {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDemoMode must be used inside <DemoModeProvider>')
  return ctx
}

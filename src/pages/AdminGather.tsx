import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'

// The shared Gather tables (user_apps, gather_super_admins, gather_app_users)
// live in the Scott's Apps Supabase project but are not part of Knit's
// generated database.types.ts (which only knows knit_* tables). We talk to
// them through this loosely-typed handle to avoid fighting the type checker.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as any

const APPS = ['magnify', 'steward', 'glean', 'tidings', 'knit'] as const
type AppName = typeof APPS[number]

interface GatherAppUser {
  user_id: string
  email: string | null
  account_created_at: string
  apps: Array<{ app_name: AppName; role: string | null; granted_at: string }>
  is_super_admin: boolean
  super_admin_role: 'stake_president' | 'stake_clerk' | null
}

const APP_COLORS: Record<AppName, string> = {
  magnify: '#1B3A6B',
  steward: '#2563EB',
  glean: '#C9A84C',
  tidings: '#F59E0B',
  knit: '#E11D48',
}

const APP_LABELS: Record<AppName, string> = {
  magnify: 'Magnify',
  steward: 'Steward',
  glean: 'Glean',
  tidings: 'Tidings',
  knit: 'Knit',
}

export default function AdminGather() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null)
  const [users, setUsers] = useState<GatherAppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await sb
      .from('gather_app_users')
      .select('*')
      .order('email', { ascending: true })
    if (error) setError(error.message)
    else setUsers((data as unknown as GatherAppUser[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!session?.user) return
    void (async () => {
      const { data } = await sb
        .from('gather_super_admins')
        .select('user_id')
        .eq('user_id', session.user.id)
        .maybeSingle()
      setIsSuperAdmin(!!data)
    })()
  }, [session?.user])

  useEffect(() => {
    if (isSuperAdmin) void refresh()
  }, [isSuperAdmin, refresh])

  async function toggleApp(target: GatherAppUser, app: AppName) {
    setBusyId(target.user_id)
    setError('')
    const has = target.apps.some(a => a.app_name === app)
    if (has) {
      const { error } = await sb
        .from('user_apps')
        .delete()
        .eq('user_id', target.user_id)
        .eq('app_name', app)
      if (error) setError(error.message)
    } else {
      const { error } = await sb
        .from('user_apps')
        .upsert(
          { user_id: target.user_id, app_name: app, role: 'member', granted_by: session?.user?.id ?? null },
          { onConflict: 'user_id,app_name' }
        )
      if (error) setError(error.message)
    }
    setBusyId(null)
    void refresh()
  }

  async function setSuperAdmin(target: GatherAppUser, role: 'stake_president' | 'stake_clerk' | null) {
    setBusyId(target.user_id)
    setError('')
    if (role === null) {
      const { error } = await sb.from('gather_super_admins').delete().eq('user_id', target.user_id)
      if (error) setError(error.message)
    } else {
      const { error } = await sb
        .from('gather_super_admins')
        .upsert({ user_id: target.user_id, role, granted_by: session?.user?.id ?? null }, { onConflict: 'user_id' })
      if (error) setError(error.message)
    }
    setBusyId(null)
    void refresh()
  }

  const filtered = useMemo(() => {
    if (!filter.trim()) return users
    const q = filter.toLowerCase()
    return users.filter(u => (u.email ?? '').toLowerCase().includes(q))
  }, [users, filter])

  if (isSuperAdmin === null) {
    return <div className="px-4 py-8 text-sm text-gray-500">Checking access…</div>
  }

  if (!isSuperAdmin) {
    return (
      <div className="px-4 py-8 max-w-md mx-auto text-center space-y-3">
        <p className="text-sm text-gray-500">
          This screen is only available to the Stake President and Stake Clerk.
        </p>
        <button
          onClick={() => navigate('/admin')}
          className="text-sm text-knit-primary font-semibold hover:underline"
        >
          Back to Knit
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Gather — Manage user access</h1>
        <p className="text-sm text-gray-600">
          Grant each member access to the apps they need. Toggling an app on or off updates the
          shared <code>user_apps</code> table that powers the &ldquo;Gathered&rdquo; switcher in
          every app.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search by email…"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-knit-primary"
        />
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="px-3 py-2 text-sm font-medium text-knit-primary hover:bg-gray-100 rounded-lg disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">User</th>
              {APPS.map(app => (
                <th key={app} className="text-center px-2 py-2 font-semibold" title={APP_LABELS[app]}>
                  <span
                    style={{
                      display: 'inline-flex',
                      width: 22,
                      height: 22,
                      borderRadius: 7,
                      backgroundColor: APP_COLORS[app],
                      color: 'white',
                      fontSize: 11,
                      fontWeight: 800,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    aria-hidden="true"
                  >
                    {APP_LABELS[app][0]}
                  </span>
                </th>
              ))}
              <th className="text-left px-4 py-2 font-semibold">Super admin</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={APPS.length + 2} className="px-4 py-8 text-center text-gray-400">No users.</td>
              </tr>
            )}
            {filtered.map(u => {
              const grants = new Map(u.apps.map(a => [a.app_name, a.role]))
              return (
                <tr key={u.user_id} className="border-t border-gray-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 truncate">{u.email || '(no email)'}</div>
                    <div className="text-xs text-gray-500">{new Date(u.account_created_at).toLocaleDateString()}</div>
                  </td>
                  {APPS.map(app => {
                    const enabled = grants.has(app)
                    return (
                      <td key={app} className="text-center px-2 py-3">
                        <button
                          type="button"
                          onClick={() => void toggleApp(u, app)}
                          disabled={busyId === u.user_id}
                          aria-pressed={enabled}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md border transition-colors disabled:opacity-40"
                          style={{
                            backgroundColor: enabled ? APP_COLORS[app] : 'white',
                            borderColor: enabled ? APP_COLORS[app] : '#D1D5DB',
                            color: enabled ? 'white' : '#9CA3AF',
                          }}
                          title={enabled ? `Revoke ${APP_LABELS[app]}` : `Grant ${APP_LABELS[app]}`}
                        >
                          {enabled ? '✓' : ''}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-4 py-3">
                    <select
                      value={u.super_admin_role ?? ''}
                      onChange={e => {
                        const v = e.target.value
                        void setSuperAdmin(u, v === '' ? null : (v as 'stake_president' | 'stake_clerk'))
                      }}
                      disabled={busyId === u.user_id}
                      className="text-xs px-2 py-1 border border-gray-300 rounded-md bg-white disabled:opacity-40"
                    >
                      <option value="">— none —</option>
                      <option value="stake_president">Stake President</option>
                      <option value="stake_clerk">Stake Clerk</option>
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Super admins (Stake President, Stake Clerk) can see every user and grant or revoke
        access to any app. Their own super-admin status only changes via this screen.
      </p>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

// Mirrors public.gather_roles_catalog. Kept in sync with the catalog seeded
// by migration 0006_gather_user_roles.sql on the shared Supabase project.
type RoleScope = 'stake' | 'ward'
const SUITE_ROLES: Array<{ key: string; label: string; scope: RoleScope }> = [
  { key: 'stake_president',           label: 'Stake President',                          scope: 'stake' },
  { key: 'stake_clerk',                label: 'Stake Clerk',                              scope: 'stake' },
  { key: 'sp_1st_counselor',           label: 'Stake Presidency 1st Counselor',           scope: 'stake' },
  { key: 'sp_2nd_counselor',           label: 'Stake Presidency 2nd Counselor',           scope: 'stake' },
  { key: 'stake_exec_secretary',       label: 'Stake Executive Secretary',                scope: 'stake' },
  { key: 'high_councilor',             label: 'High Councilor',                           scope: 'stake' },
  { key: 'hc_missionary_work',         label: 'High Councilor — Missionary Work',         scope: 'stake' },
  { key: 'hc_welfare_self_reliance',   label: 'High Councilor — Welfare & Self Reliance', scope: 'stake' },
  { key: 'community_events_leader',    label: 'Community Events Leader',                  scope: 'stake' },
  { key: 'stake_council',              label: 'Stake Council',                            scope: 'stake' },
  { key: 'bishop',                     label: 'Bishop',                                   scope: 'ward'  },
  { key: 'bishopric_1st_counselor',    label: 'Bishopric 1st Counselor',                  scope: 'ward'  },
  { key: 'bishopric_2nd_counselor',    label: 'Bishopric 2nd Counselor',                  scope: 'ward'  },
  { key: 'ward_clerk',                 label: 'Ward Clerk',                               scope: 'ward'  },
  { key: 'ward_exec_secretary',        label: 'Ward Executive Secretary',                 scope: 'ward'  },
  { key: 'ward_council',               label: 'Ward Council',                             scope: 'ward'  },
  { key: 'ward_org_presidency',        label: 'Ward Organization Presidency',             scope: 'ward'  },
  { key: 'ward_mission_leader',        label: 'Ward Mission Leader',                      scope: 'ward'  },
  { key: 'ward_member',                label: 'Ward Member',                              scope: 'ward'  },
]

interface AppUser {
  user_id: string
  email: string | null
}
interface Ward {
  id: string
  name: string
}
interface RoleRow {
  email: string
  role_key: string
  ward: string | null
}
interface DraftRole {
  role_key: string
  ward: string | null
}

export default function AdminRoles() {
  const navigate = useNavigate()
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null)
  const [users, setUsers] = useState<AppUser[]>([])
  const [wards, setWards] = useState<Ward[]>([])
  const [allRoles, setAllRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<AppUser | null>(null)
  const [draft, setDraft] = useState<DraftRole[]>([])
  const [savingFor, setSavingFor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const rolesByEmail = useMemo(() => {
    const map: Record<string, RoleRow[]> = {}
    for (const r of allRoles) {
      const key = r.email.toLowerCase()
      if (!map[key]) map[key] = []
      map[key].push(r)
    }
    return map
  }, [allRoles])

  const refresh = useCallback(async () => {
    setLoading(true)
    const [usersRes, wardsRes, rolesRes] = await Promise.all([
      supabase.from('gather_app_users').select('user_id, email').order('email'),
      supabase.from('knit_wards').select('id, name').order('name'),
      supabase.from('gather_user_roles').select('email, role_key, ward').is('revoked_at', null),
    ])
    if (usersRes.error) setError(usersRes.error.message)
    setUsers((usersRes.data ?? []) as AppUser[])
    setWards((wardsRes.data ?? []) as Ward[])
    setAllRoles((rolesRes.data ?? []) as RoleRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        navigate('/admin/login')
        return
      }
      const { data } = await supabase
        .from('gather_super_admins')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
      const isSuper = !!data
      setIsSuperAdmin(isSuper)
      if (!isSuper) {
        navigate('/admin')
        return
      }
      await refresh()
    })()
  }, [navigate, refresh])

  function openEdit(u: AppUser) {
    setEditing(u)
    const existing = rolesByEmail[(u.email ?? '').toLowerCase()] ?? []
    setDraft(existing.map((r) => ({ role_key: r.role_key, ward: r.ward })))
    setError('')
  }

  function toggleRole(roleKey: string, scope: RoleScope) {
    setDraft((prev) => {
      const has = prev.some((d) => d.role_key === roleKey)
      if (has) return prev.filter((d) => d.role_key !== roleKey)
      return [...prev, { role_key: roleKey, ward: scope === 'ward' ? null : null }]
    })
  }

  function setWardForRole(roleKey: string, ward: string | null) {
    setDraft((prev) => prev.map((d) => (d.role_key === roleKey ? { ...d, ward } : d)))
  }

  async function syncFromTidings() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No session')
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/knit-sync-tidings-members`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setSyncResult(
        `Pulled ${data.contact_count ?? 0} contacts: ${data.inserted ?? 0} new, ${data.updated ?? 0} updated, ${data.skipped ?? 0} skipped, ${data.missing_ward ?? 0} unmapped ward.`,
      )
      await refresh()
    } catch (e) {
      setSyncResult(`Sync failed: ${(e as Error).message}`)
    } finally {
      setSyncing(false)
    }
  }

  async function saveRoles() {
    if (!editing || !editing.email) return
    setSavingFor(editing.user_id)
    setError('')
    try {
      const email = editing.email
      const existing = rolesByEmail[email.toLowerCase()] ?? []
      const sameKey = (a: { role_key: string; ward: string | null }, b: { role_key: string; ward: string | null }) =>
        a.role_key === b.role_key && (a.ward ?? null) === (b.ward ?? null)
      const toAdd = draft.filter((d) => !existing.some((e) => sameKey(e, d)))
      const toRemove = existing.filter((e) => !draft.some((d) => sameKey(e, d)))

      for (const r of toRemove) {
        const { error } = await supabase.rpc('gather_revoke_role', {
          p_email: email,
          p_role: r.role_key,
          p_ward: r.ward ?? undefined,
        })
        if (error) throw new Error(`Revoke ${r.role_key}: ${error.message}`)
      }
      for (const r of toAdd) {
        const { error } = await supabase.rpc('gather_grant_role', {
          p_email: email,
          p_role: r.role_key,
          p_ward: r.ward ?? undefined,
          p_full_name: undefined,
        })
        if (error) throw new Error(`Grant ${r.role_key}: ${error.message}`)
      }
      setEditing(null)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSavingFor(null)
    }
  }

  const filtered = users.filter((u) => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (u.email ?? '').toLowerCase().includes(q)
  })

  if (isSuperAdmin === null) {
    return <div className="p-6 text-sm text-gray-500">Checking access…</div>
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-16">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Suite roles</h1>
        <p className="text-sm text-gray-600 mt-1">
          Assign the 19 Gathered roles. One person can hold multiple roles. Stake roles cover the whole stake;
          ward roles need a ward. Changes here flow to every Gathered app via the shared
          <code className="px-1 py-0.5 bg-gray-100 rounded text-xs"> gather_user_roles</code> table.
        </p>
      </header>

      <div className="bg-white rounded-md border border-gray-200 p-4 mb-4">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by email…"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
        />
      </div>

      <div className="bg-white rounded-md border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-900">Tidings member directory</p>
            <p className="text-xs text-gray-500">
              Pulls every active contact from Tidings into knit_members (split into first + last name, phone, email, callings).
              Safe to run anytime — keyed by tidings_member_id.
            </p>
          </div>
          <button
            onClick={syncFromTidings}
            disabled={syncing}
            className="px-3 py-1.5 text-xs font-medium rounded text-white disabled:opacity-50 bg-knit-primary whitespace-nowrap"
          >
            {syncing ? 'Syncing…' : 'Sync from Tidings'}
          </button>
        </div>
        {syncResult && (
          <p className="mt-2 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
            {syncResult}
          </p>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 text-center py-6">Loading…</div>
      ) : (
        <div className="bg-white rounded-md border border-gray-200 divide-y divide-gray-100">
          {filtered.map((u) => {
            const roles = rolesByEmail[(u.email ?? '').toLowerCase()] ?? []
            return (
              <div key={u.user_id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{u.email || '(no email)'}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {roles.length === 0 && (
                        <span className="text-[11px] text-gray-400 italic">No suite roles</span>
                      )}
                      {roles.map((r) => {
                        const def = SUITE_ROLES.find((s) => s.key === r.role_key)
                        return (
                          <span
                            key={`${r.role_key}-${r.ward ?? ''}`}
                            className="text-[10px] px-1.5 py-0.5 rounded border bg-rose-50 text-rose-900 border-rose-200"
                          >
                            {def?.label ?? r.role_key}{r.ward ? ` · ${r.ward}` : ''}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  <button
                    onClick={() => openEdit(u)}
                    disabled={!u.email}
                    className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Edit roles
                  </button>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">No users match that filter.</p>
          )}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-3">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditing(null)} />
          <div className="relative bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg shadow-xl">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">Suite roles for {editing.email}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Tick the roles this user holds. Stake roles cover the whole stake; ward roles need a ward.
              </p>
            </div>

            <div className="px-5 py-4 space-y-2">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded p-2">{error}</div>
              )}
              {SUITE_ROLES.map((role) => {
                const sel = draft.find((d) => d.role_key === role.key)
                const selected = !!sel
                return (
                  <div
                    key={role.key}
                    className={`rounded border px-3 py-2 ${
                      selected ? 'border-rose-300 bg-rose-50' : 'border-gray-200'
                    }`}
                  >
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleRole(role.key, role.scope)}
                      />
                      <span className="flex-1">{role.label}</span>
                      <span className="text-[10px] uppercase tracking-wide text-gray-400">{role.scope}</span>
                    </label>
                    {selected && role.scope === 'ward' && (
                      <select
                        value={sel?.ward ?? ''}
                        onChange={(e) => setWardForRole(role.key, e.target.value || null)}
                        className="mt-2 w-full text-xs px-2 py-1 border border-gray-300 rounded"
                      >
                        <option value="">— Pick a ward —</option>
                        {wards.map((w) => (
                          <option key={w.id} value={w.name}>{w.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveRoles}
                disabled={savingFor === editing.user_id}
                className="px-3 py-1.5 text-sm rounded text-white disabled:opacity-50 bg-knit-primary"
              >
                {savingFor === editing.user_id ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import {
  ROLE_LABELS,
  WARD_EDIT_ROLES,
  STAKE_VIEW_ROLES,
  canManageStake,
  isWardScoped,
  type AdminRole,
} from '@/lib/roles'
import type { Database } from '@/lib/database.types'

type AdminRow = Database['public']['Tables']['knit_admin_users']['Row']
type WardRow = Database['public']['Tables']['knit_wards']['Row']
type AdminWithWard = AdminRow & { ward: { id: string; name: string } | null }
type Ctx = { profile: AdminProfile }

const ALL_ROLES: AdminRole[] = [
  ...STAKE_VIEW_ROLES,
  ...WARD_EDIT_ROLES,
]

async function authorizedFetch(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  headers.set('Content-Type', 'application/json')
  return fetch(path, { ...init, headers })
}

export default function AdminUsers() {
  const { profile } = useOutletContext<Ctx>()
  const stakeAdmin = canManageStake(profile)

  const [users, setUsers] = useState<AdminWithWard[]>([])
  const [wards, setWards] = useState<WardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  async function refresh() {
    if (!profile.stake_id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const [{ data: userRows, error: userErr }, { data: wardRows }] = await Promise.all([
      supabase
        .from('knit_admin_users')
        .select('*, ward:knit_wards(id, name)')
        .eq('stake_id', profile.stake_id)
        .order('email'),
      supabase
        .from('knit_wards')
        .select('*')
        .eq('stake_id', profile.stake_id)
        .order('name'),
    ])
    if (userErr) {
      setError(userErr.message)
      setLoading(false)
      return
    }
    const cleaned = (userRows ?? []).map((u: AdminWithWard | (AdminRow & { ward: unknown })) => {
      const ward = (u as { ward: unknown }).ward
      const wardSingle = Array.isArray(ward)
        ? ((ward[0] as { id: string; name: string } | undefined) ?? null)
        : ((ward as { id: string; name: string } | null) ?? null)
      return { ...(u as AdminRow), ward: wardSingle }
    })
    setUsers(cleaned as AdminWithWard[])
    setWards((wardRows ?? []) as WardRow[])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [profile.stake_id])

  if (!stakeAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
        <p className="text-sm text-gray-600">
          Only Stake Presidency or super admins can manage Knit admin users.
        </p>
      </div>
    )
  }

  async function invite(payload: {
    email: string
    name: string
    role: AdminRole
    ward_id: string | null
    is_super_admin: boolean
  }) {
    setError(null)
    setNotice(null)
    const r = await authorizedFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ action: 'invite', ...payload }),
    })
    const body = await r.json()
    if (!r.ok) {
      setError(body.error ?? `HTTP ${r.status}`)
      return
    }
    setNotice(`Invited ${payload.email}.`)
    setShowForm(false)
    await refresh()
  }

  async function updateUser(id: string, patch: Partial<AdminRow>) {
    setError(null)
    setNotice(null)
    const { error } = await supabase.from('knit_admin_users').update(patch).eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setNotice('Saved.')
    await refresh()
  }

  async function remove(user: AdminWithWard) {
    if (user.id === profile.id) {
      alert("You can't remove yourself.")
      return
    }
    if (!confirm(`Remove ${user.email}? They will lose admin access.`)) return
    setError(null)
    setNotice(null)
    const r = await authorizedFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ action: 'remove', userId: user.id }),
    })
    const body = await r.json()
    if (!r.ok) {
      setError(body.error ?? `HTTP ${r.status}`)
      return
    }
    setNotice(`Removed ${user.email}.`)
    await refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
          <p className="text-sm text-gray-600 mt-1">
            Knit admins for {profile.stake?.name ?? 'your stake'}. Invite by email,
            set role and ward, or remove access.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-primary text-sm py-2 px-4 whitespace-nowrap"
        >
          {showForm ? 'Cancel' : 'Invite admin'}
        </button>
      </div>

      {notice ? (
        <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm text-gray-900">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-error/30 bg-error/5 p-3 text-sm text-gray-900">
          {error}
        </div>
      ) : null}

      {showForm ? (
        <InviteForm
          wards={wards}
          callerIsSuper={profile.is_super_admin}
          onSubmit={(payload) => void invite(payload)}
        />
      ) : null}

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-500">Loading admins…</div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            No admins yet. Invite the first one above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Name / email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Ward</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  wards={wards}
                  callerIsSuper={profile.is_super_admin}
                  isSelf={u.id === profile.id}
                  onUpdate={(patch) => void updateUser(u.id, patch)}
                  onRemove={() => void remove(u)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function UserRow({
  user,
  wards,
  callerIsSuper,
  isSelf,
  onUpdate,
  onRemove,
}: {
  user: AdminWithWard
  wards: WardRow[]
  callerIsSuper: boolean
  isSelf: boolean
  onUpdate: (patch: Partial<AdminRow>) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [role, setRole] = useState<AdminRole>(user.role)
  const [wardId, setWardId] = useState<string>(user.ward_id ?? '')
  const [name, setName] = useState<string>(user.name ?? '')
  const wardRequired = isWardScoped(role)

  function save() {
    if (wardRequired && !wardId) return
    onUpdate({
      role,
      ward_id: wardRequired ? wardId : null,
      name: name.trim() || null,
    })
    setEditing(false)
  }

  if (editing) {
    return (
      <tr className="bg-gray-50/50">
        <td className="px-4 py-3 space-y-2">
          <div className="font-mono text-xs text-gray-600">{user.email}</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className="form-input"
          />
        </td>
        <td className="px-4 py-3">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AdminRole)}
            className="form-input"
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </td>
        <td className="px-4 py-3">
          {wardRequired ? (
            <select
              value={wardId}
              onChange={(e) => setWardId(e.target.value)}
              className="form-input"
            >
              <option value="">Pick a ward</option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <button
            onClick={save}
            disabled={wardRequired && !wardId}
            className="btn-primary text-sm py-1.5 px-3 mr-2 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setRole(user.role)
              setWardId(user.ward_id ?? '')
              setName(user.name ?? '')
            }}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Cancel
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">{user.name ?? '—'}</div>
        <div className="text-xs text-gray-500">{user.email}</div>
        {user.is_super_admin ? (
          <span className="inline-block mt-1 rounded-full bg-knit-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Super admin
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3 text-gray-700">{ROLE_LABELS[user.role]}</td>
      <td className="px-4 py-3 text-gray-700">{user.ward?.name ?? '—'}</td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <button
          onClick={() => setEditing(true)}
          className="text-sm text-gray-700 hover:text-gray-900 mr-4"
        >
          Edit
        </button>
        {isSelf ? (
          <span className="text-sm text-gray-400">You</span>
        ) : user.is_super_admin && !callerIsSuper ? (
          <span className="text-sm text-gray-400">Protected</span>
        ) : (
          <button
            onClick={onRemove}
            className="text-sm text-error hover:opacity-80"
          >
            Remove
          </button>
        )}
      </td>
    </tr>
  )
}

function InviteForm({
  wards,
  callerIsSuper,
  onSubmit,
}: {
  wards: WardRow[]
  callerIsSuper: boolean
  onSubmit: (payload: {
    email: string
    name: string
    role: AdminRole
    ward_id: string | null
    is_super_admin: boolean
  }) => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<AdminRole>('ward_mission_leader')
  const [wardId, setWardId] = useState<string>('')
  const [isSuper, setIsSuper] = useState(false)
  const wardRequired = isWardScoped(role)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !email.includes('@')) return
    if (wardRequired && !wardId) return
    onSubmit({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role,
      ward_id: wardRequired ? wardId : null,
      is_super_admin: callerIsSuper && isSuper,
    })
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-gray-200 bg-white p-5 grid gap-4 sm:grid-cols-2"
    >
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-gray-700">Email *</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="form-input"
          placeholder="name@example.com"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-gray-700">Display name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="form-input"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-gray-700">Role *</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as AdminRole)}
          className="form-input"
        >
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-gray-700">
          Ward {wardRequired ? '*' : '(not used for this role)'}
        </span>
        <select
          value={wardId}
          onChange={(e) => setWardId(e.target.value)}
          disabled={!wardRequired}
          className="form-input"
        >
          <option value="">{wardRequired ? 'Pick a ward' : '—'}</option>
          {wards.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      {callerIsSuper ? (
        <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isSuper}
            onChange={(e) => setIsSuper(e.target.checked)}
            className="h-4 w-4"
          />
          Grant super admin (bypasses ward / stake scoping)
        </label>
      ) : null}
      <div className="sm:col-span-2 flex items-center justify-between pt-2">
        <p className="text-xs text-gray-500">
          We'll send them a magic link to set up their account. If they already
          have a Knit login, we'll just add the admin role.
        </p>
        <button type="submit" className="btn-primary text-sm py-2 px-4">
          Send invite
        </button>
      </div>
    </form>
  )
}

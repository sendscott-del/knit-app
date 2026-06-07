import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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

type RoleScope = 'stake' | 'ward'
type SuiteRoleDef = { key: string; label: string; scope: RoleScope }
type SuiteRoleRow = { email: string; role_key: string; ward: string | null }

type GatherAppUser = {
  user_id: string
  email: string | null
  apps: { app_name: string }[] | null
}

// `user_apps` (which feeds gather_app_users.apps) is the Gather church-suite
// registry — only these apps write to it. The shared Supabase project also hosts
// unrelated apps (e.g. Sparkle Pro) whose signups land in auth.users with no
// user_apps row, surfacing as apps:[]. Filtering the directory to suite members
// keeps those foreign accounts out of Knit's user list. People with a Knit role
// or suite role still appear via the knit_admin_users / gather_user_roles sources.
const GATHER_SUITE_APPS = new Set(['magnify', 'glean', 'knit', 'steward', 'tidings'])

type PersonRow = {
  email: string
  user_id: string | null
  knit: AdminWithWard | null
  suite: SuiteRoleRow[]
}

const SUITE_ROLES: SuiteRoleDef[] = [
  { key: 'stake_president', label: 'Stake President', scope: 'stake' },
  { key: 'stake_clerk', label: 'Stake Clerk', scope: 'stake' },
  { key: 'sp_1st_counselor', label: 'Stake Presidency 1st Counselor', scope: 'stake' },
  { key: 'sp_2nd_counselor', label: 'Stake Presidency 2nd Counselor', scope: 'stake' },
  { key: 'stake_exec_secretary', label: 'Stake Executive Secretary', scope: 'stake' },
  { key: 'high_councilor', label: 'High Councilor', scope: 'stake' },
  { key: 'hc_missionary_work', label: 'High Councilor — Missionary Work', scope: 'stake' },
  { key: 'hc_welfare_self_reliance', label: 'High Councilor — Welfare & Self Reliance', scope: 'stake' },
  { key: 'community_events_leader', label: 'Community Events Leader', scope: 'stake' },
  { key: 'stake_council', label: 'Stake Council', scope: 'stake' },
  { key: 'bishop', label: 'Bishop', scope: 'ward' },
  { key: 'bishopric_1st_counselor', label: 'Bishopric 1st Counselor', scope: 'ward' },
  { key: 'bishopric_2nd_counselor', label: 'Bishopric 2nd Counselor', scope: 'ward' },
  { key: 'ward_clerk', label: 'Ward Clerk', scope: 'ward' },
  { key: 'ward_exec_secretary', label: 'Ward Executive Secretary', scope: 'ward' },
  { key: 'ward_council', label: 'Ward Council', scope: 'ward' },
  { key: 'ward_org_presidency', label: 'Ward Organization Presidency', scope: 'ward' },
  { key: 'ward_mission_leader', label: 'Ward Mission Leader', scope: 'ward' },
  { key: 'ward_member', label: 'Ward Member', scope: 'ward' },
]

const ALL_KNIT_ROLES: AdminRole[] = [...STAKE_VIEW_ROLES, ...WARD_EDIT_ROLES]

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
  const { t } = useTranslation('common')
  const stakeAdmin = canManageStake(profile)

  const [people, setPeople] = useState<PersonRow[]>([])
  const [wards, setWards] = useState<WardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [editingEmail, setEditingEmail] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [isAppSuper, setIsAppSuper] = useState(false)

  async function refresh() {
    if (!profile.stake_id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const [knitRes, wardsRes, suiteRes, appUsersRes, superRes] = await Promise.all([
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
      supabase
        .from('gather_user_roles')
        .select('email, role_key, ward')
        .is('revoked_at', null),
      supabase.from('gather_app_users').select('user_id, email, apps').order('email'),
      supabase.rpc('knit_is_app_super_admin'),
    ])
    // Surface any query failure — previously only knitRes was checked; silent
    // failures on the suite/app-users/super queries showed partial data.
    const anyErr = knitRes.error ?? wardsRes.error ?? suiteRes.error ?? appUsersRes.error ?? superRes.error
    if (anyErr) {
      setError(anyErr.message)
      setLoading(false)
      return
    }

    setIsAppSuper(Boolean(superRes.data))
    const knitRows = (knitRes.data ?? []).map(
      (u: AdminRow & { ward: unknown }) => {
        const ward = (u as { ward: unknown }).ward
        const wardSingle = Array.isArray(ward)
          ? ((ward[0] as { id: string; name: string } | undefined) ?? null)
          : ((ward as { id: string; name: string } | null) ?? null)
        return { ...(u as AdminRow), ward: wardSingle } as AdminWithWard
      },
    )
    const suiteRows = (suiteRes.data ?? []) as SuiteRoleRow[]
    const appUsers = (appUsersRes.data ?? []) as GatherAppUser[]

    const byEmail = new Map<string, PersonRow>()
    const upsert = (email: string): PersonRow => {
      const key = email.toLowerCase()
      const existing = byEmail.get(key)
      if (existing) return existing
      const row: PersonRow = { email, user_id: null, knit: null, suite: [] }
      byEmail.set(key, row)
      return row
    }
    for (const k of knitRows) {
      if (!k.email) continue
      const row = upsert(k.email)
      row.knit = k
      row.user_id = k.id
    }
    for (const u of appUsers) {
      if (!u.email) continue
      const inSuite = (u.apps ?? []).some((a) => GATHER_SUITE_APPS.has(a.app_name))
      if (!inSuite) continue
      const row = upsert(u.email)
      row.user_id = row.user_id ?? u.user_id
    }
    for (const r of suiteRows) {
      const row = upsert(r.email)
      row.suite.push(r)
    }

    const list = [...byEmail.values()].sort((a, b) =>
      (a.email ?? '').toLowerCase().localeCompare((b.email ?? '').toLowerCase()),
    )
    setPeople(list)
    setWards((wardsRes.data ?? []) as WardRow[])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.stake_id])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return people
    return people.filter((p) => {
      const name = p.knit?.name?.toLowerCase() ?? ''
      const email = (p.email ?? '').toLowerCase()
      return name.includes(q) || email.includes(q)
    })
  }, [people, filter])

  async function syncFromTidings() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) throw new Error('No session')
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/knit-sync-tidings-members`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setSyncResult(
        t('users.sync_result', {
          contacts: data.contact_count ?? 0,
          inserted: data.inserted ?? 0,
          updated: data.updated ?? 0,
          skipped: data.skipped ?? 0,
          missing: data.missing_ward ?? 0,
        }),
      )
      await refresh()
    } catch (e) {
      setSyncResult(t('users.sync_failed', { detail: e instanceof Error ? e.message : String(e) }))
    } finally {
      setSyncing(false)
    }
  }

  if (!stakeAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900">{t('users.page_title')}</h1>
        <p className="text-sm text-gray-600">
          {t('users.no_permission')}
        </p>
      </div>
    )
  }

  async function invitePerson(payload: InvitePayload) {
    setError(null)
    setNotice(null)
    if (payload.knit_role) {
      const r = await authorizedFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'invite',
          email: payload.email,
          name: payload.name || null,
          role: payload.knit_role,
          ward_id: payload.knit_ward_id,
          is_super_admin: payload.is_super_admin,
        }),
      })
      const body = await r.json()
      if (!r.ok) {
        setError(body.error ?? `HTTP ${r.status}`)
        return
      }
    }
    for (const sr of payload.suite_roles) {
      const { error } = await supabase.rpc('gather_grant_role', {
        p_email: payload.email,
        p_role: sr.role_key,
        p_ward: sr.ward ?? undefined,
        p_full_name: payload.name || undefined,
      })
      if (error) {
        setError(`Grant ${sr.role_key}: ${error.message}`)
        return
      }
    }
    setNotice(t('users.invited', { email: payload.email }))
    setShowInvite(false)
    await refresh()
  }

  async function savePerson(person: PersonRow, patch: SavePatch) {
    setError(null)
    setNotice(null)
    try {
      if (person.knit) {
        if (
          patch.knit_role !== undefined ||
          patch.knit_ward_id !== undefined ||
          patch.name !== undefined ||
          patch.is_super_admin !== undefined
        ) {
          const update: Partial<AdminRow> = {}
          if (patch.knit_role !== undefined) update.role = patch.knit_role
          if (patch.knit_ward_id !== undefined) update.ward_id = patch.knit_ward_id
          if (patch.name !== undefined) update.name = patch.name.trim() || null
          if (patch.is_super_admin !== undefined && profile.is_super_admin)
            update.is_super_admin = patch.is_super_admin
          const { error } = await supabase
            .from('knit_admin_users')
            .update(update)
            .eq('id', person.knit.id)
          if (error) throw new Error(error.message)
        }
      } else if (patch.knit_role) {
        const r = await authorizedFetch('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            action: 'invite',
            email: person.email,
            name: patch.name ?? null,
            role: patch.knit_role,
            ward_id: patch.knit_ward_id ?? null,
            is_super_admin: profile.is_super_admin && (patch.is_super_admin ?? false),
          }),
        })
        const body = await r.json()
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      }

      if (patch.suite_roles) {
        const current = person.suite
        const sameKey = (
          a: { role_key: string; ward: string | null },
          b: { role_key: string; ward: string | null },
        ) => a.role_key === b.role_key && (a.ward ?? null) === (b.ward ?? null)
        const toAdd = patch.suite_roles.filter(
          (d) => !current.some((c) => sameKey(c, d)),
        )
        const toRemove = current.filter(
          (c) => !patch.suite_roles!.some((d) => sameKey(c, d)),
        )
        for (const r of toRemove) {
          const { error } = await supabase.rpc('gather_revoke_role', {
            p_email: person.email,
            p_role: r.role_key,
            p_ward: r.ward ?? undefined,
          })
          if (error) throw new Error(`Revoke ${r.role_key}: ${error.message}`)
        }
        for (const r of toAdd) {
          const { error } = await supabase.rpc('gather_grant_role', {
            p_email: person.email,
            p_role: r.role_key,
            p_ward: r.ward ?? undefined,
            p_full_name: patch.name ?? undefined,
          })
          if (error) throw new Error(`Grant ${r.role_key}: ${error.message}`)
        }
      }

      setNotice(t('users.saved'))
      setEditingEmail(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function removePerson(person: PersonRow) {
    if (!person.knit) return
    if (person.knit.id === profile.id) {
      alert(t('users.cant_remove_self'))
      return
    }
    if (!confirm(t('users.remove_confirm', { email: person.email }))) return
    setError(null)
    setNotice(null)
    const r = await authorizedFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ action: 'remove', userId: person.knit.id }),
    })
    const body = await r.json()
    if (!r.ok) {
      setError(body.error ?? `HTTP ${r.status}`)
      return
    }
    setNotice(t('users.removed', { email: person.email }))
    await refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('users.page_title_full')}</h1>
          <p className="text-sm text-gray-600 mt-1">
            {t('users.page_subtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowInvite((v) => !v)}
          className="btn-primary text-sm py-2 px-4 whitespace-nowrap"
        >
          {showInvite ? t('cancel') : t('users.invite_user')}
        </button>
      </div>

      {isAppSuper ? (
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{t('users.tidings_title')}</p>
              <p className="text-xs text-gray-500">
                {t('users.tidings_subtitle')}
              </p>
            </div>
            <button
              onClick={() => void syncFromTidings()}
              disabled={syncing}
              className="rounded-md bg-knit-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 whitespace-nowrap"
            >
              {syncing ? t('users.syncing') : t('users.sync_from_tidings')}
            </button>
          </div>
          {syncResult ? (
            <p className="mt-2 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
              {syncResult}
            </p>
          ) : null}
        </div>
      ) : null}

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

      {showInvite ? (
        <InviteForm
          wards={wards}
          callerIsSuper={profile.is_super_admin}
          onSubmit={(payload) => void invitePerson(payload)}
        />
      ) : null}

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t('users.filter_placeholder')}
        className="form-input"
      />

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-500">{t('users.loading')}</div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            {t('users.empty')}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visible.map((p) => (
              <PersonItem
                key={p.email.toLowerCase()}
                person={p}
                wards={wards}
                callerIsSuper={profile.is_super_admin}
                isSelf={p.knit?.id === profile.id}
                editing={editingEmail === p.email.toLowerCase()}
                onStartEdit={() => setEditingEmail(p.email.toLowerCase())}
                onCancel={() => setEditingEmail(null)}
                onSave={(patch) => void savePerson(p, patch)}
                onRemove={() => void removePerson(p)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

type SavePatch = {
  name?: string
  knit_role?: AdminRole
  knit_ward_id?: string | null
  is_super_admin?: boolean
  suite_roles?: { role_key: string; ward: string | null }[]
}

function PersonItem({
  person,
  wards,
  callerIsSuper,
  isSelf,
  editing,
  onStartEdit,
  onCancel,
  onSave,
  onRemove,
}: {
  person: PersonRow
  wards: WardRow[]
  callerIsSuper: boolean
  isSelf: boolean
  editing: boolean
  onStartEdit: () => void
  onCancel: () => void
  onSave: (patch: SavePatch) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('common')
  if (editing) {
    return (
      <li className="px-4 py-4 bg-gray-50/50">
        <EditorForm
          person={person}
          wards={wards}
          callerIsSuper={callerIsSuper}
          onCancel={onCancel}
          onSave={onSave}
        />
      </li>
    )
  }
  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900">
            {person.knit?.name || person.email}
          </span>
          {person.knit?.is_super_admin ? (
            <span className="rounded-full bg-knit-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              {t('users.super')}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-gray-500">{person.email}</div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {person.knit ? (
            <span className="inline-flex items-center rounded-full bg-knit-primary/10 px-2 py-0.5 text-[11px] font-medium text-knit-primary">
              {t('users.knit_prefix', { label: ROLE_LABELS[person.knit.role] })}
              {person.knit.ward ? ` · ${person.knit.ward.name}` : ''}
            </span>
          ) : (
            <span className="text-[11px] italic text-gray-400">{t('users.no_knit_role')}</span>
          )}
          {person.suite.map((r) => {
            const def = SUITE_ROLES.find((s) => s.key === r.role_key)
            return (
              <span
                key={`${r.role_key}-${r.ward ?? ''}`}
                className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-900 border border-rose-200"
              >
                {def?.label ?? r.role_key}
                {r.ward ? ` · ${r.ward}` : ''}
              </span>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 whitespace-nowrap pt-1">
        <button
          onClick={onStartEdit}
          className="text-sm text-gray-700 hover:text-gray-900"
        >
          {t('edit')}
        </button>
        {person.knit ? (
          isSelf ? (
            <span className="text-xs text-gray-400">{t('users.you')}</span>
          ) : person.knit.is_super_admin && !callerIsSuper ? (
            <span className="text-xs text-gray-400">{t('users.protected')}</span>
          ) : (
            <button
              onClick={onRemove}
              className="text-sm text-error hover:opacity-80"
            >
              {t('remove')}
            </button>
          )
        ) : null}
      </div>
    </li>
  )
}

function EditorForm({
  person,
  wards,
  callerIsSuper,
  onCancel,
  onSave,
}: {
  person: PersonRow
  wards: WardRow[]
  callerIsSuper: boolean
  onCancel: () => void
  onSave: (patch: SavePatch) => void
}) {
  const { t } = useTranslation('common')
  const [name, setName] = useState(person.knit?.name ?? '')
  const [knitRole, setKnitRole] = useState<AdminRole | ''>(person.knit?.role ?? '')
  const [knitWardId, setKnitWardId] = useState<string>(person.knit?.ward_id ?? '')
  const [isSuper, setIsSuper] = useState(!!person.knit?.is_super_admin)
  const [suiteDraft, setSuiteDraft] = useState<
    { role_key: string; ward: string | null }[]
  >(person.suite.map((s) => ({ role_key: s.role_key, ward: s.ward })))

  const knitWardRequired = knitRole !== '' && isWardScoped(knitRole as AdminRole)

  function toggleSuite(roleKey: string) {
    setSuiteDraft((prev) => {
      const has = prev.some((d) => d.role_key === roleKey)
      if (has) return prev.filter((d) => d.role_key !== roleKey)
      return [...prev, { role_key: roleKey, ward: null }]
    })
  }
  function setWardForSuite(roleKey: string, ward: string | null) {
    setSuiteDraft((prev) =>
      prev.map((d) => (d.role_key === roleKey ? { ...d, ward } : d)),
    )
  }

  function save() {
    if (knitWardRequired && !knitWardId) {
      alert(t('users.pick_ward_role'))
      return
    }
    onSave({
      name,
      knit_role: knitRole === '' ? undefined : (knitRole as AdminRole),
      knit_ward_id: knitRole === '' ? undefined : knitWardRequired ? knitWardId : null,
      is_super_admin: callerIsSuper ? isSuper : undefined,
      suite_roles: suiteDraft,
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-gray-900">{person.email}</div>
      </div>

      <fieldset className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
        <legend className="text-sm font-medium text-gray-700 px-1">{t('users.knit_admin')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs text-gray-600">{t('users.display_name')}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-input"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-gray-600">{t('users.role_label')}</span>
            <select
              value={knitRole}
              onChange={(e) => setKnitRole(e.target.value as AdminRole | '')}
              className="form-input"
            >
              <option value="">{t('users.no_knit_role_option')}</option>
              {ALL_KNIT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          {knitWardRequired ? (
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs text-gray-600">{t('users.ward_label')}</span>
              <select
                value={knitWardId}
                onChange={(e) => setKnitWardId(e.target.value)}
                className="form-input"
              >
                <option value="">{t('users.pick_a_ward')}</option>
                {wards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {callerIsSuper ? (
            <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={isSuper}
                onChange={(e) => setIsSuper(e.target.checked)}
              />
              {t('users.grant_super')}
            </label>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="space-y-2 rounded-md border border-gray-200 bg-white p-4">
        <legend className="text-sm font-medium text-gray-700 px-1">{t('users.suite_roles')}</legend>
        <p className="text-xs text-gray-500 -mt-1">
          {t('users.suite_roles_explain')}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUITE_ROLES.map((role) => {
            const sel = suiteDraft.find((d) => d.role_key === role.key)
            const selected = !!sel
            return (
              <div
                key={role.key}
                className={`rounded border px-3 py-2 ${selected ? 'border-rose-300 bg-rose-50' : 'border-gray-200'}`}
              >
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSuite(role.key)}
                  />
                  <span className="flex-1">{role.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">
                    {role.scope === 'stake' ? t('users.scope_stake') : t('users.scope_ward')}
                  </span>
                </label>
                {selected && role.scope === 'ward' ? (
                  <select
                    value={sel?.ward ?? ''}
                    onChange={(e) => setWardForSuite(role.key, e.target.value || null)}
                    className="mt-2 w-full text-xs px-2 py-1 border border-gray-300 rounded"
                  >
                    <option value="">{t('users.pick_ward_dash')}</option>
                    {wards.map((w) => (
                      <option key={w.id} value={w.name}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            )
          })}
        </div>
      </fieldset>

      <div className="flex items-center gap-2">
        <button onClick={save} className="btn-primary text-sm py-2 px-4">
          {t('save')}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border-[1.5px] border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}

type InvitePayload = {
  email: string
  name: string
  knit_role: AdminRole | null
  knit_ward_id: string | null
  is_super_admin: boolean
  suite_roles: { role_key: string; ward: string | null }[]
}

function InviteForm({
  wards,
  callerIsSuper,
  onSubmit,
}: {
  wards: WardRow[]
  callerIsSuper: boolean
  onSubmit: (payload: InvitePayload) => void
}) {
  const { t } = useTranslation('common')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [knitRole, setKnitRole] = useState<AdminRole | ''>('')
  const [knitWardId, setKnitWardId] = useState<string>('')
  const [isSuper, setIsSuper] = useState(false)
  const [suiteDraft, setSuiteDraft] = useState<
    { role_key: string; ward: string | null }[]
  >([])
  const knitWardRequired = knitRole !== '' && isWardScoped(knitRole as AdminRole)

  function toggleSuite(roleKey: string) {
    setSuiteDraft((prev) => {
      const has = prev.some((d) => d.role_key === roleKey)
      if (has) return prev.filter((d) => d.role_key !== roleKey)
      return [...prev, { role_key: roleKey, ward: null }]
    })
  }
  function setWardForSuite(roleKey: string, ward: string | null) {
    setSuiteDraft((prev) =>
      prev.map((d) => (d.role_key === roleKey ? { ...d, ward } : d)),
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim().includes('@')) return
    if (knitWardRequired && !knitWardId) return
    if (!knitRole && suiteDraft.length === 0) {
      alert(t('users.pick_at_least_one'))
      return
    }
    onSubmit({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      knit_role: knitRole === '' ? null : (knitRole as AdminRole),
      knit_ward_id: knitRole === '' ? null : knitWardRequired ? knitWardId : null,
      is_super_admin: callerIsSuper && isSuper,
      suite_roles: suiteDraft,
    })
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-gray-200 bg-white p-5 space-y-5"
    >
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-700">{t('users.email_required')}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="form-input"
            placeholder={t('users.email_placeholder')}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-700">{t('users.display_name')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="form-input"
          />
        </label>
      </fieldset>

      <fieldset className="space-y-3 rounded-md border border-gray-200 p-4">
        <legend className="text-sm font-medium text-gray-700 px-1">{t('users.knit_admin_optional')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs text-gray-600">{t('users.role_label')}</span>
            <select
              value={knitRole}
              onChange={(e) => setKnitRole(e.target.value as AdminRole | '')}
              className="form-input"
            >
              <option value="">{t('users.no_knit_role_option')}</option>
              {ALL_KNIT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          {knitWardRequired ? (
            <label className="block space-y-1.5">
              <span className="text-xs text-gray-600">{t('users.ward_label')}</span>
              <select
                value={knitWardId}
                onChange={(e) => setKnitWardId(e.target.value)}
                className="form-input"
              >
                <option value="">{t('users.pick_a_ward')}</option>
                {wards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {callerIsSuper ? (
            <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={isSuper}
                onChange={(e) => setIsSuper(e.target.checked)}
              />
              {t('users.grant_super_long')}
            </label>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="space-y-2 rounded-md border border-gray-200 p-4">
        <legend className="text-sm font-medium text-gray-700 px-1">{t('users.suite_roles_optional')}</legend>
        <p className="text-xs text-gray-500 -mt-1">
          {t('users.suite_roles_short')}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUITE_ROLES.map((role) => {
            const sel = suiteDraft.find((d) => d.role_key === role.key)
            const selected = !!sel
            return (
              <div
                key={role.key}
                className={`rounded border px-3 py-2 ${selected ? 'border-rose-300 bg-rose-50' : 'border-gray-200'}`}
              >
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSuite(role.key)}
                  />
                  <span className="flex-1">{role.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">
                    {role.scope === 'stake' ? t('users.scope_stake') : t('users.scope_ward')}
                  </span>
                </label>
                {selected && role.scope === 'ward' ? (
                  <select
                    value={sel?.ward ?? ''}
                    onChange={(e) => setWardForSuite(role.key, e.target.value || null)}
                    className="mt-2 w-full text-xs px-2 py-1 border border-gray-300 rounded"
                  >
                    <option value="">{t('users.pick_ward_dash')}</option>
                    {wards.map((w) => (
                      <option key={w.id} value={w.name}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            )
          })}
        </div>
      </fieldset>

      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-gray-500">
          {t('users.invite_footer')}
        </p>
        <button type="submit" className="btn-primary text-sm py-2 px-4">
          {t('users.send_invite')}
        </button>
      </div>
    </form>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { ROLE_LABELS, canManageStake } from '@/lib/roles'
import type { Database } from '@/lib/database.types'

type AdminRow = Database['public']['Tables']['knit_admin_users']['Row']
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

// User access (invites, role changes, removals) is managed centrally in
// Gather — every signup lands in the shared gather_access_requests queue and
// approval there provisions knit_admin_users. This page is now a read-only
// directory; the banner up top links out to the one place writes happen.
const GATHER_URL = 'https://gather.gatheredin.app/gather'

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

export default function AdminUsers() {
  const { profile } = useOutletContext<Ctx>()
  const { t } = useTranslation('common')
  const stakeAdmin = canManageStake(profile)

  const [people, setPeople] = useState<PersonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
    const [knitRes, suiteRes, appUsersRes, superRes] = await Promise.all([
      supabase
        .from('knit_admin_users')
        .select('*, ward:knit_wards(id, name)')
        .eq('stake_id', profile.stake_id)
        .order('email'),
      supabase
        .from('gather_user_roles')
        .select('email, role_key, ward')
        .is('revoked_at', null),
      supabase.from('gather_app_users').select('user_id, email, apps').order('email'),
      supabase.rpc('knit_is_app_super_admin'),
    ])
    // Surface any query failure — previously only knitRes was checked; silent
    // failures on the suite/app-users/super queries showed partial data.
    const anyErr = knitRes.error ?? suiteRes.error ?? appUsersRes.error ?? superRes.error
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('users.page_title_full')}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {t('users.page_subtitle')}
        </p>
      </div>

      <div className="rounded-md border border-knit-primary/30 bg-knit-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{t('users.managed_in_gather_title')}</p>
          <p className="text-xs text-gray-600 mt-0.5">{t('users.managed_in_gather_body')}</p>
        </div>
        <a
          href={GATHER_URL}
          target="_blank"
          rel="noreferrer"
          className="btn-primary text-sm py-2 px-4 whitespace-nowrap text-center"
        >
          {t('users.open_gather')} ↗
        </a>
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

      {error ? (
        <div className="rounded-md border border-error/30 bg-error/5 p-3 text-sm text-gray-900">
          {error}
        </div>
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
              <PersonItem key={p.email.toLowerCase()} person={p} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function PersonItem({ person }: { person: PersonRow }) {
  const { t } = useTranslation('common')
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
    </li>
  )
}

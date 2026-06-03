import { useEffect, useState, type FormEvent } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { canManageStake, roleLabel } from '@/lib/roles'
import type { Database } from '@/lib/database.types'

type WardRow = Database['public']['Tables']['knit_wards']['Row']
type BindingRow = Database['public']['Tables']['knit_google_sheet_bindings']['Row']
type StakeRow = Database['public']['Tables']['knit_stakes']['Row']

type WardWithBinding = WardRow & {
  binding: BindingRow | null
  member_count: number
  friend_count: number
}

type Ctx = { profile: AdminProfile }

export default function AdminSettings() {
  const { profile } = useOutletContext<Ctx>()
  const { t } = useTranslation('common')
  const stakeAdmin = canManageStake(profile)

  const [stake, setStake] = useState<StakeRow | null>(profile.stake)
  const [wards, setWards] = useState<WardWithBinding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showNewWard, setShowNewWard] = useState(false)

  async function refresh() {
    if (!profile.stake_id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const { data: stakeData } = await supabase
      .from('knit_stakes')
      .select('*')
      .eq('id', profile.stake_id)
      .maybeSingle()
    setStake(stakeData)

    const { data: wardRows, error: wardErr } = await supabase
      .from('knit_wards')
      .select('*')
      .eq('stake_id', profile.stake_id)
      .order('name')
    if (wardErr) {
      setError(wardErr.message)
      setLoading(false)
      return
    }

    const wardIds = (wardRows ?? []).map((w) => w.id)
    const [{ data: bindings }, { data: memberCounts }, { data: friendCounts }] =
      await Promise.all([
        supabase.from('knit_google_sheet_bindings').select('*').in('ward_id', wardIds),
        supabase.from('knit_members').select('ward_id').in('ward_id', wardIds),
        supabase.from('knit_friends').select('ward_id').in('ward_id', wardIds),
      ])

    const bindingByWard = new Map(
      ((bindings ?? []) as BindingRow[]).map((b) => [b.ward_id, b]),
    )
    const memberCountByWard = new Map<string, number>()
    for (const m of (memberCounts ?? []) as { ward_id: string }[]) {
      memberCountByWard.set(m.ward_id, (memberCountByWard.get(m.ward_id) ?? 0) + 1)
    }
    const friendCountByWard = new Map<string, number>()
    for (const f of (friendCounts ?? []) as { ward_id: string }[]) {
      friendCountByWard.set(f.ward_id, (friendCountByWard.get(f.ward_id) ?? 0) + 1)
    }

    setWards(
      (wardRows ?? []).map((w) => ({
        ...w,
        binding: bindingByWard.get(w.id) ?? null,
        member_count: memberCountByWard.get(w.id) ?? 0,
        friend_count: friendCountByWard.get(w.id) ?? 0,
      })),
    )
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.stake_id])

  async function updateStakeName(name: string) {
    if (!stake) return
    setNotice(null)
    setError(null)
    const { error } = await supabase
      .from('knit_stakes')
      .update({ name })
      .eq('id', stake.id)
    if (error) {
      setError(error.message)
      return
    }
    setStake({ ...stake, name })
    setNotice(t('settings.stake_name_saved'))
  }

  async function createWard(name: string) {
    if (!profile.stake_id) return
    setNotice(null)
    setError(null)
    const { error } = await supabase
      .from('knit_wards')
      .insert({ name, stake_id: profile.stake_id })
    if (error) {
      setError(error.message)
      return
    }
    setNotice(t('settings.ward_added', { name }))
    setShowNewWard(false)
    await refresh()
  }

  async function renameWard(wardId: string, name: string) {
    setNotice(null)
    setError(null)
    const { error } = await supabase.from('knit_wards').update({ name }).eq('id', wardId)
    if (error) {
      setError(error.message)
      return
    }
    setNotice(t('settings.ward_renamed'))
    await refresh()
  }

  async function removeWard(ward: WardWithBinding) {
    if (ward.member_count > 0 || ward.friend_count > 0) {
      alert(
        t('settings.ward_cannot_remove', {
          name: ward.name,
          members: ward.member_count,
          friends: ward.friend_count,
        }),
      )
      return
    }
    if (!confirm(t('settings.remove_ward_confirm', { name: ward.name }))) return
    if (ward.binding) {
      await supabase.from('knit_google_sheet_bindings').delete().eq('id', ward.binding.id)
    }
    const { error } = await supabase.from('knit_wards').delete().eq('id', ward.id)
    if (error) {
      setError(error.message)
      return
    }
    setNotice(t('settings.ward_removed', { name: ward.name }))
    await refresh()
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('settings.page_title')}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {t('settings.page_subtitle')}
        </p>
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

      <section className="rounded-md border border-gray-200 bg-white p-5 space-y-4">
        <header>
          <h2 className="text-lg font-medium text-gray-900">{t('settings.stake_heading')}</h2>
          <p className="text-sm text-gray-600">
            {t('settings.stake_subtitle')}
          </p>
        </header>
        {loading ? (
          <p className="text-sm text-gray-500">{t('loading')}</p>
        ) : !stake ? (
          <p className="text-sm text-gray-500">{t('settings.no_stake')}</p>
        ) : (
          <StakeNameForm
            stake={stake}
            canEditStake={stakeAdmin}
            onSave={(name) => void updateStakeName(name)}
          />
        )}
      </section>

      <section className="rounded-md border border-gray-200 bg-white p-5 space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-gray-900">{t('settings.wards_heading')}</h2>
            <p className="text-sm text-gray-600">
              {t('settings.wards_summary', { count: wards.length })}
            </p>
          </div>
          {stakeAdmin ? (
            <button
              onClick={() => setShowNewWard((v) => !v)}
              className="btn-primary text-sm py-2 px-4 whitespace-nowrap"
            >
              {showNewWard ? t('cancel') : t('settings.add_ward')}
            </button>
          ) : null}
        </header>

        {showNewWard && stakeAdmin ? (
          <NewWardForm onCreate={(name) => void createWard(name)} />
        ) : null}

        {loading ? (
          <p className="text-sm text-gray-500">{t('settings.loading_wards')}</p>
        ) : wards.length === 0 ? (
          <p className="text-sm text-gray-500">{t('settings.no_wards')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 -mx-5">
            {wards.map((w) => (
              <WardRowItem
                key={w.id}
                ward={w}
                canEdit={stakeAdmin}
                onRename={(name) => void renameWard(w.id, name)}
                onRemove={() => void removeWard(w)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-md border border-gray-200 bg-white p-5 space-y-3">
        <header>
          <h2 className="text-lg font-medium text-gray-900">{t('settings.account_heading')}</h2>
        </header>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Meta label={t('settings.name')}>{profile.name ?? t('dash')}</Meta>
          <Meta label={t('settings.email')}>{profile.email}</Meta>
          <Meta label={t('settings.role')}>{roleLabel(profile.role, t)}</Meta>
          <Meta label={t('settings.scope')}>
            {profile.ward?.name ?? profile.stake?.name ?? t('dash')}
          </Meta>
          {profile.is_super_admin ? (
            <Meta label={t('settings.privileges')}>
              <span className="rounded-full bg-knit-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
                {t('settings.super_admin')}
              </span>
            </Meta>
          ) : null}
        </dl>
        {stakeAdmin ? (
          <p className="text-sm text-gray-600">
            {t('settings.need_change_admins')}{' '}
            <Link to="/admin/users" className="text-knit-primary font-medium underline">
              {t('settings.open_users')}
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  )
}

function StakeNameForm({
  stake,
  canEditStake,
  onSave,
}: {
  stake: StakeRow
  canEditStake: boolean
  onSave: (name: string) => void
}) {
  const { t } = useTranslation('common')
  const [name, setName] = useState(stake.name)
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    setName(stake.name)
    setDirty(false)
  }, [stake.name])
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block space-y-1.5 flex-1 min-w-[200px]">
        <span className="text-sm font-medium text-gray-700">{t('settings.stake_name')}</span>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setDirty(e.target.value !== stake.name)
          }}
          disabled={!canEditStake}
          className="form-input"
        />
      </label>
      {canEditStake ? (
        <button
          onClick={() => onSave(name.trim())}
          disabled={!dirty || !name.trim()}
          className="btn-primary text-sm py-2 px-4"
        >
          {t('save')}
        </button>
      ) : null}
    </div>
  )
}

function NewWardForm({ onCreate }: { onCreate: (name: string) => void }) {
  const { t } = useTranslation('common')
  const [name, setName] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onCreate(name.trim())
    setName('')
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-gray-300 p-4"
    >
      <label className="block space-y-1.5 flex-1 min-w-[200px]">
        <span className="text-sm font-medium text-gray-700">{t('settings.ward_name')}</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.ward_name_placeholder')}
          className="form-input"
          autoFocus
        />
      </label>
      <button type="submit" className="btn-primary text-sm py-2 px-4">
        {t('create')}
      </button>
    </form>
  )
}

function WardRowItem({
  ward,
  canEdit,
  onRename,
  onRemove,
}: {
  ward: WardWithBinding
  canEdit: boolean
  onRename: (name: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('common')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(ward.name)

  function commit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === ward.name) {
      setEditing(false)
      setDraft(ward.name)
      return
    }
    onRename(trimmed)
    setEditing(false)
  }

  const status = ward.binding?.status ?? 'not_configured'
  const statusLabel =
    status === 'healthy'
      ? t('settings.sheet_healthy')
      : status === 'error'
        ? t('settings.sheet_error')
        : t('settings.no_sheet_yet')
  const statusTone =
    status === 'healthy'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'error'
        ? 'bg-rose-100 text-rose-800'
        : 'bg-gray-100 text-gray-700'

  return (
    <li className="px-5 py-4 flex flex-wrap items-center gap-4 justify-between">
      <div className="flex-1 min-w-[200px]">
        {editing ? (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setEditing(false)
                setDraft(ward.name)
              }
            }}
            className="form-input"
            autoFocus
          />
        ) : (
          <div className="font-medium text-gray-900">{ward.name}</div>
        )}
        <div className="text-xs text-gray-500 mt-1">
          {t('settings.members', { count: ward.member_count })} ·{' '}
          {t('settings.friends', { count: ward.friend_count })}
        </div>
      </div>
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusTone}`}
      >
        {statusLabel}
      </span>
      <div className="flex items-center gap-3">
        <Link
          to={`/admin/sheet?wardId=${ward.id}`}
          className="text-sm text-knit-primary font-medium hover:underline"
        >
          {t('settings.manage_sheet')}
        </Link>
        {canEdit && !editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            {t('rename')}
          </button>
        ) : null}
        {canEdit ? (
          <button
            onClick={onRemove}
            className="text-sm text-error hover:opacity-80"
          >
            {t('remove')}
          </button>
        ) : null}
      </div>
    </li>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 font-medium uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-gray-800 mt-0.5">{children}</dd>
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import { canEdit, isWardScoped } from '@/lib/roles'
import AvailabilityGrid from '@/components/AvailabilityGrid'
import InterestChipPicker from '@/components/InterestChipPicker'
import DemoBadge from '@/components/DemoBadge'
import { slotsToString, type Slot } from '@/lib/availability'
import type { Database } from '@/lib/database.types'

type FriendRow = Database['public']['Tables']['knit_friends']['Row']
type FriendWithWard = FriendRow & { ward?: { id: string; name: string } | null }
type Ctx = { profile: AdminProfile }
type TeachingStatus = Database['public']['Enums']['knit_teaching_status']

const STATUS_KEYS: TeachingStatus[] = ['investigating', 'progressing', 'on_date', 'baptized', 'paused', 'lost_contact']

export default function AdminFriends() {
  const { profile } = useOutletContext<Ctx>()
  const { t } = useTranslation('common')
  const { wards, loading: wardsLoading } = useWardOptions(profile)
  const editor = canEdit(profile)
  const [friends, setFriends] = useState<FriendWithWard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showRemoved, setShowRemoved] = useState(false)

  const statusLabel = (s: TeachingStatus) => t(`friends.status.${s}`)

  async function refresh() {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('knit_friends')
      .select('*, ward:knit_wards(id, name)')
      .order('added_at', { ascending: false })
      .limit(500)
    if (!showRemoved) q = q.is('removed_at', null)
    const { data, error } = await q
    if (error) setError(error.message)
    else setFriends((data as FriendWithWard[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRemoved])

  async function remove(id: string) {
    if (!confirm(t('friends.remove_confirm'))) return
    const { error } = await supabase
      .from('knit_friends')
      .update({ removed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      alert(error.message)
      return
    }
    await refresh()
  }

  async function restore(id: string) {
    const { error } = await supabase
      .from('knit_friends')
      .update({ removed_at: null, removed_reason: null })
      .eq('id', id)
    if (error) {
      alert(error.message)
      return
    }
    await refresh()
  }

  async function saveFriend(id: string, patch: Partial<FriendRow>) {
    const { error } = await supabase.from('knit_friends').update(patch).eq('id', id)
    if (error) {
      alert(error.message)
      return
    }
    setEditingId(null)
    await refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('friends.page_title')}</h1>
          <p className="text-sm text-gray-600 mt-1">
            {t('friends.page_subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showRemoved}
              onChange={(e) => setShowRemoved(e.target.checked)}
              className="rounded border-gray-300"
            />
            {t('friends.show_removed')}
          </label>
          {editor ? (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="btn-primary text-sm py-2 px-4"
            >
              {showForm ? t('cancel') : t('friends.add_friend')}
            </button>
          ) : null}
        </div>
      </div>

      {showForm && editor ? (
        <NewFriendForm
          wards={wards}
          wardsLoading={wardsLoading}
          defaultWardId={
            isWardScoped(profile.role) && !profile.is_super_admin
              ? profile.ward_id ?? ''
              : ''
          }
          onCreated={async () => {
            setShowForm(false)
            await refresh()
          }}
        />
      ) : null}

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-500">{t('friends.loading')}</div>
        ) : error ? (
          <div className="p-6 text-sm text-error">{error}</div>
        ) : friends.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            {t('friends.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px] md:min-w-0">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">{t('friends.col_name')}</th>
                <th className="px-4 py-3 font-medium">{t('friends.col_status')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('friends.col_language')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('friends.col_typical_avail')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('friends.col_ward')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {friends.map((f) =>
                editingId === f.id ? (
                  <EditFriendRow
                    key={f.id}
                    friend={f}
                    onCancel={() => setEditingId(null)}
                    onSave={(patch) => void saveFriend(f.id, patch)}
                  />
                ) : (
                  <tr key={f.id} className={f.removed_at ? 'opacity-60' : ''}>
                    <td className="px-4 py-3 text-gray-900">
                      {[f.first_name, f.last_name].filter(Boolean).join(' ')}
                      {f.nickname ? (
                        <span className="text-gray-500"> "{f.nickname}"</span>
                      ) : null}
                      <DemoBadge when={f.is_demo} />
                      {f.removed_at ? (
                        <span
                          className="ml-2 inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700"
                          title={f.removed_reason ?? undefined}
                        >
                          {t('friends.removed')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {statusLabel(f.teaching_status)}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                      {f.locale === 'es' ? t('spanish') : t('english')}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                      {f.typical_availability ?? t('dash')}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                      {f.ward?.name ?? t('dash')}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {editor ? (
                        f.removed_at ? (
                          <button
                            onClick={() => void restore(f.id)}
                            className="text-sm text-gray-700 hover:text-gray-900"
                          >
                            {t('restore')}
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => setEditingId(f.id)}
                              className="text-sm text-gray-700 hover:text-gray-900 mr-4"
                            >
                              {t('edit')}
                            </button>
                            <button
                              onClick={() => void remove(f.id)}
                              className="text-sm text-error hover:opacity-80"
                            >
                              {t('remove')}
                            </button>
                          </>
                        )
                      ) : (
                        <span className="text-xs text-gray-400">{t('view_only')}</span>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}

function NewFriendForm({
  wards,
  wardsLoading,
  defaultWardId,
  onCreated,
}: {
  wards: { id: string; name: string }[]
  wardsLoading: boolean
  defaultWardId: string
  onCreated: () => void | Promise<void>
}) {
  const { t } = useTranslation('common')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [locale, setLocale] = useState<'en' | 'es'>('en')
  const [teachingStatus, setTeachingStatus] = useState<TeachingStatus>('investigating')
  const [availability, setAvailability] = useState<Slot[]>([])
  const [interestIds, setInterestIds] = useState<string[]>([])
  const [phone, setPhone] = useState('')
  const [wardId, setWardId] = useState(defaultWardId)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!wardId && wards.length === 1) setWardId(wards[0].id)
  }, [wards, wardId])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!wardId) {
      setErr(t('friends.pick_ward'))
      return
    }
    setSaving(true)
    setErr(null)
    const availStr = slotsToString(availability, t)
    const { error } = await supabase.from('knit_friends').insert({
      ward_id: wardId,
      first_name: firstName.trim(),
      last_name: lastName.trim() || null,
      nickname: nickname.trim() || null,
      locale,
      teaching_status: teachingStatus,
      typical_availability: availStr || null,
      phone: phone.trim() || null,
      interest_tag_ids: interestIds,
    })
    setSaving(false)
    if (error) {
      setErr(error.message)
      return
    }
    setFirstName('')
    setLastName('')
    setNickname('')
    setLocale('en')
    setTeachingStatus('investigating')
    setAvailability([])
    setInterestIds([])
    setPhone('')
    await onCreated()
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-gray-200 bg-white p-5 grid gap-4 sm:grid-cols-2"
    >
      <Field label={t('friends.first_name')} required>
        <input
          type="text"
          required
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="form-input"
        />
      </Field>
      <Field label={t('friends.last_name')}>
        <input
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="form-input"
        />
      </Field>
      <Field label={t('friends.nickname')}>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className="form-input"
        />
      </Field>
      <Field label={t('friends.phone')}>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="form-input"
        />
      </Field>
      <Field label={t('friends.language')}>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as 'en' | 'es')}
          className="form-input"
        >
          <option value="en">{t('english')}</option>
          <option value="es">{t('spanish')}</option>
        </select>
      </Field>
      <Field label={t('friends.teaching_status')}>
        <select
          value={teachingStatus}
          onChange={(e) => setTeachingStatus(e.target.value as TeachingStatus)}
          className="form-input"
        >
          {STATUS_KEYS.map((s) => (
            <option key={s} value={s}>
              {t(`friends.status.${s}`)}
            </option>
          ))}
        </select>
      </Field>
      {wards.length > 1 ? (
        <Field label={t('ward')} required>
          <select
            required
            value={wardId}
            onChange={(e) => setWardId(e.target.value)}
            className="form-input"
            disabled={wardsLoading}
          >
            <option value="">{wardsLoading ? t('loading') : t('pick_a_ward')}</option>
            {wards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="sm:col-span-2 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-gray-700">{t('friends.typical_availability')}</span>
          <span className="text-xs text-gray-500">
            {slotsToString(availability, t) || t('friends.tap_when_free')}
          </span>
        </div>
        <AvailabilityGrid value={availability} onChange={setAvailability} />
      </div>
      <div className="sm:col-span-2 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-gray-700">{t('friends.interests')}</span>
          <span className="text-xs text-gray-500">
            {t('friends.interests_hint')}
          </span>
        </div>
        <InterestChipPicker
          wardId={wardId || null}
          value={interestIds}
          onChange={setInterestIds}
        />
      </div>
      <div className="sm:col-span-2 flex items-center justify-between pt-2">
        {err ? <p className="text-sm text-error">{err}</p> : <span />}
        <button
          type="submit"
          disabled={saving}
          className="btn-primary text-sm py-2 px-4"
        >
          {saving ? t('saving') : t('friends.save_friend')}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-gray-700">
        {label}
        {required ? <span className="text-error"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-gray-500">{hint}</span> : null}
    </label>
  )
}

/**
 * Inline edit row.
 */
function EditFriendRow({
  friend,
  onCancel,
  onSave,
}: {
  friend: FriendWithWard
  onCancel: () => void
  onSave: (patch: Partial<FriendRow>) => void
}) {
  const { t } = useTranslation('common')
  const [firstName, setFirstName] = useState(friend.first_name ?? '')
  const [lastName, setLastName] = useState(friend.last_name ?? '')
  const [nickname, setNickname] = useState(friend.nickname ?? '')
  const [phone, setPhone] = useState(friend.phone ?? '')
  const [locale, setLocale] = useState<'en' | 'es'>(friend.locale ?? 'en')
  const [teachingStatus, setTeachingStatus] = useState<TeachingStatus>(
    friend.teaching_status,
  )
  const [typicalAvailability, setTypicalAvailability] = useState(
    friend.typical_availability ?? '',
  )
  const [notes, setNotes] = useState(friend.notes ?? '')

  function save() {
    onSave({
      first_name: firstName.trim(),
      last_name: lastName.trim() || null,
      nickname: nickname.trim() || null,
      phone: phone.trim() || null,
      locale,
      teaching_status: teachingStatus,
      typical_availability: typicalAvailability.trim() || null,
      notes: notes.trim() || null,
    })
  }

  return (
    <tr className="bg-gray-50/60">
      <td colSpan={6} className="px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('friends.first_name')}>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="form-input"
            />
          </Field>
          <Field label={t('friends.last_name')}>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="form-input"
            />
          </Field>
          <Field label={t('friends.nickname')}>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="form-input"
            />
          </Field>
          <Field label={t('friends.phone')}>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="form-input"
            />
          </Field>
          <Field label={t('friends.language')}>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as 'en' | 'es')}
              className="form-input"
            >
              <option value="en">{t('english')}</option>
              <option value="es">{t('spanish')}</option>
            </select>
          </Field>
          <Field label={t('friends.teaching_status')}>
            <select
              value={teachingStatus}
              onChange={(e) => setTeachingStatus(e.target.value as TeachingStatus)}
              className="form-input"
            >
              {STATUS_KEYS.map((s) => (
                <option key={s} value={s}>
                  {t(`friends.status.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t('friends.typical_availability')}
            hint={t('friends.edit_typical_hint')}
          >
            <input
              type="text"
              value={typicalAvailability}
              onChange={(e) => setTypicalAvailability(e.target.value)}
              className="form-input"
            />
          </Field>
          <Field label={t('friends.notes')} hint={t('friends.notes_hint')}>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="form-input"
            />
          </Field>
        </div>
        <div className="flex gap-2 pt-3">
          <button onClick={save} className="btn-primary text-sm py-1.5 px-3">
            {t('save')}
          </button>
          <button
            onClick={onCancel}
            className="rounded-md border-[1.5px] border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            {t('cancel')}
          </button>
          <p className="text-xs text-gray-500 self-center">
            {t('friends.appear_within_hour')}
          </p>
        </div>
      </td>
    </tr>
  )
}

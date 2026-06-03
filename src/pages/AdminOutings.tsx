import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import { canEdit, isWardScoped } from '@/lib/roles'
import { TIME_SLOTS, type TimeSlot } from '@/lib/availability'
import DemoBadge from '@/components/DemoBadge'
import type { Database } from '@/lib/database.types'

type OutingRow = Database['public']['Tables']['knit_outings']['Row']
type OutingStatus = Database['public']['Enums']['knit_outing_status']
type FriendRow = Database['public']['Tables']['knit_friends']['Row']
type MemberRow = Database['public']['Tables']['knit_members']['Row']

type OutingWithRels = OutingRow & {
  friend?: Pick<FriendRow, 'id' | 'first_name' | 'last_name'> | null
  member?: Pick<MemberRow, 'id' | 'first_name' | 'last_name' | 'preferred_name'> | null
  ward?: { id: string; name: string } | null
}

type Ctx = { profile: AdminProfile }

const STATUS_TONE: Record<OutingStatus, 'slate' | 'emerald' | 'amber' | 'rose' | 'sky'> = {
  scheduled: 'sky',
  happened: 'emerald',
  flaked: 'rose',
  rescheduled: 'amber',
  canceled: 'rose',
  needs_checkin: 'rose',
}

const SLOT_HOURS: Record<TimeSlot, number> = { morning: 9, afternoon: 14, evening: 19 }

const PICKABLE_STATUS: OutingStatus[] = ['scheduled', 'happened', 'flaked', 'rescheduled']

function statusLabelOf(s: OutingStatus, t: (k: string) => string): string {
  if (s === 'scheduled') return t('outings.status_options.scheduled')
  if (s === 'happened') return t('outings.status_options.happened')
  if (s === 'rescheduled') return t('outings.status_options.rescheduled')
  return t('outings.status_options.didnt_happen')
}

export default function AdminOutings() {
  const { profile } = useOutletContext<Ctx>()
  const { t } = useTranslation('common')
  const { wards, loading: wardsLoading } = useWardOptions(profile)
  const editor = canEdit(profile)
  const [outings, setOutings] = useState<OutingWithRels[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  async function refresh() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('knit_outings')
      .select(
        `*,
         friend:knit_friends(id, first_name, last_name),
         member:knit_members(id, first_name, last_name, preferred_name),
         ward:knit_wards(id, name)`,
      )
      .order('scheduled_at', { ascending: false })
      .limit(100)
    if (error) setError(error.message)
    else setOutings((data as OutingWithRels[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function remove(id: string) {
    if (!confirm(t('outings.remove_confirm'))) return
    const { error } = await supabase.from('knit_outings').delete().eq('id', id)
    if (error) {
      alert(error.message)
      return
    }
    await refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('outings.page_title')}</h1>
          <p className="text-sm text-gray-600 mt-1">
            {t('outings.page_subtitle')}
          </p>
        </div>
        {editor ? (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn-primary text-sm py-2 px-4"
          >
            {showForm ? t('cancel') : t('outings.log_outing')}
          </button>
        ) : null}
      </div>

      {showForm && editor ? (
        <NewOutingForm
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
          <div className="p-6 text-sm text-gray-500">{t('outings.loading')}</div>
        ) : error ? (
          <div className="p-6 text-sm text-error">{error}</div>
        ) : outings.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            {t('outings.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px] md:min-w-0">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">{t('outings.col_when')}</th>
                <th className="px-4 py-3 font-medium">{t('outings.col_friend')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('outings.col_member')}</th>
                <th className="px-4 py-3 font-medium">{t('outings.col_status')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('outings.col_notes')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {outings.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3 text-gray-900 whitespace-nowrap">
                    {formatWhen(o.scheduled_at, o.scheduled_time_slot as TimeSlot, t)}
                    <DemoBadge when={o.is_demo} />
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {o.friend
                      ? [o.friend.first_name, o.friend.last_name].filter(Boolean).join(' ')
                      : t('dash')}
                  </td>
                  <td className="px-4 py-3 text-gray-700 hidden md:table-cell">
                    {o.member ? memberName(o.member, t) : t('outings.no_member_display')}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate hidden lg:table-cell">
                    {o.outcome_notes ?? t('dash')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editor ? (
                      <button
                        onClick={() => void remove(o.id)}
                        className="text-sm text-error hover:opacity-80"
                      >
                        {t('remove')}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">{t('view_only')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}

function memberName(
  m: { first_name: string | null; last_name: string | null; preferred_name: string | null },
  t: (k: string) => string,
) {
  if (m.preferred_name) return m.preferred_name
  return [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || t('dash')
}

function formatWhen(scheduledAt: string, slot: TimeSlot, t: (k: string) => string) {
  const d = new Date(scheduledAt)
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const slotLabel = t(`outings.time_slots.${slot}`)
  return `${dateStr} · ${slotLabel}`
}

function StatusBadge({ status }: { status: OutingStatus }) {
  const { t } = useTranslation('common')
  const tone = STATUS_TONE[status]
  const palette: Record<string, string> = {
    slate: 'bg-gray-100 text-gray-700',
    emerald: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-800',
    sky: 'bg-sky-100 text-sky-800',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${palette[tone]}`}>
      {statusLabelOf(status, t)}
    </span>
  )
}

function NewOutingForm({
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
  const [wardId, setWardId] = useState(defaultWardId)
  const [friends, setFriends] = useState<FriendRow[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loadingPools, setLoadingPools] = useState(false)

  const [friendId, setFriendId] = useState('')
  const [memberId, setMemberId] = useState('')
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [date, setDate] = useState(todayStr)
  const [slot, setSlot] = useState<TimeSlot>('evening')
  const [status, setStatus] = useState<OutingStatus>('happened')
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!wardId && wards.length === 1) setWardId(wards[0].id)
  }, [wards, wardId])

  useEffect(() => {
    if (!wardId) {
      setFriends([])
      setMembers([])
      return
    }
    setLoadingPools(true)
    ;(async () => {
      const [fRes, mRes] = await Promise.all([
        supabase
          .from('knit_friends')
          .select('*')
          .eq('ward_id', wardId)
          .is('removed_at', null)
          .order('first_name'),
        supabase
          .from('knit_members')
          .select('*')
          .eq('ward_id', wardId)
          .not('onboarding_completed_at', 'is', null)
          .is('opted_out_at', null)
          .order('first_name'),
      ])
      setFriends((fRes.data as FriendRow[] | null) ?? [])
      setMembers((mRes.data as MemberRow[] | null) ?? [])
      setLoadingPools(false)
    })()
  }, [wardId])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!wardId || !friendId) {
      setErr(t('outings.pick_ward_friend'))
      return
    }
    setSaving(true)
    setErr(null)

    const [y, m, d] = date.split('-').map(Number)
    const scheduledAt = new Date(y, (m ?? 1) - 1, d ?? 1, SLOT_HOURS[slot], 0, 0).toISOString()

    const { error } = await supabase.from('knit_outings').insert({
      ward_id: wardId,
      friend_id: friendId,
      member_id: memberId || null,
      scheduled_at: scheduledAt,
      scheduled_time_slot: slot,
      status,
      outcome_notes: notes.trim() || null,
      logged_by: 'admin',
      logged_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) {
      setErr(error.message)
      return
    }

    setFriendId('')
    setMemberId('')
    setDate(todayStr)
    setSlot('evening')
    setStatus('happened')
    setNotes('')
    await onCreated()
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-gray-200 bg-white p-5 grid gap-4 sm:grid-cols-2"
    >
      {wards.length > 1 ? (
        <Field label={t('ward')} required>
          <select
            value={wardId}
            onChange={(e) => {
              setWardId(e.target.value)
              setFriendId('')
              setMemberId('')
            }}
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

      <Field label={t('outings.friend')} required>
        <select
          value={friendId}
          onChange={(e) => setFriendId(e.target.value)}
          className="form-input"
          disabled={loadingPools}
          required
        >
          <option value="">
            {loadingPools
              ? t('loading')
              : friends.length === 0
                ? t('outings.no_friends_in_ward')
                : t('outings.pick_a_friend')}
          </option>
          {friends.map((f) => (
            <option key={f.id} value={f.id}>
              {[f.first_name, f.last_name].filter(Boolean).join(' ')}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('outings.member')} hint={t('outings.member_hint')}>
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="form-input"
          disabled={loadingPools}
        >
          <option value="">{t('outings.no_member_display')}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {memberName(m, t)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('outings.date')} required>
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="form-input"
        />
      </Field>

      <Field label={t('outings.time_of_day')} required>
        <select
          value={slot}
          onChange={(e) => setSlot(e.target.value as TimeSlot)}
          className="form-input"
        >
          {TIME_SLOTS.map((s) => (
            <option key={s.value} value={s.value}>
              {t(`outings.time_slots.${s.value}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('outings.status_label')} required>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as OutingStatus)}
          className="form-input"
        >
          {PICKABLE_STATUS.map((s) => (
            <option key={s} value={s}>
              {statusLabelOf(s, t)}
            </option>
          ))}
        </select>
      </Field>

      <div className="sm:col-span-2">
        <Field label={t('outings.outcome_notes')} hint={t('outings.outcome_hint')}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="form-input"
            placeholder={t('outings.notes_placeholder')}
          />
        </Field>
      </div>

      <div className="sm:col-span-2 flex items-center justify-between pt-2">
        {err ? <p className="text-sm text-error">{err}</p> : <span />}
        <button
          type="submit"
          disabled={saving}
          className="btn-primary text-sm py-2 px-4"
        >
          {saving ? t('saving') : t('outings.save_outing')}
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

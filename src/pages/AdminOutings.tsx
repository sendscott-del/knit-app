import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import { TIME_SLOTS, type TimeSlot } from '@/lib/availability'
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

const STATUS_LABELS: Record<OutingStatus, string> = {
  scheduled: 'Scheduled',
  happened: 'Happened',
  flaked: 'Flaked',
  rescheduled: 'Rescheduled',
  canceled: 'Canceled',
  needs_checkin: 'Needs check-in',
}

const STATUS_TONE: Record<OutingStatus, 'slate' | 'emerald' | 'amber' | 'rose' | 'sky'> = {
  scheduled: 'sky',
  happened: 'emerald',
  flaked: 'rose',
  rescheduled: 'amber',
  canceled: 'slate',
  needs_checkin: 'amber',
}

const SLOT_HOURS: Record<TimeSlot, number> = { morning: 9, afternoon: 14, evening: 19 }

export default function AdminOutings() {
  const { profile } = useOutletContext<Ctx>()
  const { wards, loading: wardsLoading } = useWardOptions(profile)
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
    if (!confirm('Remove this outing record?')) return
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
          <h1 className="text-2xl font-semibold text-slate-900">Outings</h1>
          <p className="text-sm text-slate-600 mt-1">
            Who went with whom, when, and what came of it.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'Log outing'}
        </button>
      </div>

      {showForm ? (
        <NewOutingForm
          wards={wards}
          wardsLoading={wardsLoading}
          defaultWardId={profile.role === 'ward_mission_leader' ? profile.ward_id ?? '' : ''}
          onCreated={async () => {
            setShowForm(false)
            await refresh()
          }}
        />
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading outings…</div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-700">{error}</div>
        ) : outings.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No outings logged yet. Log your first above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Friend</th>
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {outings.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3 text-slate-900 whitespace-nowrap">
                    {formatWhen(o.scheduled_at, o.scheduled_time_slot as TimeSlot)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {o.friend
                      ? [o.friend.first_name, o.friend.last_name].filter(Boolean).join(' ')
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {o.member ? memberName(o.member) : '— (no member)'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-xs truncate">
                    {o.outcome_notes ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => void remove(o.id)}
                      className="text-sm text-rose-700 hover:text-rose-900"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function memberName(m: { first_name: string | null; last_name: string | null; preferred_name: string | null }) {
  if (m.preferred_name) return m.preferred_name
  return [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || '—'
}

function formatWhen(scheduledAt: string, slot: TimeSlot) {
  const d = new Date(scheduledAt)
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const slotLabel = slot.charAt(0).toUpperCase() + slot.slice(1)
  return `${dateStr} · ${slotLabel}`
}

function StatusBadge({ status }: { status: OutingStatus }) {
  const tone = STATUS_TONE[status]
  const palette: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700',
    emerald: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-800',
    sky: 'bg-sky-100 text-sky-800',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${palette[tone]}`}>
      {STATUS_LABELS[status]}
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
          .order('first_name'),
        supabase
          .from('knit_members')
          .select('*')
          .eq('ward_id', wardId)
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
      setErr('Pick a ward and a friend.')
      return
    }
    setSaving(true)
    setErr(null)

    // Compose scheduled_at from date + slot hour (local time; stored as UTC ISO).
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
      className="rounded-xl border border-slate-200 bg-white p-5 grid gap-4 sm:grid-cols-2"
    >
      {wards.length > 1 ? (
        <Field label="Ward" required>
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
            <option value="">{wardsLoading ? 'Loading…' : 'Pick a ward'}</option>
            {wards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field label="Friend" required>
        <select
          value={friendId}
          onChange={(e) => setFriendId(e.target.value)}
          className="form-input"
          disabled={loadingPools}
          required
        >
          <option value="">
            {loadingPools
              ? 'Loading…'
              : friends.length === 0
                ? 'No friends in this ward'
                : 'Pick a friend'}
          </option>
          {friends.map((f) => (
            <option key={f.id} value={f.id}>
              {[f.first_name, f.last_name].filter(Boolean).join(' ')}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Member" hint="Leave blank if missionaries went without a ward member">
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="form-input"
          disabled={loadingPools}
        >
          <option value="">— (no member)</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {memberName(m)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Date" required>
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="form-input"
        />
      </Field>

      <Field label="Time of day" required>
        <select
          value={slot}
          onChange={(e) => setSlot(e.target.value as TimeSlot)}
          className="form-input"
        >
          {TIME_SLOTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Status" required>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as OutingStatus)}
          className="form-input"
        >
          {(Object.keys(STATUS_LABELS) as OutingStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>

      <div className="sm:col-span-2">
        <Field label="Outcome notes" hint="What happened? What should someone follow up on?">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="form-input"
            placeholder="Friend loved meeting the Johnsons — wants to come to dinner next week."
          />
        </Field>
      </div>

      <div className="sm:col-span-2 flex items-center justify-between pt-2">
        {err ? <p className="text-sm text-rose-700">{err}</p> : <span />}
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save outing'}
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
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  )
}

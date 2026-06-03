import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
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

// Display buckets. The DB enum has six values (scheduled, happened, flaked,
// rescheduled, canceled, needs_checkin) but missionaries don't need to
// distinguish flaked vs canceled vs needs_checkin — they all mean "the
// outing didn't happen as planned." Surface four buckets and map flaked /
// canceled / needs_checkin → "Didn't happen" for display. New entries
// only get to pick from these four; canonical write values are below.
const STATUS_LABELS: Record<OutingStatus, string> = {
  scheduled: 'Scheduled',
  happened: 'Happened',
  flaked: "Didn't happen",
  canceled: "Didn't happen",
  needs_checkin: "Didn't happen",
  rescheduled: 'Rescheduled',
}

const STATUS_TONE: Record<OutingStatus, 'slate' | 'emerald' | 'amber' | 'rose' | 'sky'> = {
  scheduled: 'sky',
  happened: 'emerald',
  flaked: 'rose',
  rescheduled: 'amber',
  canceled: 'rose',
  needs_checkin: 'rose',
}

// The four buckets a missionary can choose when logging or editing an outing.
// "Didn't happen" canonicalizes to 'flaked' since that's the most common cause.
const STATUS_OPTIONS: { value: OutingStatus; label: string }[] = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'happened', label: 'Happened' },
  { value: 'flaked', label: "Didn't happen" },
  { value: 'rescheduled', label: 'Rescheduled' },
]

const SLOT_HOURS: Record<TimeSlot, number> = { morning: 9, afternoon: 14, evening: 19 }

export default function AdminOutings() {
  const { profile } = useOutletContext<Ctx>()
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
          <h1 className="text-2xl font-semibold text-gray-900">Outings</h1>
          <p className="text-sm text-gray-600 mt-1">
            Who went with whom, when, and what came of it.
          </p>
        </div>
        {editor ? (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn-primary text-sm py-2 px-4"
          >
            {showForm ? 'Cancel' : 'Log outing'}
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
          <div className="p-6 text-sm text-gray-500">Loading outings…</div>
        ) : error ? (
          <div className="p-6 text-sm text-error">{error}</div>
        ) : outings.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            No outings logged yet. Log your first above.
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px] md:min-w-0">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Friend</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Member</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Notes</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {outings.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3 text-gray-900 whitespace-nowrap">
                    {formatWhen(o.scheduled_at, o.scheduled_time_slot as TimeSlot)}
                    <DemoBadge when={o.is_demo} />
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {o.friend
                      ? [o.friend.first_name, o.friend.last_name].filter(Boolean).join(' ')
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-700 hidden md:table-cell">
                    {o.member ? memberName(o.member) : '— (no member)'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate hidden lg:table-cell">
                    {o.outcome_notes ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editor ? (
                      <button
                        onClick={() => void remove(o.id)}
                        className="text-sm text-error hover:opacity-80"
                      >
                        Remove
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">View-only</span>
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
    slate: 'bg-gray-100 text-gray-700',
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
          .is('removed_at', null)
          .order('first_name'),
        supabase
          .from('knit_members')
          .select('*')
          .eq('ward_id', wardId)
          // Only members who have actually completed the survey can be
          // logged as participants — they're the only ones the missionaries
          // have committed availability for.
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
      className="rounded-md border border-gray-200 bg-white p-5 grid gap-4 sm:grid-cols-2"
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
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
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
        {err ? <p className="text-sm text-error">{err}</p> : <span />}
        <button
          type="submit"
          disabled={saving}
          className="btn-primary text-sm py-2 px-4"
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
      <span className="text-sm font-medium text-gray-700">
        {label}
        {required ? <span className="text-error"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-gray-500">{hint}</span> : null}
    </label>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import AvailabilityGrid from '@/components/AvailabilityGrid'
import { slotsToString, type Slot } from '@/lib/availability'
import type { Database } from '@/lib/database.types'

type FriendRow = Database['public']['Tables']['knit_friends']['Row']
type FriendWithWard = FriendRow & { ward?: { id: string; name: string } | null }
type Ctx = { profile: AdminProfile }
type TeachingStatus = Database['public']['Enums']['knit_teaching_status']

const STATUS_LABELS: Record<TeachingStatus, string> = {
  investigating: 'Investigating',
  progressing: 'Progressing',
  on_date: 'On a baptism date',
  baptized: 'Baptized',
  paused: 'Paused',
  lost_contact: 'Lost contact',
}

export default function AdminFriends() {
  const { profile } = useOutletContext<Ctx>()
  const { wards, loading: wardsLoading } = useWardOptions(profile)
  const [friends, setFriends] = useState<FriendWithWard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  async function refresh() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('knit_friends')
      .select('*, ward:knit_wards(id, name)')
      .order('added_at', { ascending: false })
    if (error) setError(error.message)
    else setFriends((data as FriendWithWard[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function remove(id: string) {
    if (!confirm('Remove this friend?')) return
    const { error } = await supabase.from('knit_friends').delete().eq('id', id)
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
          <h1 className="text-2xl font-semibold text-slate-900">Friends being taught</h1>
          <p className="text-sm text-slate-600 mt-1">
            People the missionaries are currently teaching.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'Add friend'}
        </button>
      </div>

      {showForm ? (
        <NewFriendForm
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
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-700">{error}</div>
        ) : friends.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No friends yet. Add your first above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Language</th>
                <th className="px-4 py-3 font-medium">Typical availability</th>
                <th className="px-4 py-3 font-medium">Ward</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {friends.map((f) => (
                <tr key={f.id}>
                  <td className="px-4 py-3 text-slate-900">
                    {[f.first_name, f.last_name].filter(Boolean).join(' ')}
                    {f.nickname ? (
                      <span className="text-slate-500"> "{f.nickname}"</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {STATUS_LABELS[f.teaching_status]}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {f.locale === 'es' ? 'Spanish' : 'English'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{f.typical_availability ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{f.ward?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => void remove(f.id)}
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
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [locale, setLocale] = useState<'en' | 'es'>('en')
  const [teachingStatus, setTeachingStatus] = useState<TeachingStatus>('investigating')
  const [availability, setAvailability] = useState<Slot[]>([])
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
      setErr('Pick a ward.')
      return
    }
    setSaving(true)
    setErr(null)
    const availStr = slotsToString(availability)
    const { error } = await supabase.from('knit_friends').insert({
      ward_id: wardId,
      first_name: firstName.trim(),
      last_name: lastName.trim() || null,
      nickname: nickname.trim() || null,
      locale,
      teaching_status: teachingStatus,
      typical_availability: availStr || null,
      phone: phone.trim() || null,
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
    setPhone('')
    await onCreated()
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-slate-200 bg-white p-5 grid gap-4 sm:grid-cols-2"
    >
      <Field label="First name" required>
        <input
          type="text"
          required
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="form-input"
        />
      </Field>
      <Field label="Last name">
        <input
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="form-input"
        />
      </Field>
      <Field label="Nickname">
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className="form-input"
        />
      </Field>
      <Field label="Phone">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="form-input"
        />
      </Field>
      <Field label="Language">
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as 'en' | 'es')}
          className="form-input"
        >
          <option value="en">English</option>
          <option value="es">Spanish</option>
        </select>
      </Field>
      <Field label="Teaching status">
        <select
          value={teachingStatus}
          onChange={(e) => setTeachingStatus(e.target.value as TeachingStatus)}
          className="form-input"
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {wards.length > 1 ? (
        <Field label="Ward" required>
          <select
            required
            value={wardId}
            onChange={(e) => setWardId(e.target.value)}
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
      <div className="sm:col-span-2 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-slate-700">Typical availability</span>
          <span className="text-xs text-slate-500">
            {slotsToString(availability) || "Tap any slots when the friend is usually free"}
          </span>
        </div>
        <AvailabilityGrid value={availability} onChange={setAvailability} />
      </div>
      <div className="sm:col-span-2 flex items-center justify-between pt-2">
        {err ? <p className="text-sm text-rose-700">{err}</p> : <span />}
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save friend'}
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

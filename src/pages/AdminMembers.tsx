import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import { canEdit, isWardScoped } from '@/lib/roles'
import AvailabilityGrid from '@/components/AvailabilityGrid'
import DemoBadge from '@/components/DemoBadge'
import { slotsToString, type Slot, type TimeSlot, type DayOfWeek } from '@/lib/availability'
import { memberInviteUrl } from '@/lib/memberAuth'
import type { Database } from '@/lib/database.types'

type MemberRow = Database['public']['Tables']['knit_members']['Row']
type BaselineRow = Database['public']['Tables']['knit_availability_baselines']['Row']
type WardRow = { id: string; name: string }
type MemberWithExtras = MemberRow & {
  ward?: WardRow | null
  availability?: BaselineRow[] | null
}
type Ctx = { profile: AdminProfile }

export default function AdminMembers() {
  const { profile } = useOutletContext<Ctx>()
  const { wards, loading: wardsLoading } = useWardOptions(profile)
  const editor = canEdit(profile)
  const [members, setMembers] = useState<MemberWithExtras[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [inviteLink, setInviteLink] = useState<{
    memberName: string
    url: string
  } | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('knit_members')
      .select(
        '*, ward:knit_wards(id, name), availability:knit_availability_baselines(day_of_week, time_slot)',
      )
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setMembers((data as MemberWithExtras[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function remove(id: string) {
    if (!confirm('Remove this member? This is permanent for now.')) return
    const { error } = await supabase.from('knit_members').delete().eq('id', id)
    if (error) {
      alert(error.message)
      return
    }
    await refresh()
  }

  async function generateInvite(member: MemberWithExtras) {
    if (
      member.token_issued_at &&
      !confirm(
        'This member already has a link. Generating a new one will invalidate the old one. Continue?',
      )
    ) {
      return
    }
    setGenerating(member.id)
    const { data, error } = await supabase.rpc('knit_generate_member_magic_link', {
      p_member_id: member.id,
    })
    setGenerating(null)
    if (error || !data) {
      alert(error?.message ?? 'Could not generate link.')
      return
    }
    const url = memberInviteUrl(window.location.origin, member.id, data as string)
    setInviteLink({ memberName: displayName(member), url })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Members</h1>
          <p className="text-sm text-gray-600 mt-1">
            Ward members enrolled in fellowship matching.
          </p>
        </div>
        {editor ? (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn-primary text-sm py-2 px-4"
          >
            {showForm ? 'Cancel' : 'Add member'}
          </button>
        ) : null}
      </div>

      {showForm && editor ? (
        <NewMemberForm
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
          <div className="p-6 text-sm text-gray-500">Loading members…</div>
        ) : error ? (
          <div className="p-6 text-sm text-error">{error}</div>
        ) : members.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            No members yet. Add your first above.
          </div>
        ) : (
          // Wrapped in overflow-x-auto for narrow viewports; columns also
          // collapse with hidden/md:table-cell so the most important data
          // (name + status + actions) stays in view on a phone.
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px] md:min-w-0">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">Phone</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Language</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Available</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Ward</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 text-gray-900">
                    {displayName(m)}
                    <DemoBadge when={m.is_demo} />
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{m.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                    {m.locale === 'es' ? 'Spanish' : 'English'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                    {m.availability && m.availability.length > 0
                      ? slotsToString(
                          m.availability.map((r) => ({
                            day: r.day_of_week as DayOfWeek,
                            timeSlot: r.time_slot as TimeSlot,
                          })),
                        )
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{m.ward?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge member={m} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {editor ? (
                      <>
                        <button
                          onClick={() => void generateInvite(m)}
                          disabled={generating === m.id}
                          className="text-sm text-gray-700 hover:text-gray-900 mr-4 disabled:opacity-50"
                        >
                          {generating === m.id
                            ? 'Generating…'
                            : m.token_issued_at
                              ? 'New link'
                              : 'Invite link'}
                        </button>
                        <button
                          onClick={() => void remove(m.id)}
                          className="text-sm text-error hover:opacity-80"
                        >
                          Remove
                        </button>
                      </>
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

      {inviteLink ? (
        <InviteLinkModal
          memberName={inviteLink.memberName}
          url={inviteLink.url}
          onClose={() => setInviteLink(null)}
        />
      ) : null}
    </div>
  )
}

function InviteLinkModal({
  memberName,
  url,
  onClose,
}: {
  memberName: string
  url: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <div
      className="fixed inset-0 z-40 bg-brand-primary-dark/50 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-md shadow-xl max-w-lg w-full p-4 sm:p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Invite link for {memberName}
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Copy this link and send it to them — by text, email, or in person.
            It's personal to them and is valid for 30 days. Generating a new link
            invalidates the old one.
          </p>
        </div>
        <div className="rounded-md border-[1.5px] border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 break-all font-mono">
          {url}
        </div>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md border-[1.5px] border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Close
          </button>
          <button
            onClick={() => void copy()}
            className="btn-primary text-sm py-2 px-4"
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  )
}

function displayName(m: MemberRow): string {
  if (m.preferred_name) return m.preferred_name
  const full = [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
  return full || '—'
}

function StatusBadge({ member }: { member: MemberWithExtras }) {
  if (member.opted_out_at) return <Badge tone="rose">Opted out</Badge>
  if (member.paused_until && new Date(member.paused_until) > new Date()) {
    return <Badge tone="amber">Paused</Badge>
  }
  // Per the Gathered User Access spreadsheet: "Ward members don't show as
  // active options until they have completed a Knit availability update."
  // So "Active" requires onboarding done AND at least one availability
  // baseline row. Onboarded-but-no-availability gets its own state so admins
  // can see who needs a nudge.
  const hasAvailability = (member.availability?.length ?? 0) > 0
  if (member.onboarding_completed_at && hasAvailability) {
    return <Badge tone="emerald">Active</Badge>
  }
  if (member.onboarding_completed_at) {
    return <Badge tone="amber">No availability yet</Badge>
  }
  return <Badge tone="slate">Not onboarded</Badge>
}

function Badge({
  tone,
  children,
}: {
  tone: 'slate' | 'emerald' | 'amber' | 'rose'
  children: React.ReactNode
}) {
  const palette = {
    slate: 'bg-gray-100 text-gray-700',
    emerald: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-800',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${palette[tone]}`}
    >
      {children}
    </span>
  )
}

function NewMemberForm({
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
  const [phone, setPhone] = useState('')
  const [locale, setLocale] = useState<'en' | 'es'>('en')
  const [wardId, setWardId] = useState(defaultWardId)
  const [availability, setAvailability] = useState<Slot[]>([])
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
    const { data: created, error } = await supabase
      .from('knit_members')
      .insert({
        ward_id: wardId,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        phone: phone.trim() || null,
        locale,
      })
      .select('id')
      .single()

    if (error || !created) {
      setSaving(false)
      setErr(error?.message ?? 'Failed to save member.')
      return
    }

    if (availability.length > 0) {
      const { error: availErr } = await supabase.from('knit_availability_baselines').insert(
        availability.map((s) => ({
          member_id: created.id,
          day_of_week: s.day,
          time_slot: s.timeSlot,
        })),
      )
      if (availErr) {
        setSaving(false)
        setErr(`Member saved, but availability failed: ${availErr.message}`)
        return
      }
    }

    setSaving(false)
    setFirstName('')
    setLastName('')
    setPhone('')
    setLocale('en')
    setAvailability([])
    await onCreated()
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-gray-200 bg-white p-5 grid gap-4 sm:grid-cols-2"
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
      <Field label="Phone" hint="Used later for SMS nudges via Tidings">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 555 555 5555"
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
          <span className="text-sm font-medium text-gray-700">Availability</span>
          <span className="text-xs text-gray-500">{slotsToString(availability) || 'Tap to select times'}</span>
        </div>
        <AvailabilityGrid value={availability} onChange={setAvailability} />
      </div>
      <div className="sm:col-span-2 flex items-center justify-between pt-2">
        {err ? <p className="text-sm text-error">{err}</p> : <span />}
        <button
          type="submit"
          disabled={saving}
          className="btn-primary text-sm py-2 px-4"
        >
          {saving ? 'Saving…' : 'Save member'}
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

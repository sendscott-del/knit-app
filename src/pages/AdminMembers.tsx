import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import { canEdit, isWardScoped } from '@/lib/roles'
import AvailabilityGrid from '@/components/AvailabilityGrid'
import InterestChipPicker from '@/components/InterestChipPicker'
import StylePicker from '@/components/StylePicker'
import DemoBadge from '@/components/DemoBadge'
import { slotsToString, type Slot, type TimeSlot, type DayOfWeek } from '@/lib/availability'
import { memberInviteUrl } from '@/lib/memberAuth'
import { Link } from 'react-router-dom'
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
    memberId: string
    memberName: string
    url: string
    phone: string | null
  } | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [wardFilter, setWardFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [totalCount, setTotalCount] = useState<number | null>(null)
  // Default view is "only members who have completed the survey." Search
  // overrides this so admins can still find someone in the broader roster
  // (e.g. to manually add them or check why they aren't showing up).
  const [showAll, setShowAll] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 200)
    return () => clearTimeout(t)
  }, [searchQuery])

  async function refresh() {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('knit_members')
      .select(
        '*, ward:knit_wards(id, name), availability:knit_availability_baselines(day_of_week, time_slot)',
        { count: 'exact' },
      )
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true })
    if (wardFilter) q = q.eq('ward_id', wardFilter)
    if (!showAll && !debouncedQuery) {
      // Idle view: registered members only. Searching or toggling "show all"
      // widens the set; the row cap still applies via PostgREST.
      q = q.not('onboarding_completed_at', 'is', null).is('opted_out_at', null)
    }
    if (debouncedQuery) {
      const safe = debouncedQuery.replace(/[%,()]/g, ' ').trim()
      if (safe) {
        const pattern = `%${safe}%`
        const phoneNeedle = safe.replace(/[\s\-()+]/g, '')
        const orParts = [
          `first_name.ilike.${pattern}`,
          `last_name.ilike.${pattern}`,
          `preferred_name.ilike.${pattern}`,
        ]
        if (phoneNeedle && /^\d+$/.test(phoneNeedle)) {
          orParts.push(`phone.ilike.%${phoneNeedle}%`)
        }
        q = q.or(orParts.join(','))
      }
      q = q.limit(200)
    } else {
      q = q.limit(1000)
    }
    const { data, error, count } = await q
    if (error) setError(error.message)
    else setMembers((data as MemberWithExtras[]) ?? [])
    setTotalCount(typeof count === 'number' ? count : null)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [wardFilter, debouncedQuery, showAll])

  // Server-side filter already trimmed the list; this is just an alias so
  // the JSX doesn't need to change much.
  const visibleMembers = members

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
    setInviteLink({
      memberId: member.id,
      memberName: displayName(member),
      url,
      phone: member.phone ?? null,
    })
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

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name or phone"
          className="form-input"
        />
        {wards.length > 1 ? (
          <select
            value={wardFilter}
            onChange={(e) => setWardFilter(e.target.value)}
            disabled={wardsLoading}
            className="form-input"
          >
            <option value="">All wards ({wards.length})</option>
            {wards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2 -mt-2">
        <p className="text-xs text-gray-500">
          {(() => {
            const wardLabel = wardFilter
              ? ` in ${wards.find((w) => w.id === wardFilter)?.name ?? 'selected ward'}`
              : ''
            const total = totalCount ?? members.length
            if (debouncedQuery) {
              return `${members.length.toLocaleString()} ${members.length === 1 ? 'match' : 'matches'} for "${debouncedQuery}"${wardLabel} (of ${total.toLocaleString()} ${showAll ? 'in roster' : 'registered'}).`
            }
            if (showAll) {
              if (totalCount !== null && members.length < totalCount) {
                return `Showing first ${members.length.toLocaleString()} of ${totalCount.toLocaleString()} members in the roster${wardLabel}. Type a name or phone to search the rest.`
              }
              return `${members.length.toLocaleString()} member${members.length === 1 ? '' : 's'} in roster${wardLabel}.`
            }
            return `${members.length.toLocaleString()} registered member${members.length === 1 ? '' : 's'}${wardLabel}.`
          })()}
        </p>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Show everyone in the roster (not just registered)
        </label>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-500">Loading members…</div>
        ) : error ? (
          <div className="p-6 text-sm text-error">{error}</div>
        ) : members.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            No members yet. Add your first above.
          </div>
        ) : visibleMembers.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            No members match those filters. {searchQuery ? (
              <button
                onClick={() => setSearchQuery('')}
                className="text-knit-primary hover:underline"
              >
                Clear search
              </button>
            ) : null}
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
              {visibleMembers.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 text-gray-900">
                    <button
                      onClick={() => setDetailId(m.id)}
                      className="text-left text-gray-900 hover:text-knit-primary hover:underline"
                    >
                      {displayName(m)}
                    </button>
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
          memberId={inviteLink.memberId}
          memberName={inviteLink.memberName}
          url={inviteLink.url}
          phone={inviteLink.phone}
          onClose={() => setInviteLink(null)}
        />
      ) : null}

      {detailId ? (
        <MemberDetailModal
          memberId={detailId}
          onClose={() => setDetailId(null)}
          onSaved={async () => {
            await refresh()
          }}
        />
      ) : null}

      <p className="text-xs text-gray-500">
        Want to search across the whole stake?{' '}
        <Link to="/admin/invitations" className="text-knit-primary hover:underline">
          Open the Invitations page →
        </Link>
      </p>
    </div>
  )
}

function InviteLinkModal({
  memberId,
  memberName,
  url,
  phone,
  onClose,
}: {
  memberId: string
  memberName: string
  url: string
  phone: string | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<
    | { kind: 'ok'; text: string }
    | { kind: 'err'; text: string }
    | null
  >(null)

  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function send() {
    setOutcome(null)
    setSending(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const res = await fetch('/api/admin/invitations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: 'send', member_id: memberId, channel: 'sms' }),
      })
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; recipient?: string; error?: string }
        | null
      if (!res.ok || !body?.ok) {
        setOutcome({ kind: 'err', text: body?.error ?? `Send failed (${res.status})` })
      } else {
        setOutcome({
          kind: 'ok',
          text: `Texted ${memberName} at ${body.recipient ?? phone}`,
        })
      }
    } catch (e) {
      setOutcome({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
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
            Invite {memberName}
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Knit will send {memberName.split(' ')[0]} a personal link to the availability survey.
            The link is unique to them and valid for 30 days.
          </p>
        </div>

        <button
          onClick={() => void send()}
          disabled={!phone || sending}
          className="w-full rounded-md border-[1.5px] border-knit-primary text-knit-primary px-3 py-2 text-sm font-medium hover:bg-knit-primary/5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending text…' : phone ? 'Send by text' : 'Send by text (no phone)'}
        </button>

        {outcome ? (
          <div
            className={`text-sm ${outcome.kind === 'ok' ? 'text-emerald-700' : 'text-error'}`}
          >
            {outcome.text}
          </div>
        ) : null}

        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
            Or copy the link to send another way
          </summary>
          <div className="mt-2 space-y-2">
            <div className="rounded-md border-[1.5px] border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 break-all font-mono">
              {url}
            </div>
            <button
              onClick={() => void copy()}
              className="rounded-md border-[1.5px] border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-1.5 text-xs font-medium"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        </details>

        <div className="flex items-center justify-end pt-1">
          <button
            onClick={onClose}
            className="rounded-md border-[1.5px] border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Close
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

/**
 * Detail / edit modal for a member's survey answers. Loads availability,
 * interests, and styles directly from the DB (we're admin — RLS lets us
 * write to these tables for members in our scope, no token needed). Saves
 * write back to the same tables. The modal is a viewer first; clicking
 * "Edit" on each section flips it to edit mode.
 */
function MemberDetailModal({
  memberId,
  onClose,
  onSaved,
}: {
  memberId: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  type DetailData = {
    member: MemberRow
    ward: { id: string; name: string } | null
    availability: Slot[]
    interestIds: string[]
    styleKeys: string[]
  }
  const [data, setData] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<'availability' | 'interests' | 'styles' | 'profile' | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    const [memberRes, availRes, interestRes, styleRes] = await Promise.all([
      supabase
        .from('knit_members')
        .select('*, ward:knit_wards(id, name)')
        .eq('id', memberId)
        .maybeSingle(),
      supabase
        .from('knit_availability_baselines')
        .select('day_of_week, time_slot')
        .eq('member_id', memberId),
      supabase
        .from('knit_member_interests')
        .select('interest_tag_id')
        .eq('member_id', memberId),
      supabase
        .from('knit_member_participation_styles')
        .select('style_key')
        .eq('member_id', memberId),
    ])
    if (memberRes.error || !memberRes.data) {
      setError(memberRes.error?.message ?? 'Member not found.')
      setLoading(false)
      return
    }
    const m = memberRes.data as MemberRow & { ward: unknown }
    const wardRaw = (m as { ward: unknown }).ward
    const ward = Array.isArray(wardRaw)
      ? ((wardRaw[0] as { id: string; name: string } | undefined) ?? null)
      : ((wardRaw as { id: string; name: string } | null) ?? null)
    const availability: Slot[] = (availRes.data ?? []).map((a) => ({
      day: a.day_of_week as DayOfWeek,
      timeSlot: a.time_slot as TimeSlot,
    }))
    setData({
      member: m as MemberRow,
      ward,
      availability,
      interestIds: (interestRes.data ?? []).map((i) => i.interest_tag_id as string),
      styleKeys: (styleRes.data ?? []).map((s) => s.style_key as string),
    })
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId])

  async function saveAvailability(slots: Slot[]) {
    setSaving(true)
    setError(null)
    const { error: delErr } = await supabase
      .from('knit_availability_baselines')
      .delete()
      .eq('member_id', memberId)
    if (delErr) {
      setError(delErr.message)
      setSaving(false)
      return
    }
    if (slots.length > 0) {
      const { error: insErr } = await supabase
        .from('knit_availability_baselines')
        .insert(
          slots.map((s) => ({
            member_id: memberId,
            day_of_week: s.day,
            time_slot: s.timeSlot,
          })),
        )
      if (insErr) {
        setError(insErr.message)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setEditing(null)
    await load()
    await onSaved()
  }

  async function saveInterests(ids: string[]) {
    setSaving(true)
    setError(null)
    const { error: delErr } = await supabase
      .from('knit_member_interests')
      .delete()
      .eq('member_id', memberId)
    if (delErr) {
      setError(delErr.message)
      setSaving(false)
      return
    }
    if (ids.length > 0) {
      const { error: insErr } = await supabase
        .from('knit_member_interests')
        .insert(ids.map((id) => ({ member_id: memberId, interest_tag_id: id })))
      if (insErr) {
        setError(insErr.message)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setEditing(null)
    await load()
    await onSaved()
  }

  async function saveStyles(keys: string[]) {
    setSaving(true)
    setError(null)
    const { error: delErr } = await supabase
      .from('knit_member_participation_styles')
      .delete()
      .eq('member_id', memberId)
    if (delErr) {
      setError(delErr.message)
      setSaving(false)
      return
    }
    if (keys.length > 0) {
      const { error: insErr } = await supabase
        .from('knit_member_participation_styles')
        .insert(keys.map((k) => ({ member_id: memberId, style_key: k })))
      if (insErr) {
        setError(insErr.message)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setEditing(null)
    await load()
    await onSaved()
  }

  async function saveProfile(patch: {
    preferred_name: string | null
    locale: 'en' | 'es'
    phone: string | null
  }) {
    setSaving(true)
    setError(null)
    const { error: upErr } = await supabase
      .from('knit_members')
      .update(patch)
      .eq('id', memberId)
    setSaving(false)
    if (upErr) {
      setError(upErr.message)
      return
    }
    setEditing(null)
    await load()
    await onSaved()
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-brand-primary-dark/50 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-md shadow-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : error ? (
          <div className="space-y-3">
            <p className="text-sm text-error">{error}</p>
            <button onClick={onClose} className="btn-primary text-sm py-2 px-4">
              Close
            </button>
          </div>
        ) : data ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {displayName(data.member)}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {data.ward?.name ?? '—'} · {data.member.phone ?? 'no phone'} ·{' '}
                  {data.member.locale === 'es' ? 'Spanish' : 'English'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {data.member.onboarding_completed_at
                    ? `Registered ${new Date(data.member.onboarding_completed_at).toLocaleDateString()}`
                    : 'Not yet onboarded'}
                </p>
              </div>
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-900">
                Close
              </button>
            </div>

            <ProfileSection
              member={data.member}
              editing={editing === 'profile'}
              saving={saving}
              onStartEdit={() => setEditing('profile')}
              onCancel={() => setEditing(null)}
              onSave={(p) => void saveProfile(p)}
            />

            <AvailabilitySection
              slots={data.availability}
              editing={editing === 'availability'}
              saving={saving}
              onStartEdit={() => setEditing('availability')}
              onCancel={() => setEditing(null)}
              onSave={(s) => void saveAvailability(s)}
            />

            <InterestsSection
              wardId={data.member.ward_id}
              ids={data.interestIds}
              editing={editing === 'interests'}
              saving={saving}
              onStartEdit={() => setEditing('interests')}
              onCancel={() => setEditing(null)}
              onSave={(ids) => void saveInterests(ids)}
            />

            <StylesSection
              keys={data.styleKeys}
              editing={editing === 'styles'}
              saving={saving}
              onStartEdit={() => setEditing('styles')}
              onCancel={() => setEditing(null)}
              onSave={(keys) => void saveStyles(keys)}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

function SectionShell({
  title,
  editing,
  onStartEdit,
  children,
}: {
  title: string
  editing: boolean
  onStartEdit: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {!editing ? (
          <button
            onClick={onStartEdit}
            className="text-xs text-gray-700 hover:text-gray-900 underline"
          >
            Edit
          </button>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function ProfileSection({
  member,
  editing,
  saving,
  onStartEdit,
  onCancel,
  onSave,
}: {
  member: MemberRow
  editing: boolean
  saving: boolean
  onStartEdit: () => void
  onCancel: () => void
  onSave: (p: { preferred_name: string | null; locale: 'en' | 'es'; phone: string | null }) => void
}) {
  const [preferred, setPreferred] = useState(member.preferred_name ?? '')
  const [locale, setLocale] = useState<'en' | 'es'>(member.locale ?? 'en')
  const [phone, setPhone] = useState(member.phone ?? '')

  useEffect(() => {
    if (editing) {
      setPreferred(member.preferred_name ?? '')
      setLocale(member.locale ?? 'en')
      setPhone(member.phone ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  return (
    <SectionShell title="Profile" editing={editing} onStartEdit={onStartEdit}>
      {editing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-gray-600">Preferred name</span>
            <input
              type="text"
              value={preferred}
              onChange={(e) => setPreferred(e.target.value)}
              className="form-input"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-gray-600">Phone</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="form-input"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-gray-600">Language</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as 'en' | 'es')}
              className="form-input"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
            </select>
          </label>
          <div className="sm:col-span-2 flex gap-2 pt-1">
            <button
              onClick={() =>
                onSave({
                  preferred_name: preferred.trim() || null,
                  locale,
                  phone: phone.trim() || null,
                })
              }
              disabled={saving}
              className="btn-primary text-sm py-1.5 px-3"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border-[1.5px] border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-700 space-y-1">
          <div>
            <span className="text-gray-500">Preferred name:</span>{' '}
            {member.preferred_name || '—'}
          </div>
          <div>
            <span className="text-gray-500">Phone:</span> {member.phone ?? '—'}
          </div>
          <div>
            <span className="text-gray-500">Language:</span>{' '}
            {member.locale === 'es' ? 'Spanish' : 'English'}
          </div>
        </div>
      )}
    </SectionShell>
  )
}

function AvailabilitySection({
  slots,
  editing,
  saving,
  onStartEdit,
  onCancel,
  onSave,
}: {
  slots: Slot[]
  editing: boolean
  saving: boolean
  onStartEdit: () => void
  onCancel: () => void
  onSave: (s: Slot[]) => void
}) {
  const [draft, setDraft] = useState<Slot[]>(slots)
  useEffect(() => {
    if (editing) setDraft(slots)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  return (
    <SectionShell title="Availability" editing={editing} onStartEdit={onStartEdit}>
      {editing ? (
        <div className="space-y-3">
          <AvailabilityGrid value={draft} onChange={setDraft} />
          <p className="text-xs text-gray-500">{slotsToString(draft) || 'No times set.'}</p>
          <div className="flex gap-2">
            <button
              onClick={() => onSave(draft)}
              disabled={saving}
              className="btn-primary text-sm py-1.5 px-3"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border-[1.5px] border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-700">{slotsToString(slots) || 'No times set yet.'}</p>
      )}
    </SectionShell>
  )
}

function InterestsSection({
  wardId,
  ids,
  editing,
  saving,
  onStartEdit,
  onCancel,
  onSave,
}: {
  wardId: string | null
  ids: string[]
  editing: boolean
  saving: boolean
  onStartEdit: () => void
  onCancel: () => void
  onSave: (ids: string[]) => void
}) {
  const [draft, setDraft] = useState<string[]>(ids)
  useEffect(() => {
    if (editing) setDraft(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  return (
    <SectionShell title="Interests" editing={editing} onStartEdit={onStartEdit}>
      {editing ? (
        <div className="space-y-3">
          <InterestChipPicker wardId={wardId} value={draft} onChange={setDraft} />
          <div className="flex gap-2">
            <button
              onClick={() => onSave(draft)}
              disabled={saving}
              className="btn-primary text-sm py-1.5 px-3"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border-[1.5px] border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : ids.length === 0 ? (
        <p className="text-sm text-gray-500">No interests set.</p>
      ) : (
        <p className="text-sm text-gray-700">{ids.length} picked.</p>
      )}
    </SectionShell>
  )
}

function StylesSection({
  keys,
  editing,
  saving,
  onStartEdit,
  onCancel,
  onSave,
}: {
  keys: string[]
  editing: boolean
  saving: boolean
  onStartEdit: () => void
  onCancel: () => void
  onSave: (keys: string[]) => void
}) {
  const [draft, setDraft] = useState<string[]>(keys)
  useEffect(() => {
    if (editing) setDraft(keys)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  return (
    <SectionShell title="How they help" editing={editing} onStartEdit={onStartEdit}>
      {editing ? (
        <div className="space-y-3">
          <StylePicker value={draft} onChange={setDraft} />
          <div className="flex gap-2">
            <button
              onClick={() => onSave(draft)}
              disabled={saving}
              className="btn-primary text-sm py-1.5 px-3"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border-[1.5px] border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : keys.length === 0 ? (
        <p className="text-sm text-gray-500">Not set.</p>
      ) : (
        <p className="text-sm text-gray-700">{keys.length} picked.</p>
      )}
    </SectionShell>
  )
}

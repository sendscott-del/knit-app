import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('common')
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
  const [showAll, setShowAll] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => {
    const tt = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 200)
    return () => clearTimeout(tt)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardFilter, debouncedQuery, showAll])

  const visibleMembers = members

  async function remove(id: string) {
    if (!confirm(t('members.remove_confirm'))) return
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
      !confirm(t('members.regenerate_confirm'))
    ) {
      return
    }
    setGenerating(member.id)
    const { data, error } = await supabase.rpc('knit_generate_member_magic_link', {
      p_member_id: member.id,
    })
    setGenerating(null)
    if (error || !data) {
      alert(error?.message ?? t('members.could_not_generate'))
      return
    }
    const url = memberInviteUrl(window.location.origin, member.id, data as string)
    setInviteLink({
      memberId: member.id,
      memberName: displayName(member, t('dash')),
      url,
      phone: member.phone ?? null,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('members.page_title')}</h1>
          <p className="text-sm text-gray-600 mt-1">
            {t('members.page_subtitle')}
          </p>
        </div>
        {editor ? (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn-primary text-sm py-2 px-4"
          >
            {showForm ? t('cancel') : t('members.add_member')}
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
          placeholder={t('members.search_placeholder')}
          className="form-input"
        />
        {wards.length > 1 ? (
          <select
            value={wardFilter}
            onChange={(e) => setWardFilter(e.target.value)}
            disabled={wardsLoading}
            className="form-input"
          >
            <option value="">{t('all_wards', { count: wards.length })}</option>
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
              ? t('members.summary_in_ward_prefix', {
                  name: wards.find((w) => w.id === wardFilter)?.name ?? t('members.summary_selected_ward'),
                })
              : ''
            const total = totalCount ?? members.length
            if (debouncedQuery) {
              const base = showAll ? t('members.summary_base_in_roster') : t('members.summary_base_registered')
              return t('members.summary_match', {
                count: members.length,
                matches: members.length.toLocaleString(),
                q: debouncedQuery,
                wardLabel,
                total: total.toLocaleString(),
                base,
              })
            }
            if (showAll) {
              if (totalCount !== null && members.length < totalCount) {
                return t('members.summary_show_all_partial', {
                  shown: members.length.toLocaleString(),
                  total: totalCount.toLocaleString(),
                  wardLabel,
                })
              }
              return t('members.summary_in_roster', { count: members.length, wardLabel })
            }
            return t('members.summary_registered', { count: members.length, wardLabel })
          })()}
        </p>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          {t('members.show_all_label')}
        </label>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-500">{t('members.loading')}</div>
        ) : error ? (
          <div className="p-6 text-sm text-error">{error}</div>
        ) : members.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            {t('members.empty_top')}
          </div>
        ) : visibleMembers.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            {t('members.no_match_filters')} {searchQuery ? (
              <button
                onClick={() => setSearchQuery('')}
                className="text-knit-primary hover:underline"
              >
                {t('members.clear_search')}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px] md:min-w-0">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">{t('members.col_name')}</th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">{t('members.col_phone')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('members.col_language')}</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('members.col_available')}</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">{t('members.col_ward')}</th>
                <th className="px-4 py-3 font-medium">{t('members.col_status')}</th>
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
                      {displayName(m, t('dash'))}
                    </button>
                    <DemoBadge when={m.is_demo} />
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{m.phone ?? t('dash')}</td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                    {m.locale === 'es' ? t('spanish') : t('english')}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                    {m.availability && m.availability.length > 0
                      ? slotsToString(
                          m.availability.map((r) => ({
                            day: r.day_of_week as DayOfWeek,
                            timeSlot: r.time_slot as TimeSlot,
                          })),
                        )
                      : t('dash')}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{m.ward?.name ?? t('dash')}</td>
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
                            ? t('members.generating')
                            : m.token_issued_at
                              ? t('members.new_link')
                              : t('members.invite_link')}
                        </button>
                        <button
                          onClick={() => void remove(m.id)}
                          className="text-sm text-error hover:opacity-80"
                        >
                          {t('members.remove_action')}
                        </button>
                      </>
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
        {t('members.search_across_stake')}{' '}
        <Link to="/admin/invitations" className="text-knit-primary hover:underline">
          {t('members.open_invitations')}
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
  const { t } = useTranslation('common')
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
        setOutcome({ kind: 'err', text: body?.error ?? t('invite_modal.send_failed', { status: res.status }) })
      } else {
        setOutcome({
          kind: 'ok',
          text: t('invite_modal.texted_at', { name: memberName, recipient: body.recipient ?? phone }),
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
            {t('invite_modal.title', { name: memberName })}
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            {t('invite_modal.intro', { first: memberName.split(' ')[0] })}
          </p>
        </div>

        <button
          onClick={() => void send()}
          disabled={!phone || sending}
          className="w-full rounded-md border-[1.5px] border-knit-primary text-knit-primary px-3 py-2 text-sm font-medium hover:bg-knit-primary/5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? t('invite_modal.sending_text') : phone ? t('invite_modal.send_text') : t('invite_modal.send_text_no_phone')}
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
            {t('invite_modal.or_copy')}
          </summary>
          <div className="mt-2 space-y-2">
            <div className="rounded-md border-[1.5px] border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 break-all font-mono">
              {url}
            </div>
            <button
              onClick={() => void copy()}
              className="rounded-md border-[1.5px] border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-1.5 text-xs font-medium"
            >
              {copied ? t('invite_modal.copied') : t('invite_modal.copy_link')}
            </button>
          </div>
        </details>

        <div className="flex items-center justify-end pt-1">
          <button
            onClick={onClose}
            className="rounded-md border-[1.5px] border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}

function displayName(m: MemberRow, dash: string): string {
  if (m.preferred_name) return m.preferred_name
  const full = [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
  return full || dash
}

function StatusBadge({ member }: { member: MemberWithExtras }) {
  const { t } = useTranslation('common')
  if (member.opted_out_at) return <Badge tone="rose">{t('members.status_opted_out')}</Badge>
  if (member.paused_until && new Date(member.paused_until) > new Date()) {
    return <Badge tone="amber">{t('members.status_paused')}</Badge>
  }
  const hasAvailability = (member.availability?.length ?? 0) > 0
  if (member.onboarding_completed_at && hasAvailability) {
    return <Badge tone="emerald">{t('members.status_active')}</Badge>
  }
  if (member.onboarding_completed_at) {
    return <Badge tone="amber">{t('members.status_no_availability')}</Badge>
  }
  return <Badge tone="slate">{t('members.status_not_onboarded')}</Badge>
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
  const { t } = useTranslation('common')
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
      setErr(t('members.pick_ward_first'))
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
      setErr(error?.message ?? t('members.failed_save_member'))
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
        setErr(`${t('members.failed_save_member')} ${availErr.message}`)
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
      <Field label={t('members.first_name')} required>
        <input
          type="text"
          required
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="form-input"
        />
      </Field>
      <Field label={t('members.last_name')}>
        <input
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="form-input"
        />
      </Field>
      <Field label={t('members.col_phone')} hint={t('members.phone_hint')}>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t('members.phone_placeholder')}
          className="form-input"
        />
      </Field>
      <Field label={t('members.language')}>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as 'en' | 'es')}
          className="form-input"
        >
          <option value="en">{t('english')}</option>
          <option value="es">{t('spanish')}</option>
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
          <span className="text-sm font-medium text-gray-700">{t('members.availability')}</span>
          <span className="text-xs text-gray-500">{slotsToString(availability, t) || t('members.tap_to_select_times')}</span>
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
          {saving ? t('saving') : t('members.save_member')}
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
 * Detail / edit modal for a member's survey answers.
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
  const { t } = useTranslation('common')
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

  async function load(signal?: { cancelled: boolean }) {
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
    if (signal?.cancelled) return
    if (memberRes.error || !memberRes.data) {
      setError(memberRes.error?.message ?? t('members.detail.member_not_found'))
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

  // Use a cancellation flag so that rapidly switching between different
  // member IDs doesn't let an earlier slow fetch overwrite the current data.
  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => { signal.cancelled = true }
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
          <p className="text-sm text-gray-500">{t('loading')}</p>
        ) : error ? (
          <div className="space-y-3">
            <p className="text-sm text-error">{error}</p>
            <button onClick={onClose} className="btn-primary text-sm py-2 px-4">
              {t('close')}
            </button>
          </div>
        ) : data ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {displayName(data.member, t('dash'))}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {data.ward?.name ?? t('dash')} · {data.member.phone ?? t('members.detail.no_phone')} ·{' '}
                  {data.member.locale === 'es' ? t('spanish') : t('english')}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {data.member.onboarding_completed_at
                    ? t('members.detail.registered_on', { date: new Date(data.member.onboarding_completed_at).toLocaleDateString() })
                    : t('members.detail.not_onboarded')}
                </p>
              </div>
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-900">
                {t('close')}
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
  const { t } = useTranslation('common')
  return (
    <section className="rounded-md border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {!editing ? (
          <button
            onClick={onStartEdit}
            className="text-xs text-gray-700 hover:text-gray-900 underline"
          >
            {t('edit')}
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
  const { t } = useTranslation('common')
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
    <SectionShell title={t('members.detail.section_profile')} editing={editing} onStartEdit={onStartEdit}>
      {editing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-gray-600">{t('members.detail.preferred_name')}</span>
            <input
              type="text"
              value={preferred}
              onChange={(e) => setPreferred(e.target.value)}
              className="form-input"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-gray-600">{t('members.detail.phone')}</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="form-input"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-gray-600">{t('members.detail.language')}</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as 'en' | 'es')}
              className="form-input"
            >
              <option value="en">{t('english')}</option>
              <option value="es">{t('spanish')}</option>
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
              {saving ? t('saving') : t('save')}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border-[1.5px] border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-700 space-y-1">
          <div>
            <span className="text-gray-500">{t('members.detail.preferred_name')}:</span>{' '}
            {member.preferred_name || t('dash')}
          </div>
          <div>
            <span className="text-gray-500">{t('members.detail.phone')}:</span> {member.phone ?? t('dash')}
          </div>
          <div>
            <span className="text-gray-500">{t('members.detail.language')}:</span>{' '}
            {member.locale === 'es' ? t('spanish') : t('english')}
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
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState<Slot[]>(slots)
  useEffect(() => {
    if (editing) setDraft(slots)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  return (
    <SectionShell title={t('members.detail.section_availability')} editing={editing} onStartEdit={onStartEdit}>
      {editing ? (
        <div className="space-y-3">
          <AvailabilityGrid value={draft} onChange={setDraft} />
          <p className="text-xs text-gray-500">{slotsToString(draft, t) || t('members.detail.no_times')}</p>
          <div className="flex gap-2">
            <button
              onClick={() => onSave(draft)}
              disabled={saving}
              className="btn-primary text-sm py-1.5 px-3"
            >
              {saving ? t('saving') : t('save')}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border-[1.5px] border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-700">{slotsToString(slots, t) || t('members.detail.no_times_yet')}</p>
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
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState<string[]>(ids)
  useEffect(() => {
    if (editing) setDraft(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  return (
    <SectionShell title={t('members.detail.section_interests')} editing={editing} onStartEdit={onStartEdit}>
      {editing ? (
        <div className="space-y-3">
          <InterestChipPicker wardId={wardId} value={draft} onChange={setDraft} />
          <div className="flex gap-2">
            <button
              onClick={() => onSave(draft)}
              disabled={saving}
              className="btn-primary text-sm py-1.5 px-3"
            >
              {saving ? t('saving') : t('save')}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border-[1.5px] border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : ids.length === 0 ? (
        <p className="text-sm text-gray-500">{t('members.detail.no_interests')}</p>
      ) : (
        <p className="text-sm text-gray-700">{t('members.detail.n_picked', { count: ids.length })}</p>
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
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState<string[]>(keys)
  useEffect(() => {
    if (editing) setDraft(keys)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  return (
    <SectionShell title={t('members.detail.section_styles')} editing={editing} onStartEdit={onStartEdit}>
      {editing ? (
        <div className="space-y-3">
          <StylePicker value={draft} onChange={setDraft} />
          <div className="flex gap-2">
            <button
              onClick={() => onSave(draft)}
              disabled={saving}
              className="btn-primary text-sm py-1.5 px-3"
            >
              {saving ? t('saving') : t('save')}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border-[1.5px] border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : keys.length === 0 ? (
        <p className="text-sm text-gray-500">{t('members.detail.no_styles')}</p>
      ) : (
        <p className="text-sm text-gray-700">{t('members.detail.n_picked', { count: keys.length })}</p>
      )}
    </SectionShell>
  )
}

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { clearMemberAuth, readMemberAuth, type MemberAuth } from '@/lib/memberAuth'
import AvailabilityGrid from '@/components/AvailabilityGrid'
import InterestChipPicker from '@/components/InterestChipPicker'
import StylePicker from '@/components/StylePicker'
import MemberOnboarding from '@/pages/MemberOnboarding'
import KnitMark from '@/components/KnitMark'
import { slotsToString, type DayOfWeek, type Slot, type TimeSlot } from '@/lib/availability'
import type { Database } from '@/lib/database.types'

type MemberRow = Database['public']['Tables']['knit_members']['Row']
type WardRow = Database['public']['Tables']['knit_wards']['Row']
type InterestTagRow = Database['public']['Tables']['knit_interest_tags']['Row']
type ParticipationStyleRow = Database['public']['Tables']['knit_participation_styles']['Row']

type SelfPayload = {
  member: MemberRow
  ward: WardRow | null
  availability: { day_of_week: number; time_slot: string }[]
  interests: InterestTagRow[]
  styles: ParticipationStyleRow[]
}

type State =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: SelfPayload; auth: MemberAuth }

export default function MemberDashboard() {
  const navigate = useNavigate()
  const { t } = useTranslation('common')
  const [state, setState] = useState<State>({ kind: 'loading' })

  async function load() {
    const auth = readMemberAuth()
    if (!auth) {
      setState({ kind: 'unauthenticated' })
      return
    }
    const { data, error } = await supabase.rpc('knit_member_self_read', {
      p_member_id: auth.memberId,
      p_token: auth.token,
    })
    if (error || !data) {
      setState({
        kind: 'error',
        message: error?.message ?? t('member_dash.couldnt_load'),
      })
      return
    }
    setState({ kind: 'ready', data: data as unknown as SelfPayload, auth })
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function signOut() {
    clearMemberAuth()
    navigate('/', { replace: true })
  }

  if (state.kind === 'loading') return <Shell>{t('loading')}</Shell>

  if (state.kind === 'unauthenticated') {
    return (
      <Shell>
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold text-gray-900">{t('member_dash.not_signed_in')}</h1>
          <p className="text-gray-600">
            {t('member_dash.not_signed_in_body')}
          </p>
          <Link to="/" className="inline-block text-gray-700 underline">
            {t('go_home')}
          </Link>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold text-gray-900">{t('member_dash.couldnt_load')}</h1>
          <p className="text-error">{state.message}</p>
          <p className="text-sm text-gray-500">
            {t('member_dash.link_expired_body')}
          </p>
          <button
            onClick={signOut}
            className="rounded-md border-[1.5px] border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            {t('sign_out')}
          </button>
        </div>
      </Shell>
    )
  }

  const { data, auth } = state
  const firstName = firstNameOf(data.member)

  // Branch: onboarding not yet complete → show wizard
  if (!data.member.onboarding_completed_at) {
    return (
      <MemberOnboarding
        auth={auth}
        firstName={firstName}
        wardId={data.member.ward_id}
        onDone={load}
      />
    )
  }

  return <Dashboard data={data} auth={auth} onRefresh={load} onSignOut={signOut} />
}

function Dashboard({
  data,
  auth,
  onRefresh,
  onSignOut,
}: {
  data: SelfPayload
  auth: MemberAuth
  onRefresh: () => Promise<void>
  onSignOut: () => void
}) {
  const { t } = useTranslation('common')
  const { member, ward, availability, interests, styles } = data
  const firstName = firstNameOf(member)
  const isPausedNow =
    member.paused_until && new Date(member.paused_until) > new Date()

  const [pausing, setPausing] = useState(false)
  const [optingOut, setOptingOut] = useState(false)
  const [editing, setEditing] = useState<'availability' | 'interests' | 'styles' | null>(null)
  const isOptedOut = !!member.opted_out_at

  async function pauseForDays(days: number | null) {
    setPausing(true)
    const until =
      days === null
        ? null
        : new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const { error } = await supabase.rpc('knit_member_self_pause', {
      p_member_id: auth.memberId,
      p_token: auth.token,
      p_until: until as string,
    })
    setPausing(false)
    if (error) {
      alert(error.message)
      return
    }
    await onRefresh()
  }

  async function setOptOut(optOut: boolean) {
    if (optOut) {
      const confirmed = confirm(t('member_dash.opt_out_confirm'))
      if (!confirmed) return
    }
    setOptingOut(true)
    const { error } = await supabase.rpc('knit_member_self_opt_out', {
      p_member_id: auth.memberId,
      p_token: auth.token,
      p_opt_out: optOut,
    })
    setOptingOut(false)
    if (error) {
      alert(error.message)
      return
    }
    await onRefresh()
  }

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <KnitMark size={28} />
            <span className="text-lg font-semibold text-gray-900 tracking-tight">{t('app_name')}</span>
          </div>
          <button
            onClick={onSignOut}
            className="inline-flex items-center justify-center min-h-11 px-3 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 active:bg-gray-100"
          >
            {t('sign_out')}
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">
            {firstName ? t('member_dash.hi_name', { name: firstName }) : t('member_dash.hi_friend')}
          </h1>
          <p className="text-gray-600 mt-1">
            {ward?.name ? t('member_dash.your_ward_named', { name: ward.name }) : t('member_dash.your_ward')}
          </p>
        </div>

        {isOptedOut ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-gray-900 text-sm space-y-3">
            <div>
              <p className="font-medium text-rose-900">{t('member_dash.opted_out_title')}</p>
              <p className="text-gray-700 mt-1">
                {t('member_dash.opted_out_body')}
              </p>
            </div>
            <button
              onClick={() => void setOptOut(false)}
              disabled={optingOut}
              className="rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-3 py-1.5 disabled:opacity-50"
            >
              {optingOut ? t('member_dash.rejoining') : t('member_dash.rejoin')}
            </button>
          </div>
        ) : isPausedNow ? (
          <div className="rounded-md border border-warning/30 bg-warning/5 p-4 text-gray-900 text-sm">
            <Trans
              i18nKey="member_dash.paused_until"
              ns="common"
              values={{ date: member.paused_until ?? '' }}
              components={{ strong: <strong /> }}
            />
            <button
              onClick={() => void pauseForDays(null)}
              className="underline font-medium"
              disabled={pausing}
            >
              {t('member_dash.unpause')}
            </button>
          </div>
        ) : null}

        <EditableAvailability
          auth={auth}
          availability={availability}
          editing={editing === 'availability'}
          onStartEdit={() => setEditing('availability')}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await onRefresh()
          }}
        />

        <EditableInterests
          auth={auth}
          interests={interests}
          wardId={member.ward_id}
          editing={editing === 'interests'}
          onStartEdit={() => setEditing('interests')}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await onRefresh()
          }}
        />

        <EditableStyles
          auth={auth}
          styles={styles}
          editing={editing === 'styles'}
          onStartEdit={() => setEditing('styles')}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await onRefresh()
          }}
        />

        {!isOptedOut && (
          <Section title={t('member_dash.break_title')}>
            <p className="text-gray-600 text-sm">
              {t('member_dash.break_body')}
            </p>
            <div className="flex flex-wrap gap-2 pt-3">
              <button
                onClick={() => void pauseForDays(30)}
                disabled={pausing}
                className="k-btn k-btn-outline"
              >
                {t('member_dash.pause_30')}
              </button>
              <button
                onClick={() => void pauseForDays(90)}
                disabled={pausing}
                className="k-btn k-btn-outline"
              >
                {t('member_dash.pause_90')}
              </button>
            </div>

            <div className="border-t border-gray-100 mt-4 pt-4">
              <p className="text-gray-600 text-sm">
                {t('member_dash.or_optout_intro')}
              </p>
              <button
                onClick={() => void setOptOut(true)}
                disabled={optingOut}
                className="mt-2 text-sm font-medium text-rose-700 hover:text-rose-800 underline disabled:opacity-50"
              >
                {optingOut ? t('member_dash.opting_out') : t('member_dash.opt_out')}
              </button>
            </div>
          </Section>
        )}
      </main>
    </div>
  )
}

function EditableAvailability({
  auth,
  availability,
  editing,
  onStartEdit,
  onCancel,
  onSaved,
}: {
  auth: MemberAuth
  availability: { day_of_week: number; time_slot: string }[]
  editing: boolean
  onStartEdit: () => void
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const current: Slot[] = availability.map((a) => ({
    day: a.day_of_week as DayOfWeek,
    timeSlot: a.time_slot as TimeSlot,
  }))
  const [draft, setDraft] = useState<Slot[]>(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editing) setDraft(current)
    // only want to refresh draft when entering edit mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  async function save() {
    setSaving(true)
    setError(null)
    const { error } = await supabase.rpc('knit_member_self_save_availability', {
      p_member_id: auth.memberId,
      p_token: auth.token,
      p_slots: draft.map((s) => ({ day_of_week: s.day, time_slot: s.timeSlot })),
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    await onSaved()
  }

  return (
    <Section
      title={t('member_dash.section_availability')}
      action={editing ? null : <EditChip onClick={onStartEdit} />}
    >
      {editing ? (
        <div className="space-y-3">
          <AvailabilityGrid value={draft} onChange={setDraft} />
          {draft.length > 0 ? (
            <p className="text-sm text-gray-600">{slotsToString(draft)}</p>
          ) : null}
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <div className="flex gap-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="k-btn flex-1"
            >
              {saving ? t('saving') : t('save')}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="k-btn k-btn-outline"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-gray-700">
          {slotsToString(current) || t('member_dash.no_times_yet')}
        </p>
      )}
    </Section>
  )
}

function EditableInterests({
  auth,
  interests,
  wardId,
  editing,
  onStartEdit,
  onCancel,
  onSaved,
}: {
  auth: MemberAuth
  interests: InterestTagRow[]
  wardId: string | null
  editing: boolean
  onStartEdit: () => void
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState<string[]>(interests.map((i) => i.id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editing) setDraft(interests.map((i) => i.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  async function save() {
    setSaving(true)
    setError(null)
    const { error } = await supabase.rpc('knit_member_self_save_interests', {
      p_member_id: auth.memberId,
      p_token: auth.token,
      p_tag_ids: draft,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    await onSaved()
  }

  return (
    <Section
      title={t('member_dash.section_interests')}
      action={editing ? null : <EditChip onClick={onStartEdit} />}
    >
      {editing ? (
        <div className="space-y-3">
          <InterestChipPicker wardId={wardId} value={draft} onChange={setDraft} />
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <div className="flex gap-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="k-btn flex-1"
            >
              {saving ? t('saving') : t('save')}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="k-btn k-btn-outline"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : interests.length === 0 ? (
        <p className="text-gray-500 text-sm">{t('member_dash.no_interests_yet')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {interests.map((it) => (
            <span
              key={it.id}
              className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
            >
              {it.name_en}
            </span>
          ))}
        </div>
      )}
    </Section>
  )
}

function EditableStyles({
  auth,
  styles,
  editing,
  onStartEdit,
  onCancel,
  onSaved,
}: {
  auth: MemberAuth
  styles: ParticipationStyleRow[]
  editing: boolean
  onStartEdit: () => void
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState<string[]>(styles.map((s) => s.key))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editing) setDraft(styles.map((s) => s.key))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  async function save() {
    setSaving(true)
    setError(null)
    const { error } = await supabase.rpc('knit_member_self_save_styles', {
      p_member_id: auth.memberId,
      p_token: auth.token,
      p_style_keys: draft,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    await onSaved()
  }

  return (
    <Section
      title={t('member_dash.section_styles')}
      action={editing ? null : <EditChip onClick={onStartEdit} />}
    >
      {editing ? (
        <div className="space-y-3">
          <StylePicker value={draft} onChange={setDraft} />
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <div className="flex gap-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="k-btn flex-1"
            >
              {saving ? t('saving') : t('save')}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="k-btn k-btn-outline"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : styles.length === 0 ? (
        <p className="text-gray-500 text-sm">{t('member_dash.not_set_yet')}</p>
      ) : (
        <ul className="space-y-1 text-gray-700">
          {styles.map((s) => (
            <li key={s.key}>• {s.label_en}</li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function firstNameOf(m: MemberRow): string {
  if (m.first_name) return m.first_name
  if (m.preferred_name) return m.preferred_name.split(/\s+/)[0] ?? ''
  return ''
}

function EditChip({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('common')
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center min-h-11 px-4 rounded-full bg-knit-primary-fade text-knit-primary text-sm font-bold active:opacity-80"
    >
      {t('edit')}
    </button>
  )
}

function Section({
  title,
  children,
  action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-gray-200 bg-white p-5 space-y-2">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-medium text-gray-900">{title}</h2>
        {action}
      </div>
      <div>{children}</div>
    </section>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-gray-600">
      {children}
    </main>
  )
}

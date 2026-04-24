import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { clearMemberAuth, readMemberAuth, type MemberAuth } from '@/lib/memberAuth'
import AvailabilityGrid from '@/components/AvailabilityGrid'
import InterestChipPicker from '@/components/InterestChipPicker'
import StylePicker from '@/components/StylePicker'
import MemberOnboarding from '@/pages/MemberOnboarding'
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
        message: error?.message ?? 'Could not load your info.',
      })
      return
    }
    setState({ kind: 'ready', data: data as unknown as SelfPayload, auth })
  }

  useEffect(() => {
    void load()
  }, [])

  function signOut() {
    clearMemberAuth()
    navigate('/', { replace: true })
  }

  if (state.kind === 'loading') return <Shell>Loading…</Shell>

  if (state.kind === 'unauthenticated') {
    return (
      <Shell>
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold text-slate-900">Not signed in</h1>
          <p className="text-slate-600">
            Use the personal link your ward mission leader sent you by text to get in.
          </p>
          <Link to="/" className="inline-block text-slate-700 underline">
            Go home
          </Link>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold text-slate-900">Couldn't load</h1>
          <p className="text-rose-700">{state.message}</p>
          <p className="text-sm text-slate-500">
            Your link may have expired. Ask for a fresh one.
          </p>
          <button
            onClick={signOut}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Sign out
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
  const { member, ward, availability, interests, styles } = data
  const firstName = firstNameOf(member)
  const isPausedNow =
    member.paused_until && new Date(member.paused_until) > new Date()

  const [pausing, setPausing] = useState(false)
  const [editing, setEditing] = useState<'availability' | 'interests' | 'styles' | null>(null)

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <span className="text-xl font-semibold text-slate-900 tracking-tight">Knit</span>
          <button onClick={onSignOut} className="text-sm text-slate-600 hover:text-slate-900">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">
            Hi {firstName || 'friend'}
          </h1>
          <p className="text-slate-600 mt-1">
            {ward?.name ? `Your ward: ${ward.name}` : 'Your ward'}
          </p>
        </div>

        {isPausedNow ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 text-sm">
            You're paused until <strong>{member.paused_until}</strong>.{' '}
            <button
              onClick={() => void pauseForDays(null)}
              className="underline font-medium"
              disabled={pausing}
            >
              Unpause
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

        <Section title="Need a break?">
          <p className="text-slate-600 text-sm">
            Pause and we won't send the weekly check-in for a while.
          </p>
          <div className="flex flex-wrap gap-2 pt-3">
            <button
              onClick={() => void pauseForDays(30)}
              disabled={pausing}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
            >
              Pause 30 days
            </button>
            <button
              onClick={() => void pauseForDays(90)}
              disabled={pausing}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
            >
              Pause 90 days
            </button>
          </div>
        </Section>
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
      title="Your availability"
      action={
        editing ? null : (
          <button onClick={onStartEdit} className="text-sm text-slate-700 underline">
            Edit
          </button>
        )
      }
    >
      {editing ? (
        <div className="space-y-3">
          <AvailabilityGrid value={draft} onChange={setDraft} />
          {draft.length > 0 ? (
            <p className="text-sm text-slate-600">{slotsToString(draft)}</p>
          ) : null}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <div className="flex gap-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-slate-700">
          {slotsToString(current) || 'No times set yet.'}
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
      title="What you love"
      action={
        editing ? null : (
          <button onClick={onStartEdit} className="text-sm text-slate-700 underline">
            Edit
          </button>
        )
      }
    >
      {editing ? (
        <div className="space-y-3">
          <InterestChipPicker wardId={wardId} value={draft} onChange={setDraft} />
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <div className="flex gap-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : interests.length === 0 ? (
        <p className="text-slate-500 text-sm">No interests yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {interests.map((it) => (
            <span
              key={it.id}
              className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
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
      title="How you like to help"
      action={
        editing ? null : (
          <button onClick={onStartEdit} className="text-sm text-slate-700 underline">
            Edit
          </button>
        )
      }
    >
      {editing ? (
        <div className="space-y-3">
          <StylePicker value={draft} onChange={setDraft} />
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <div className="flex gap-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : styles.length === 0 ? (
        <p className="text-slate-500 text-sm">Not set yet.</p>
      ) : (
        <ul className="space-y-1 text-slate-700">
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
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-medium text-slate-900">{title}</h2>
        {action}
      </div>
      <div>{children}</div>
    </section>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-600">
      {children}
    </main>
  )
}

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { clearMemberAuth, readMemberAuth } from '@/lib/memberAuth'
import { slotsToString, type DayOfWeek, type TimeSlot } from '@/lib/availability'
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
  | { kind: 'ready'; data: SelfPayload }

export default function MemberDashboard() {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [pausing, setPausing] = useState(false)

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
    setState({ kind: 'ready', data: data as unknown as SelfPayload })
  }

  useEffect(() => {
    void load()
  }, [])

  async function pauseForDays(days: number | null) {
    const auth = readMemberAuth()
    if (!auth) return
    setPausing(true)
    const until =
      days === null
        ? null
        : new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const { error } = await supabase.rpc('knit_member_self_pause', {
      p_member_id: auth.memberId,
      p_token: auth.token,
      // The RPC accepts null to unpause, but the generated type marks it string.
      p_until: until as string,
    })
    setPausing(false)
    if (error) {
      alert(error.message)
      return
    }
    await load()
  }

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

  const { member, ward, availability, interests, styles } = state.data
  const fullName = displayName(member)
  const isPausedNow = member.paused_until && new Date(member.paused_until) > new Date()
  const availabilityText = slotsToString(
    availability.map((r) => ({
      day: r.day_of_week as DayOfWeek,
      timeSlot: r.time_slot as TimeSlot,
    })),
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <span className="text-xl font-semibold text-slate-900 tracking-tight">Knit</span>
          <button
            onClick={signOut}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">
            Hi {firstName(fullName) || 'friend'}
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

        <Section title="Your availability">
          <p className="text-slate-700">{availabilityText || 'No times set yet.'}</p>
          <p className="text-xs text-slate-500 mt-2">
            Editing your availability comes in the next update.
          </p>
        </Section>

        <Section title="What you love">
          {interests.length === 0 ? (
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

        <Section title="How you like to help">
          {styles.length === 0 ? (
            <p className="text-slate-500 text-sm">Not set yet.</p>
          ) : (
            <ul className="space-y-1 text-slate-700">
              {styles.map((s) => (
                <li key={s.key}>• {s.label_en}</li>
              ))}
            </ul>
          )}
        </Section>

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

        <p className="text-xs text-slate-400 pt-4">
          Editing your interests and availability arrives in the onboarding flow
          (next update).
        </p>
      </main>
    </div>
  )
}

function displayName(m: MemberRow): string {
  if (m.preferred_name) return m.preferred_name
  return [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
}

function firstName(full: string): string {
  return full.split(/\s+/)[0] ?? ''
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
      <h2 className="font-medium text-slate-900">{title}</h2>
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

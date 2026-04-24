import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import { DAYS_OF_WEEK, TIME_SLOTS, type DayOfWeek, type TimeSlot } from '@/lib/availability'
import {
  displayName,
  suggest,
  type Suggestion,
  type SuggestionCandidate,
  type SuggestionResult,
} from '@/lib/suggestion'
import type { Database } from '@/lib/database.types'

type FriendRow = Database['public']['Tables']['knit_friends']['Row']
type StyleRow = Database['public']['Tables']['knit_participation_styles']['Row']
type InterestTagRow = Database['public']['Tables']['knit_interest_tags']['Row']
type Ctx = { profile: AdminProfile }

export default function AdminSuggest() {
  const { profile } = useOutletContext<Ctx>()
  const { wards, loading: wardsLoading } = useWardOptions(profile)

  const [wardId, setWardId] = useState<string>(
    profile.role === 'ward_mission_leader' ? profile.ward_id ?? '' : '',
  )
  useEffect(() => {
    if (!wardId && wards.length === 1) setWardId(wards[0].id)
  }, [wards, wardId])

  const [friends, setFriends] = useState<FriendRow[]>([])
  const [styles, setStyles] = useState<StyleRow[]>([])
  const [loadingFriends, setLoadingFriends] = useState(false)

  const [friendId, setFriendId] = useState('')
  const [dayOfWeek, setDayOfWeek] = useState<DayOfWeek>(2)
  const [timeSlot, setTimeSlot] = useState<TimeSlot>('evening')
  const [need, setNeed] = useState<string>('')

  const [result, setResult] = useState<SuggestionResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load friends for the ward and styles for label resolution
  useEffect(() => {
    if (!wardId) {
      setFriends([])
      return
    }
    setLoadingFriends(true)
    ;(async () => {
      const [friendsRes, stylesRes] = await Promise.all([
        supabase
          .from('knit_friends')
          .select('*')
          .eq('ward_id', wardId)
          .neq('teaching_status', 'baptized')
          .neq('teaching_status', 'lost_contact')
          .order('first_name'),
        supabase.from('knit_participation_styles').select('*').order('sort_order'),
      ])
      setFriends((friendsRes.data as FriendRow[] | null) ?? [])
      setStyles((stylesRes.data as StyleRow[] | null) ?? [])
      setLoadingFriends(false)
    })()
  }, [wardId])

  const styleLabelByKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of styles) m.set(s.key, s.label_en)
    return m
  }, [styles])

  async function run(e: FormEvent) {
    e.preventDefault()
    if (!wardId || !friendId) {
      setError('Pick a friend first.')
      return
    }
    setRunning(true)
    setError(null)
    setResult(null)

    const friend = friends.find((f) => f.id === friendId)
    if (!friend) {
      setRunning(false)
      setError('Friend not found.')
      return
    }

    // Load candidates (members + their related availability/interests/styles)
    const { data: members, error: membersErr } = await supabase
      .from('knit_members')
      .select(
        `
          id, first_name, last_name, preferred_name, locale,
          paused_until, opted_out_at,
          availability:knit_availability_baselines(day_of_week, time_slot),
          interests:knit_member_interests(interest_tag_id),
          styles:knit_member_participation_styles(style_key)
        `,
      )
      .eq('ward_id', wardId)

    if (membersErr) {
      setRunning(false)
      setError(membersErr.message)
      return
    }

    // Recent outings (90 days)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
    const { data: outings, error: outingsErr } = await supabase
      .from('knit_outings')
      .select('id, member_id, friend_id, status, scheduled_at')
      .eq('ward_id', wardId)
      .gte('scheduled_at', ninetyDaysAgo)

    if (outingsErr) {
      setRunning(false)
      setError(outingsErr.message)
      return
    }

    // Interest tag names — for reasons
    const friendTagIds = friend.interest_tag_ids ?? []
    const allMemberTagIds = (members ?? []).flatMap((m: { interests: { interest_tag_id: string }[] }) =>
      m.interests.map((i) => i.interest_tag_id),
    )
    const wantedTagIds = Array.from(new Set([...friendTagIds, ...allMemberTagIds]))
    const interestNameById = new Map<string, string>()
    if (wantedTagIds.length > 0) {
      const { data: tags } = await supabase
        .from('knit_interest_tags')
        .select('id, name_en')
        .in('id', wantedTagIds)
      for (const t of (tags as InterestTagRow[] | null) ?? []) {
        interestNameById.set(t.id, t.name_en)
      }
    }

    const suggestion = suggest({
      friend: {
        id: friend.id,
        first_name: friend.first_name,
        locale: friend.locale,
        interest_tag_ids: friend.interest_tag_ids,
      },
      dayOfWeek,
      timeSlot,
      need: need || null,
      candidates: (members ?? []) as unknown as SuggestionCandidate[],
      recentOutings: outings ?? [],
      interestNameById,
      styleLabelByKey,
    })

    setResult(suggestion)
    setRunning(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Suggest members</h1>
        <p className="text-sm text-slate-600 mt-1">
          Pick a friend and a time; we'll rank the best 5 ward members for the outing.
        </p>
      </div>

      <form
        onSubmit={run}
        className="rounded-xl border border-slate-200 bg-white p-5 grid gap-4 sm:grid-cols-2"
      >
        {wards.length > 1 ? (
          <Field label="Ward" required>
            <select
              value={wardId}
              onChange={(e) => {
                setWardId(e.target.value)
                setFriendId('')
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
            disabled={loadingFriends}
            required
          >
            <option value="">
              {loadingFriends
                ? 'Loading…'
                : friends.length === 0
                  ? 'No active friends in this ward'
                  : 'Pick a friend'}
            </option>
            {friends.map((f) => (
              <option key={f.id} value={f.id}>
                {[f.first_name, f.last_name].filter(Boolean).join(' ')}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Day" required>
          <select
            value={dayOfWeek}
            onChange={(e) => setDayOfWeek(Number(e.target.value) as DayOfWeek)}
            className="form-input"
          >
            {DAYS_OF_WEEK.map((d) => (
              <option key={d.value} value={d.value}>
                {d.long}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Time of day" required>
          <select
            value={timeSlot}
            onChange={(e) => setTimeSlot(e.target.value as TimeSlot)}
            className="form-input"
          >
            {TIME_SLOTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Need (optional)" hint="Filter to members willing to do this specifically">
          <select
            value={need}
            onChange={(e) => setNeed(e.target.value)}
            className="form-input"
          >
            <option value="">Any</option>
            {styles.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label_en}
              </option>
            ))}
          </select>
        </Field>

        <div className="sm:col-span-2 flex items-center justify-between pt-2">
          {error ? <p className="text-sm text-rose-700">{error}</p> : <span />}
          <button
            type="submit"
            disabled={running || !friendId}
            className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            {running ? 'Thinking…' : 'Suggest members'}
          </button>
        </div>
      </form>

      {result ? <Results result={result} /> : null}
    </div>
  )
}

function Results({ result }: { result: SuggestionResult }) {
  if (result.top.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-2">
        <h2 className="font-medium text-amber-900">No matches</h2>
        {result.hint ? <p className="text-sm text-amber-900">{result.hint}</p> : null}
        {result.filtered.length > 0 ? (
          <details className="text-sm text-amber-800">
            <summary className="cursor-pointer">Why was everyone filtered?</summary>
            <ul className="mt-2 space-y-1">
              {result.filtered.map(({ candidate, reason }) => (
                <li key={candidate.id}>
                  <strong>{displayName(candidate)}</strong> — {reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {result.hint ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {result.hint}
        </div>
      ) : null}
      <ol className="space-y-3">
        {result.top.map((s, idx) => (
          <li key={s.candidate.id}>
            <Card suggestion={s} rank={idx + 1} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function Card({ suggestion, rank }: { suggestion: Suggestion; rank: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 flex gap-4">
      <div className="flex-none flex items-start">
        <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-slate-900 text-white text-sm font-semibold">
          {rank}
        </span>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="font-medium text-slate-900 truncate">
            {displayName(suggestion.candidate)}
          </h3>
          <span className="text-xs text-slate-500 whitespace-nowrap">
            score {suggestion.score.toFixed(1)}
          </span>
        </div>
        <ul className="space-y-1 text-sm text-slate-700">
          {suggestion.reasons.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
      </div>
    </div>
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

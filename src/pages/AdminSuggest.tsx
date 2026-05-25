import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import { isWardScoped } from '@/lib/roles'
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

type RecentRequest = {
  id: string
  suggested_at: string
  time_slot_requested: TimeSlot
  suggested_member_ids: string[]
  suggestion_reasons: Record<string, string[]> | null
  friend: { id: string; first_name: string; last_name: string | null; ward_id: string } | null
  // Materialized from suggested_member_ids → knit_members on load.
  member_names: string[]
}

export default function AdminSuggest() {
  const { profile } = useOutletContext<Ctx>()
  const { wards, loading: wardsLoading } = useWardOptions(profile)

  const [wardId, setWardId] = useState<string>(
    isWardScoped(profile.role) && !profile.is_super_admin ? profile.ward_id ?? '' : '',
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

  // Recent sheet-initiated suggestion requests (missionaries filling the
  // Suggestions tab → Knit runs the algorithm → row lands in
  // knit_outing_suggestions). Mirrors the table on /admin/sheet but lives
  // here so missionary work doesn't get lost.
  const [recent, setRecent] = useState<RecentRequest[]>([])
  const [recentLoading, setRecentLoading] = useState(false)

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

  // Recent missionary requests (sheet-initiated). Scoped to the picked
  // ward when a ward is selected; otherwise stake-wide via RLS (a stake
  // admin sees every ward in their scope).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setRecentLoading(true)
      let q = supabase
        .from('knit_outing_suggestions')
        .select(
          'id, suggested_at, time_slot_requested, suggested_member_ids, suggestion_reasons, friend:knit_friends!inner(id, first_name, last_name, ward_id)',
        )
        .order('suggested_at', { ascending: false })
        .limit(25)
      if (wardId) q = q.eq('friend.ward_id', wardId)
      const { data } = await q
      const rows = (data ?? []) as unknown as Array<{
        id: string
        suggested_at: string
        time_slot_requested: TimeSlot
        suggested_member_ids: string[] | null
        suggestion_reasons: Record<string, string[]> | null
        friend: { id: string; first_name: string; last_name: string | null; ward_id: string } | null | Array<{ id: string; first_name: string; last_name: string | null; ward_id: string }>
      }>

      // Materialize member names so the table can show them inline.
      const allMemberIds = Array.from(
        new Set(rows.flatMap((r) => r.suggested_member_ids ?? [])),
      )
      let nameById = new Map<string, string>()
      if (allMemberIds.length > 0) {
        const { data: memRows } = await supabase
          .from('knit_members')
          .select('id, first_name, last_name, preferred_name')
          .in('id', allMemberIds)
        nameById = new Map(
          (memRows ?? []).map((m) => [
            m.id as string,
            (m.preferred_name as string | null) ||
              [m.first_name, m.last_name].filter(Boolean).join(' ') ||
              '—',
          ]),
        )
      }

      if (cancelled) return
      setRecent(
        rows.map((r) => {
          const friend = Array.isArray(r.friend) ? r.friend[0] ?? null : r.friend
          return {
            id: r.id,
            suggested_at: r.suggested_at,
            time_slot_requested: r.time_slot_requested,
            suggested_member_ids: r.suggested_member_ids ?? [],
            suggestion_reasons: r.suggestion_reasons ?? null,
            friend,
            member_names: (r.suggested_member_ids ?? [])
              .map((id) => nameById.get(id))
              .filter((n): n is string => !!n),
          }
        }),
      )
      setRecentLoading(false)
    })()
    return () => {
      cancelled = true
    }
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
        <h1 className="text-2xl font-semibold text-gray-900">Suggest members</h1>
        <p className="text-sm text-gray-600 mt-1">
          Pick a friend and a time; we'll rank the best 5 ward members for the outing.
        </p>
      </div>

      <form
        onSubmit={run}
        className="rounded-md border border-gray-200 bg-white p-5 grid gap-4 sm:grid-cols-2"
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
          {error ? <p className="text-sm text-error">{error}</p> : <span />}
          <button
            type="submit"
            disabled={running || !friendId}
            className="btn-primary text-sm py-2 px-4"
          >
            {running ? 'Thinking…' : 'Suggest members'}
          </button>
        </div>
      </form>

      {result ? (
        <Results
          result={result}
          onPickSlot={(day, slot) => {
            setDayOfWeek(day)
            setTimeSlot(slot)
          }}
        />
      ) : null}

      <RecentRequestsCard rows={recent} loading={recentLoading} />
    </div>
  )
}

function RecentRequestsCard({
  rows,
  loading,
}: {
  rows: RecentRequest[]
  loading: boolean
}) {
  return (
    <section className="rounded-md border border-gray-200 bg-white overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Recent missionary requests
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            What missionaries asked for on the sheet's Suggestions tab, with the
            top members Knit returned.
          </p>
        </div>
        <span className="text-xs text-gray-500 whitespace-nowrap">
          Last {rows.length}
        </span>
      </header>
      {loading ? (
        <div className="p-6 text-sm text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-sm text-gray-500">
          No requests yet. When a missionary fills the Suggestions tab on the
          sheet, they'll appear here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Friend</th>
                <th className="px-4 py-2 font-medium">Slot</th>
                <th className="px-4 py-2 font-medium">Suggested members</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-gray-700 whitespace-nowrap">
                    {new Date(r.suggested_at).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-2 text-gray-900">
                    {r.friend
                      ? [r.friend.first_name, r.friend.last_name]
                          .filter(Boolean)
                          .join(' ')
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-600 capitalize">
                    {r.time_slot_requested}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {r.member_names.length === 0 ? (
                      <span className="text-gray-400 italic">
                        No matches at the time
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.member_names.slice(0, 5).map((n, i) => (
                          <span
                            key={`${r.id}-${i}`}
                            className="inline-flex items-center rounded-full bg-knit-primary/10 text-knit-primary px-2 py-0.5 text-xs font-medium"
                          >
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Results({
  result,
  onPickSlot,
}: {
  result: SuggestionResult
  onPickSlot: (day: DayOfWeek, slot: TimeSlot) => void
}) {
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
  if (result.top.length === 0) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 sm:p-6 space-y-3">
        <h2 className="font-medium text-amber-900">No matches</h2>
        {result.hint ? <p className="text-sm text-amber-900">{result.hint}</p> : null}
        {result.availableSlots.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-amber-900">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {result.availableSlots.slice(0, 12).map((s) => (
                <button
                  key={`${s.day_of_week}-${s.time_slot}`}
                  onClick={() => onPickSlot(s.day_of_week as DayOfWeek, s.time_slot as TimeSlot)}
                  className="rounded-full border-[1.5px] border-amber-300 bg-white text-amber-900 hover:bg-amber-100 px-3 py-1 text-xs font-medium"
                >
                  {DAY_SHORT[s.day_of_week]} {s.time_slot}
                  <span className="ml-1 text-amber-700/70">· {s.count}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-gray-900">
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
  // Compact row recipe from the desktop mockup (Section 4): each row is
  // a single ~48px-tall line with badge + name + inline reasons + score
  // pill. Rank #1 gets the filled rose badge and the success-green pill;
  // #2+ get the light-rose badge and a neutral gray pill.
  const isTop = rank === 1
  const reasonLine = suggestion.reasons.join(' · ')
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2.5 flex items-center gap-3 min-h-12">
      <span
        className={`flex-none inline-flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold ${
          isTop
            ? 'bg-knit-primary text-white'
            : 'bg-knit-primary-fade text-knit-primary'
        }`}
      >
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">
          {displayName(suggestion.candidate)}
        </div>
        {reasonLine ? (
          <div className="text-xs text-gray-500 truncate">{reasonLine}</div>
        ) : null}
      </div>
      <span
        className={`suite-pill flex-none ${
          isTop ? 'bg-success/10 text-success' : 'bg-gray-100 text-gray-600'
        }`}
        title={`Score ${suggestion.score.toFixed(1)}`}
      >
        {Math.round(suggestion.score)}
      </span>
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
      <span className="text-sm font-medium text-gray-700">
        {label}
        {required ? <span className="text-error"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-gray-500">{hint}</span> : null}
    </label>
  )
}

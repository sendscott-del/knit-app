import { DAYS_OF_WEEK, type DayOfWeek, type TimeSlot } from './availability'
import type { Database } from './database.types'

type MemberRow = Database['public']['Tables']['knit_members']['Row']
type OutingRow = Database['public']['Tables']['knit_outings']['Row']
type FriendRow = Database['public']['Tables']['knit_friends']['Row']

export type SuggestionCandidate = {
  id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  locale: 'en' | 'es'
  paused_until: string | null
  opted_out_at: string | null
  availability: { day_of_week: number; time_slot: string }[]
  interests: { interest_tag_id: string }[]
  styles: { style_key: string }[]
}

export type SuggestionInput = {
  friend: Pick<FriendRow, 'id' | 'first_name' | 'locale' | 'interest_tag_ids'>
  dayOfWeek: DayOfWeek
  timeSlot: TimeSlot
  need: string | null /* participation_style key, nullable */
  candidates: SuggestionCandidate[]
  /** Outings within the last 90 days for the ward (used for freshness + reliability + prior pairing). */
  recentOutings: Pick<OutingRow, 'id' | 'member_id' | 'friend_id' | 'status' | 'scheduled_at'>[]
  /** Map of interest_tag_id → name for reason text. */
  interestNameById: Map<string, string>
  /** Map of style key → human label for reason text. */
  styleLabelByKey: Map<string, string>
}

export type Suggestion = {
  candidate: SuggestionCandidate
  score: number
  reasons: string[]
}

export type SuggestionResult = {
  top: Suggestion[]
  /** Candidates eliminated by hard filters, with the filter that killed them. */
  filtered: { candidate: SuggestionCandidate; reason: string }[]
  hint: string | null
}

const DAY_MS = 24 * 3600 * 1000

export function displayName(
  m: Pick<MemberRow, 'first_name' | 'last_name' | 'preferred_name'>,
): string {
  if (m.preferred_name) return m.preferred_name
  return (
    [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || 'Unnamed member'
  )
}

export function suggest(input: SuggestionInput): SuggestionResult {
  const {
    friend,
    dayOfWeek,
    timeSlot,
    need,
    candidates,
    recentOutings,
    interestNameById,
    styleLabelByKey,
  } = input
  const now = Date.now()
  const top: Suggestion[] = []
  const filtered: { candidate: SuggestionCandidate; reason: string }[] = []

  for (const c of candidates) {
    /* ---- Hard filters ---- */
    if (c.opted_out_at) {
      filtered.push({ candidate: c, reason: 'Opted out' })
      continue
    }
    if (c.paused_until && new Date(c.paused_until).getTime() > now) {
      filtered.push({ candidate: c, reason: `Paused until ${c.paused_until}` })
      continue
    }
    const hasBaseline = c.availability.some(
      (a) => a.day_of_week === dayOfWeek && a.time_slot === timeSlot,
    )
    if (!hasBaseline) {
      filtered.push({ candidate: c, reason: 'Not available that day/slot' })
      continue
    }
    // Language: spec — if friend speaks Spanish, filter to Spanish speakers. Otherwise anyone.
    // Members currently have a single locale; treat en as "default" that matches anyone speaking en.
    // A Spanish-only friend requires a Spanish-locale member.
    const languageMatch = c.locale === friend.locale
    const languageAcceptable = languageMatch || friend.locale === 'en'
    if (!languageAcceptable) {
      filtered.push({ candidate: c, reason: 'Language mismatch' })
      continue
    }
    if (need && !c.styles.some((s) => s.style_key === need)) {
      filtered.push({ candidate: c, reason: `Not willing to ${styleLabelByKey.get(need) ?? need}` })
      continue
    }

    /* ---- Score ---- */
    let score = 0
    const reasons: string[] = []

    reasons.push(`Available ${DAYS_OF_WEEK[dayOfWeek].short} ${timeSlot}`)

    if (languageMatch) {
      score += 5
      if (c.locale === 'es') reasons.push('Speaks Spanish')
    }

    if (need) {
      score += 3
      reasons.push(`Happy to ${styleLabelByKey.get(need) ?? need}`.toLowerCase())
    }

    const memberTagIds = new Set(c.interests.map((i) => i.interest_tag_id))
    const friendTagIds = friend.interest_tag_ids ?? []
    const sharedIds = friendTagIds.filter((t) => memberTagIds.has(t))
    const overlap = Math.min(sharedIds.length, 5)
    if (overlap > 0) {
      score += 2 * overlap
      const names = sharedIds
        .slice(0, 3)
        .map((id) => interestNameById.get(id))
        .filter(Boolean)
        .join(', ')
      reasons.push(
        `Shares ${overlap === 1 ? 'interest' : `${overlap} interests`}${
          names ? `: ${names}` : ''
        }`,
      )
    }

    // Freshness
    const memberOutings = recentOutings.filter((o) => o.member_id === c.id)
    const memberHappened = memberOutings.filter((o) => o.status === 'happened')
    const lastHappened = memberHappened.reduce((max, o) => {
      const t = new Date(o.scheduled_at).getTime()
      return t > max ? t : max
    }, 0)
    const daysSinceLast = lastHappened === 0 ? Infinity : (now - lastHappened) / DAY_MS
    const freshness = Math.min(daysSinceLast / 14, 5)
    score += freshness
    if (daysSinceLast === Infinity) {
      reasons.push('New to fellowshipping')
    } else if (daysSinceLast > 56) {
      reasons.push(`Hasn't been out in ${Math.round(daysSinceLast)} days`)
    }

    // Reliability: start at 3, +1 per happened (cap +3), −2 per flaked that the member bailed on.
    // We don't yet distinguish member no-show vs friend flake — for now just count happened.
    const reliability = 3 + Math.min(memberHappened.length, 3)
    score += reliability
    if (memberHappened.length >= 2) reasons.push('Solid track record')

    // Prior success with this friend
    const priorSuccess = memberOutings.some(
      (o) => o.friend_id === friend.id && o.status === 'happened',
    )
    if (priorSuccess) {
      score += 1
      reasons.push(`Went with ${friend.first_name} before and it went well`)
    }

    // Recent-pairing penalty
    const thirtyDaysAgo = now - 30 * DAY_MS
    const recentlyPaired = memberOutings.some(
      (o) =>
        o.friend_id === friend.id && new Date(o.scheduled_at).getTime() > thirtyDaysAgo,
    )
    if (recentlyPaired) {
      score -= 3
      reasons.push(`Recently out with ${friend.first_name}`)
    }

    top.push({ candidate: c, score, reasons })
  }

  top.sort((a, b) => b.score - a.score)
  const limited = top.slice(0, 5)

  let hint: string | null = null
  if (limited.length === 0) {
    if (friend.locale === 'es') {
      hint =
        'No one in this ward is available at that time with a matching language. Consider asking the WML to recruit Spanish-speaking members, or try a different time slot.'
    } else {
      hint = 'No one is available for that day and time slot. Try a different time.'
    }
  } else if (limited.length < 3) {
    hint = `Only ${limited.length} match${limited.length === 1 ? '' : 'es'}. Widening the time slot or the need may uncover more options.`
  }

  return { top: limited, filtered, hint }
}

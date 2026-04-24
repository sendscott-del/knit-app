/**
 * Server-side suggestion logic. Mirrors src/lib/suggestion.ts but uses plain
 * structural types so we don't need Database typings inside /api/.
 */

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type TimeSlot = 'morning' | 'afternoon' | 'evening'

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export type Candidate = {
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

export type Friend = {
  id: string
  first_name: string
  locale: 'en' | 'es'
  interest_tag_ids: string[] | null
}

export type Outing = {
  id: string
  member_id: string | null
  friend_id: string
  status: string
  scheduled_at: string
}

export type Suggestion = {
  candidate: Candidate
  score: number
  reasons: string[]
}

export type SuggestionResult = {
  top: Suggestion[]
  hint: string | null
}

const DAY_MS = 24 * 3600 * 1000

export function memberDisplayName(c: Candidate): string {
  if (c.preferred_name) return c.preferred_name
  return (
    [c.first_name, c.last_name].filter(Boolean).join(' ').trim() ||
    'Unnamed member'
  )
}

export function suggest(input: {
  friend: Friend
  dayOfWeek: DayOfWeek
  timeSlot: TimeSlot
  need: string | null
  candidates: Candidate[]
  recentOutings: Outing[]
  interestNameById: Map<string, string>
  styleLabelByKey: Map<string, string>
}): SuggestionResult {
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
  const scored: Suggestion[] = []

  for (const c of candidates) {
    if (c.opted_out_at) continue
    if (c.paused_until && new Date(c.paused_until).getTime() > now) continue
    const hasBaseline = c.availability.some(
      (a) => a.day_of_week === dayOfWeek && a.time_slot === timeSlot,
    )
    if (!hasBaseline) continue
    const languageMatch = c.locale === friend.locale
    const languageAcceptable = languageMatch || friend.locale === 'en'
    if (!languageAcceptable) continue
    if (need && !c.styles.some((s) => s.style_key === need)) continue

    let score = 0
    const reasons: string[] = []

    reasons.push(`Available ${DAY_SHORT[dayOfWeek]} ${timeSlot}`)
    if (languageMatch) {
      score += 5
      if (c.locale === 'es') reasons.push('Speaks Spanish')
    }
    if (need) {
      score += 3
      const label = styleLabelByKey.get(need) ?? need
      reasons.push(`Happy to ${label.toLowerCase()}`)
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
        `Shares ${overlap === 1 ? 'interest' : `${overlap} interests`}${names ? `: ${names}` : ''}`,
      )
    }

    const memberOutings = recentOutings.filter((o) => o.member_id === c.id)
    const memberHappened = memberOutings.filter((o) => o.status === 'happened')
    const lastHappened = memberHappened.reduce((max, o) => {
      const t = new Date(o.scheduled_at).getTime()
      return t > max ? t : max
    }, 0)
    const daysSinceLast =
      lastHappened === 0 ? Infinity : (now - lastHappened) / DAY_MS
    const freshness = Math.min(daysSinceLast / 14, 5)
    score += freshness
    if (daysSinceLast === Infinity) reasons.push('New to fellowshipping')
    else if (daysSinceLast > 56)
      reasons.push(`Hasn't been out in ${Math.round(daysSinceLast)} days`)

    const reliability = 3 + Math.min(memberHappened.length, 3)
    score += reliability
    if (memberHappened.length >= 2) reasons.push('Solid track record')

    const priorSuccess = memberOutings.some(
      (o) => o.friend_id === friend.id && o.status === 'happened',
    )
    if (priorSuccess) {
      score += 1
      reasons.push(`Went with ${friend.first_name} before and it went well`)
    }

    const thirtyDaysAgo = now - 30 * DAY_MS
    const recentlyPaired = memberOutings.some(
      (o) =>
        o.friend_id === friend.id &&
        new Date(o.scheduled_at).getTime() > thirtyDaysAgo,
    )
    if (recentlyPaired) {
      score -= 3
      reasons.push(`Recently out with ${friend.first_name}`)
    }

    scored.push({ candidate: c, score, reasons })
  }

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 5)
  let hint: string | null = null
  if (top.length === 0) {
    hint =
      friend.locale === 'es'
        ? 'No one available in Spanish at that time slot.'
        : 'No one is available for that day and time slot.'
  } else if (top.length < 3) {
    hint = `Only ${top.length} match${top.length === 1 ? '' : 'es'}.`
  }
  return { top, hint }
}

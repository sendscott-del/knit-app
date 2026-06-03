export const DAYS_OF_WEEK = [
  { value: 0, short: 'Sun', long: 'Sunday' },
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
] as const

export const TIME_SLOTS = [
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
] as const

export type TimeSlot = (typeof TIME_SLOTS)[number]['value']
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type Slot = { day: DayOfWeek; timeSlot: TimeSlot }

export function slotKey(day: DayOfWeek, timeSlot: TimeSlot) {
  return `${day}-${timeSlot}`
}

/**
 * Optional translator hook. If callers pass a `t`, day names and time-slot
 * phrases come from the i18n catalog so the output follows the EN/ES toggle.
 * If `t` is omitted, falls back to the canonical English forms — handy for
 * server-side log messages or tests.
 *
 * Expected catalog keys (under namespace 'common'):
 *   slots.day_short.{sun,mon,tue,wed,thu,fri,sat}
 *   slots.all_day
 *   slots.mornings | slots.afternoons | slots.evenings
 *   slots.phrase_join  (separator between phrases, e.g. "; ")
 *   slots.day_join     (separator between day names, e.g. ", ")
 *   slots.slot_join    (separator between slot names, e.g. " & ")
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Translator = (key: string, defaultValue?: any) => string

const DAY_SHORT_KEYS: Record<DayOfWeek, string> = {
  0: 'slots.day_short.sun',
  1: 'slots.day_short.mon',
  2: 'slots.day_short.tue',
  3: 'slots.day_short.wed',
  4: 'slots.day_short.thu',
  5: 'slots.day_short.fri',
  6: 'slots.day_short.sat',
}

/**
 * Compact, readable string for a set of slots.
 * Groups days that share an identical set of time-slots together.
 *   "Tue, Thu evenings; Sun afternoons"
 */
export function slotsToString(slots: Slot[], t?: Translator): string {
  if (slots.length === 0) return ''

  const tr = (key: string, fallback: string): string =>
    t ? t(key, fallback) || fallback : fallback

  // Build: day -> sorted array of time slots
  const daySlots = new Map<DayOfWeek, TimeSlot[]>()
  for (const s of slots) {
    const list = daySlots.get(s.day) ?? []
    if (!list.includes(s.timeSlot)) list.push(s.timeSlot)
    daySlots.set(s.day, list)
  }
  const slotOrder: Record<TimeSlot, number> = { morning: 0, afternoon: 1, evening: 2 }
  for (const list of daySlots.values()) list.sort((a, b) => slotOrder[a] - slotOrder[b])

  // Group days by identical slot lists
  const groups = new Map<string, { days: DayOfWeek[]; slots: TimeSlot[] }>()
  for (const [day, slotList] of daySlots) {
    const key = slotList.join(',')
    const g = groups.get(key) ?? { days: [], slots: slotList }
    g.days.push(day)
    groups.set(key, g)
  }

  const dayJoin = tr('slots.day_join', ', ')
  const slotJoin = tr('slots.slot_join', ' & ')
  const phraseJoin = tr('slots.phrase_join', '; ')

  const phrases: string[] = []
  // Sort groups by their first day
  const sortedGroups = [...groups.values()].sort((a, b) => a.days[0] - b.days[0])
  for (const g of sortedGroups) {
    g.days.sort((a, b) => a - b)
    const dayNames = g.days
      .map((d) => tr(DAY_SHORT_KEYS[d], DAYS_OF_WEEK[d].short))
      .join(dayJoin)
    const slotName =
      g.slots.length === 3
        ? tr('slots.all_day', 'all day')
        : g.slots
            .map((s) =>
              s === 'morning'
                ? tr('slots.mornings', 'mornings')
                : s === 'afternoon'
                  ? tr('slots.afternoons', 'afternoons')
                  : tr('slots.evenings', 'evenings'),
            )
            .join(slotJoin)
    phrases.push(`${dayNames} ${slotName}`)
  }
  return phrases.join(phraseJoin)
}

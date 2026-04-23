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
 * Compact, readable string for a set of slots.
 * Groups days that share an identical set of time-slots together.
 *   "Tue, Thu evenings; Sun afternoons"
 */
export function slotsToString(slots: Slot[]): string {
  if (slots.length === 0) return ''

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

  // Build phrases
  const phrases: string[] = []
  // Sort groups by their first day
  const sortedGroups = [...groups.values()].sort((a, b) => a.days[0] - b.days[0])
  for (const g of sortedGroups) {
    g.days.sort((a, b) => a - b)
    const dayNames = g.days.map((d) => DAYS_OF_WEEK[d].short).join(', ')
    const slotName =
      g.slots.length === 3
        ? 'all day'
        : g.slots
            .map((s) => (s === 'morning' ? 'mornings' : s === 'afternoon' ? 'afternoons' : 'evenings'))
            .join(' & ')
    phrases.push(`${dayNames} ${slotName}`)
  }
  return phrases.join('; ')
}

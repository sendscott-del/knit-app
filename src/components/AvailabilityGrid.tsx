import { DAYS_OF_WEEK, TIME_SLOTS, slotKey, type Slot, type DayOfWeek, type TimeSlot } from '@/lib/availability'

export default function AvailabilityGrid({
  value,
  onChange,
  disabled,
}: {
  value: Slot[]
  onChange: (next: Slot[]) => void
  disabled?: boolean
}) {
  const selected = new Set(value.map((s) => slotKey(s.day, s.timeSlot)))

  function toggle(day: DayOfWeek, timeSlot: TimeSlot) {
    const key = slotKey(day, timeSlot)
    if (selected.has(key)) {
      onChange(value.filter((s) => slotKey(s.day, s.timeSlot) !== key))
    } else {
      onChange([...value, { day, timeSlot }])
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="w-20"></th>
            {DAYS_OF_WEEK.map((d) => (
              <th key={d.value} className="text-xs font-medium text-slate-600 px-1 pb-1">
                {d.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TIME_SLOTS.map((slot) => (
            <tr key={slot.value}>
              <td className="text-xs font-medium text-slate-600 pr-2 text-right">
                {slot.label}
              </td>
              {DAYS_OF_WEEK.map((d) => {
                const active = selected.has(slotKey(d.value as DayOfWeek, slot.value))
                return (
                  <td key={d.value}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(d.value as DayOfWeek, slot.value)}
                      aria-label={`${d.long} ${slot.label}`}
                      aria-pressed={active}
                      className={`h-10 w-10 sm:h-12 sm:w-12 rounded-lg border text-sm transition ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-400 border-slate-300 hover:border-slate-500 hover:text-slate-700'
                      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {active ? '✓' : ''}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

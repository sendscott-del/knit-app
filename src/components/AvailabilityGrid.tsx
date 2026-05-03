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
              <th key={d.value} className="text-xs font-bold uppercase tracking-wide text-gray-500 px-1 pb-1">
                {d.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TIME_SLOTS.map((slot) => (
            <tr key={slot.value}>
              <td className="text-xs font-semibold text-gray-600 pr-2 text-right">
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
                      className={`h-11 w-11 sm:h-12 sm:w-12 rounded-md border-[1.5px] text-sm font-bold transition ${
                        active
                          ? 'bg-brand-primary-fade text-brand-primary border-brand-primary'
                          : 'bg-white text-gray-300 border-gray-200 hover:border-gray-400 hover:text-gray-500'
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

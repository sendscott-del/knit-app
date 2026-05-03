import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type Style = Database['public']['Tables']['knit_participation_styles']['Row']

const STYLE_ICONS: Record<string, string> = {
  host_meal: '🍽',
  give_ride: '🚗',
  attend_lesson: '🪑',
  invite_to_activity: '🎉',
  take_to_event: '🎫',
  teach_skill: '🎓',
  share_testimony: '💬',
}

export default function StylePicker({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [styles, setStyles] = useState<Style[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('knit_participation_styles')
        .select('*')
        .order('sort_order')
      if (cancelled) return
      if (error) setError(error.message)
      else setStyles(data ?? [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function toggle(key: string) {
    if (value.includes(key)) onChange(value.filter((v) => v !== key))
    else onChange([...value, key])
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>
  if (error) return <p className="text-sm text-error">{error}</p>

  return (
    <div className="grid gap-2">
      {styles.map((s) => {
        const active = value.includes(s.key)
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => toggle(s.key)}
            aria-pressed={active}
            className={`flex items-center gap-4 rounded-md border-[1.5px] p-4 text-left transition min-h-[60px] ${
              active
                ? 'bg-brand-primary-fade text-brand-primary border-brand-primary shadow-sm'
                : 'bg-white text-gray-900 border-gray-200 hover:border-gray-400'
            }`}
          >
            <span className="text-2xl" aria-hidden="true">
              {STYLE_ICONS[s.key] ?? '•'}
            </span>
            <span className="text-base font-semibold">{s.label_en}</span>
          </button>
        )
      })}
    </div>
  )
}

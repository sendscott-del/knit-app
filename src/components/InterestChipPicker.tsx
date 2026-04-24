import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type InterestTag = Database['public']['Tables']['knit_interest_tags']['Row']
type Category = Database['public']['Enums']['knit_tag_category']

const CATEGORY_ORDER: Category[] = ['hobby', 'sport', 'life_stage', 'profession', 'culture']
const CATEGORY_LABELS: Record<Category, string> = {
  hobby: 'Hobbies',
  sport: 'Sports & activity',
  life_stage: 'Life stage',
  profession: 'Work',
  culture: 'Language & culture',
}

export default function InterestChipPicker({
  wardId,
  value,
  onChange,
}: {
  wardId?: string | null
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [tags, setTags] = useState<InterestTag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Globals (ward_id null) + any tags for the member's ward.
      const query = supabase
        .from('knit_interest_tags')
        .select('*')
        .eq('active', true)
        .order('name_en')
      if (wardId) query.or(`ward_id.is.null,ward_id.eq.${wardId}`)
      else query.is('ward_id', null)
      const { data, error } = await query
      if (cancelled) return
      if (error) setError(error.message)
      else setTags(data ?? [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [wardId])

  const byCategory = useMemo(() => {
    const map = new Map<Category, InterestTag[]>()
    for (const tag of tags) {
      const list = map.get(tag.category) ?? []
      list.push(tag)
      map.set(tag.category, list)
    }
    return map
  }, [tags])

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((v) => v !== id))
    else onChange([...value, id])
  }

  if (loading) return <p className="text-sm text-slate-500">Loading options…</p>
  if (error) return <p className="text-sm text-rose-700">{error}</p>

  return (
    <div className="space-y-5">
      {CATEGORY_ORDER.map((cat) => {
        const list = byCategory.get(cat)
        if (!list || list.length === 0) return null
        return (
          <div key={cat} className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-slate-500 font-medium">
              {CATEGORY_LABELS[cat]}
            </h3>
            <div className="flex flex-wrap gap-2">
              {list.map((tag) => {
                const active = value.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggle(tag.id)}
                    aria-pressed={active}
                    className={`px-4 py-2 rounded-full border text-sm font-medium transition min-h-[44px] ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {tag.name_en}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

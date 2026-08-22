import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import type { MemberAuth } from '@/lib/memberAuth'
import { localizedTagName } from '@/lib/localizedLabel'

type InterestTag = Database['public']['Tables']['knit_interest_tags']['Row']
type Category = Database['public']['Enums']['knit_tag_category']

const CATEGORY_ORDER: Category[] = ['hobby', 'sport', 'life_stage', 'profession', 'culture']

export default function InterestChipPicker({
  wardId,
  value,
  onChange,
  memberAuth,
}: {
  wardId?: string | null
  value: string[]
  onChange: (next: string[]) => void
  /**
   * Members on the magic-link dashboard/onboarding are the `anon` role, and
   * knit_interest_tags only grants SELECT to `authenticated` — a direct table
   * read returns zero rows with no error. Pass the member's token so the picker
   * reads through the token-checked RPC instead.
   */
  memberAuth?: MemberAuth | null
}) {
  const { t, i18n } = useTranslation('common')
  const [tags, setTags] = useState<InterestTag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const categoryLabel: Record<Category, string> = {
    hobby: t('interest_picker.category_hobby'),
    sport: t('interest_picker.category_sport'),
    life_stage: t('interest_picker.category_life_stage'),
    profession: t('interest_picker.category_profession'),
    culture: t('interest_picker.category_culture'),
  }

  const memberId = memberAuth?.memberId ?? null
  const memberToken = memberAuth?.token ?? null

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      // Globals (ward_id null) + any tags for the member's ward.
      const { data, error } =
        memberId && memberToken
          ? await supabase.rpc('knit_member_self_list_interest_tags', {
              p_member_id: memberId,
              p_token: memberToken,
            })
          : await (() => {
              const query = supabase
                .from('knit_interest_tags')
                .select('*')
                .eq('active', true)
                .order('name_en')
              if (wardId) query.or(`ward_id.is.null,ward_id.eq.${wardId}`)
              else query.is('ward_id', null)
              return query
            })()
      if (cancelled) return
      if (error) setError(error.message)
      else setTags((data as InterestTag[] | null) ?? [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [wardId, memberId, memberToken])

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

  if (loading) return <p className="text-sm text-gray-500">{t('interest_picker.loading')}</p>
  if (error) return <p className="text-sm text-error">{error}</p>
  // Never render an empty picker silently — a blank "What you love" with only
  // Save/Cancel is what the RLS bug looked like to members for 10 weeks.
  if (tags.length === 0)
    return <p className="text-sm text-gray-500">{t('interest_picker.none_available')}</p>

  return (
    <div className="space-y-5">
      {CATEGORY_ORDER.map((cat) => {
        const list = byCategory.get(cat)
        if (!list || list.length === 0) return null
        return (
          <div key={cat} className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-gray-500 font-bold">
              {categoryLabel[cat]}
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
                    className={`px-4 py-2 rounded-full border-[1.5px] text-sm font-semibold transition min-h-[44px] ${
                      active
                        ? 'bg-brand-primary-fade text-brand-primary border-brand-primary'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {localizedTagName(tag, i18n.language)}
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

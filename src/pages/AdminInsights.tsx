import { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'

type Ctx = { profile: AdminProfile }

type FunnelRow = {
  ward_name: string
  roster: number
  invited: number
  onboarded: number
  with_interests: number
  with_availability: number
  opted_out: number
  paused: number
}
type Labeled = { name_en?: string; name_es?: string | null; label_en?: string; label_es?: string | null; members: number }
type AvailCell = { day_of_week: number; time_slot: string; members: number }
type Recent = { suggestion: string; status: string; created_at: string }
type SheetRow = { ward_name: string; status: string; last_error: string | null; last_pull_at: string | null; last_push_at: string | null }

type Insights = {
  generated_at: string
  funnel: FunnelRow[]
  top_interests: Labeled[]
  top_styles: Labeled[]
  availability: AvailCell[]
  feedback: { by_status: Record<string, number>; recent: Recent[] }
  health: {
    sheets: SheetRow[]
    sms_30d: Record<string, number>
    sms_replies_30d: number
    invitations: Record<string, number>
    errors_7d_total: number
    errors_7d_by_name: Record<string, number>
  }
}

type ErrorEvent = {
  id: string
  name: string
  severity: string
  source: string
  route: string | null
  message: string | null
  app_version: string | null
  created_at: string
}

const DAY_KEYS = ['short_sun', 'short_mon', 'short_tue', 'short_wed', 'short_thu', 'short_fri', 'short_sat']
const SLOT_ORDER = ['morning', 'afternoon', 'evening']

export default function AdminInsights() {
  const { profile } = useOutletContext<Ctx>()
  const { t, i18n } = useTranslation('common')
  const isSuper = Boolean(profile.is_super_admin || profile.is_app_super_admin)

  const [data, setData] = useState<Insights | null>(null)
  const [errors, setErrors] = useState<ErrorEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    const [insightsRes, errorsRes] = await Promise.all([
      supabase.rpc('knit_admin_insights'),
      supabase
        .from('knit_events')
        .select('id, name, severity, source, route, message, app_version, created_at')
        .eq('kind', 'error')
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    if (insightsRes.error) {
      setLoadErr(insightsRes.error.message)
      setLoading(false)
      return
    }
    setData(insightsRes.data as Insights)
    setErrors((errorsRes.data ?? []) as ErrorEvent[])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (isSuper) void load()
    else setLoading(false)
  }, [isSuper, load])

  const localized = (l: Labeled) =>
    i18n.language.startsWith('es')
      ? l.name_es ?? l.label_es ?? l.name_en ?? l.label_en ?? ''
      : l.name_en ?? l.label_en ?? ''

  if (!isSuper) {
    return (
      <div className="suite-card p-6">
        <h1 className="text-xl font-semibold text-gray-900">{t('insights.title')}</h1>
        <p className="text-sm text-gray-600 mt-2">{t('insights.not_authorized')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{t('insights.title')}</h1>
          <p className="text-sm text-gray-600 mt-1">{t('insights.subtitle')}</p>
          {data?.generated_at && (
            <p className="text-xs text-gray-400 mt-1">
              {t('insights.as_of', { time: formatDistanceToNow(new Date(data.generated_at), { addSuffix: true }) })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-outline text-sm whitespace-nowrap disabled:opacity-50"
        >
          {loading ? t('loading') : t('insights.refresh')}
        </button>
      </div>

      {loadErr && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{loadErr}</div>
      )}

      {data && (
        <>
          {/* Adoption funnel */}
          <Section title={t('insights.funnel_title')} hint={t('insights.funnel_hint')}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="py-2 pr-3 font-medium">{t('insights.col_ward')}</th>
                    <th className="py-2 px-3 font-medium text-right">{t('insights.col_roster')}</th>
                    <th className="py-2 px-3 font-medium text-right">{t('insights.col_invited')}</th>
                    <th className="py-2 px-3 font-medium text-right">{t('insights.col_onboarded')}</th>
                    <th className="py-2 px-3 font-medium text-right">{t('insights.col_complete')}</th>
                    <th className="py-2 pl-3 font-medium text-right">{t('insights.col_opted_out')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.funnel.map((f) => (
                    <tr key={f.ward_name} className="border-t border-gray-100">
                      <td className="py-2 pr-3 font-medium text-gray-900">{f.ward_name}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{f.roster}</td>
                      <td className="py-2 px-3 text-right text-gray-700">{f.invited}</td>
                      <td className="py-2 px-3 text-right font-semibold text-knit-primary">{f.onboarded}</td>
                      <td className="py-2 px-3 text-right text-gray-700">{Math.min(f.with_interests, f.with_availability)}</td>
                      <td className="py-2 pl-3 text-right text-gray-400">{f.opted_out || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 text-gray-900 font-semibold">
                    <td className="py-2 pr-3">{t('insights.total')}</td>
                    <td className="py-2 px-3 text-right">{sum(data.funnel, 'roster')}</td>
                    <td className="py-2 px-3 text-right">{sum(data.funnel, 'invited')}</td>
                    <td className="py-2 px-3 text-right text-knit-primary">{sum(data.funnel, 'onboarded')}</td>
                    <td className="py-2 px-3 text-right">—</td>
                    <td className="py-2 pl-3 text-right">{sum(data.funnel, 'opted_out') || '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Section>

          {/* What members like */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title={t('insights.interests_title')} hint={t('insights.interests_hint')}>
              <BarList items={data.top_interests.map((i) => ({ label: localized(i), value: i.members }))} empty={t('insights.no_data')} />
            </Section>
            <Section title={t('insights.styles_title')} hint={t('insights.styles_hint')}>
              <BarList items={data.top_styles.map((s) => ({ label: localized(s), value: s.members }))} empty={t('insights.no_data')} />
            </Section>
          </div>

          {/* Availability heatmap */}
          <Section title={t('insights.availability_title')} hint={t('insights.availability_hint')}>
            <AvailabilityHeatmap cells={data.availability} t={t} />
          </Section>

          {/* Feedback inbox */}
          <Section title={t('insights.feedback_title')} hint={t('insights.feedback_hint')}>
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.keys(data.feedback.by_status).length === 0 && (
                <span className="text-sm text-gray-400">{t('insights.no_feedback')}</span>
              )}
              {Object.entries(data.feedback.by_status).map(([status, n]) => (
                <span key={status} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                  {status} · {n}
                </span>
              ))}
            </div>
            <ul className="space-y-2">
              {data.feedback.recent.map((r, idx) => (
                <li key={idx} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <p className="text-sm text-gray-800">{r.suggestion}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {r.status} · {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </p>
                </li>
              ))}
            </ul>
          </Section>

          {/* Operational health */}
          <Section title={t('insights.health_title')} hint={t('insights.health_hint')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard label={t('insights.stat_sms')} value={String(sumObj(data.health.sms_30d))} sub={t('insights.stat_sms_replies', { n: data.health.sms_replies_30d })} />
              <StatCard
                label={t('insights.stat_invites')}
                value={String(sumObj(data.health.invitations))}
                sub={Object.entries(data.health.invitations).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}
              />
              <StatCard
                label={t('insights.stat_errors')}
                value={String(data.health.errors_7d_total)}
                sub={Object.entries(data.health.errors_7d_by_name).map(([k, v]) => `${k}: ${v}`).join(' · ') || t('insights.no_errors')}
                danger={data.health.errors_7d_total > 0}
              />
              <StatCard
                label={t('insights.stat_sheets')}
                value={`${data.health.sheets.filter((s) => s.status === 'healthy').length}/${data.health.sheets.length}`}
                sub={t('insights.stat_sheets_sub')}
              />
            </div>
            <div className="mt-4 space-y-1">
              {data.health.sheets.map((s) => (
                <div key={s.ward_name} className="flex items-center justify-between gap-3 text-sm border-t border-gray-100 py-2">
                  <span className="font-medium text-gray-800">{s.ward_name}</span>
                  <span className="flex items-center gap-2">
                    <StatusDot status={s.status} />
                    <span className="text-gray-500">{s.status}</span>
                    {s.last_error && <span className="text-xs text-rose-500 truncate max-w-[220px]" title={s.last_error}>{s.last_error}</span>}
                  </span>
                </div>
              ))}
            </div>
          </Section>

          {/* Recent errors feed */}
          <Section title={t('insights.errors_title')} hint={t('insights.errors_hint')}>
            {errors.length === 0 ? (
              <p className="text-sm text-gray-400">{t('insights.no_errors_feed')} 🎉</p>
            ) : (
              <ul className="space-y-2">
                {errors.map((e) => (
                  <li key={e.id} className="rounded-lg border border-gray-100 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${e.severity === 'error' ? 'bg-rose-500' : e.severity === 'warning' ? 'bg-amber-400' : 'bg-gray-300'}`} />
                        <span className="text-sm font-semibold text-gray-900">{e.name}</span>
                        <span className="text-xs text-gray-400">{e.source}{e.route ? ` · ${e.route}` : ''}</span>
                      </span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}</span>
                    </div>
                    {e.message && <p className="text-xs text-gray-600 mt-1 break-words">{e.message}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="suite-card p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function BarList({ items, empty }: { items: { label: string; value: number }[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-gray-400">{empty}</p>
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span className="w-36 shrink-0 truncate text-sm text-gray-700" title={i.label}>{i.label}</span>
          <span className="flex-1 h-4 rounded bg-gray-100 overflow-hidden">
            <span className="block h-full rounded bg-knit-primary/70" style={{ width: `${Math.max((i.value / max) * 100, 6)}%` }} />
          </span>
          <span className="w-6 text-right text-sm font-medium text-gray-600">{i.value}</span>
        </li>
      ))}
    </ul>
  )
}

function AvailabilityHeatmap({ cells, t }: { cells: AvailCell[]; t: (k: string) => string }) {
  const lookup = new Map(cells.map((c) => [`${c.day_of_week}:${c.time_slot}`, c.members]))
  const max = Math.max(...cells.map((c) => c.members), 1)
  return (
    <div className="overflow-x-auto">
      <table className="text-center text-xs">
        <thead>
          <tr>
            <th className="p-1.5" />
            {DAY_KEYS.map((dk) => (
              <th key={dk} className="p-1.5 font-medium text-gray-500">{t(`days.${dk}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOT_ORDER.map((slot) => (
            <tr key={slot}>
              <td className="p-1.5 text-right font-medium text-gray-500 capitalize">{t(`insights.slot_${slot}`)}</td>
              {DAY_KEYS.map((_, day) => {
                const n = lookup.get(`${day}:${slot}`) ?? 0
                const intensity = n === 0 ? 0 : 0.15 + (n / max) * 0.85
                return (
                  <td key={day} className="p-1">
                    <div
                      className="w-9 h-9 rounded flex items-center justify-center text-[11px] font-semibold"
                      style={{
                        backgroundColor: n === 0 ? '#f3f4f6' : `rgba(27,58,107,${intensity})`,
                        color: intensity > 0.5 ? 'white' : '#374151',
                      }}
                    >
                      {n || ''}
                    </div>
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

function StatCard({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-100 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${danger ? 'text-rose-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1 break-words">{sub}</p>}
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'healthy' ? 'bg-emerald-500' : status === 'error' ? 'bg-rose-500' : 'bg-gray-300'
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
}

function sum(rows: FunnelRow[], key: keyof FunnelRow): number {
  return rows.reduce((n, r) => n + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0)
}
function sumObj(o: Record<string, number>): number {
  return Object.values(o).reduce((n, v) => n + v, 0)
}

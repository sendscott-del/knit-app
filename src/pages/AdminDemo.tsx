import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import { isWardScoped } from '@/lib/roles'
import { DemoBannerToggle } from '@/components/DemoModeBanner'

type Ctx = { profile: AdminProfile }

type Status = { members: number; friends: number; outings: number }

export default function AdminDemo() {
  const { profile } = useOutletContext<Ctx>()
  const { t } = useTranslation('common')
  const { wards, loading: wardsLoading } = useWardOptions(profile)

  const [wardId, setWardId] = useState<string>(
    isWardScoped(profile.role) && !profile.is_super_admin ? profile.ward_id ?? '' : '',
  )
  useEffect(() => {
    if (!wardId && wards.length === 1) setWardId(wards[0].id)
  }, [wards, wardId])

  const [status, setStatus] = useState<Status | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [busy, setBusy] = useState<'load' | 'clear' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function refreshStatus() {
    if (!wardId) {
      setStatus(null)
      return
    }
    setLoadingStatus(true)
    setErr(null)
    const { data, error } = await supabase.rpc('knit_demo_status', {
      p_ward_id: wardId,
    })
    setLoadingStatus(false)
    if (error) {
      setErr(error.message)
      return
    }
    setStatus(data as unknown as Status)
  }

  useEffect(() => {
    void refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardId])

  async function load() {
    if (!wardId) return
    setBusy('load')
    setErr(null)
    setNotice(null)
    const { data, error } = await supabase.rpc('knit_load_demo_data', {
      p_ward_id: wardId,
    })
    setBusy(null)
    if (error) {
      setErr(error.message)
      return
    }
    const d = data as { already_loaded?: boolean; members?: number; friends?: number; outings?: number }
    setNotice(
      d.already_loaded
        ? t('demo.already_loaded_notice', { members: d.members, friends: d.friends, outings: d.outings })
        : t('demo.loaded_notice', { members: d.members, friends: d.friends, outings: d.outings }),
    )
    await refreshStatus()
  }

  async function clear() {
    if (!wardId) return
    if (!confirm(t('demo.clear_confirm'))) return
    setBusy('clear')
    setErr(null)
    setNotice(null)
    const { data, error } = await supabase.rpc('knit_clear_demo_data', {
      p_ward_id: wardId,
    })
    setBusy(null)
    if (error) {
      setErr(error.message)
      return
    }
    const d = data as { members?: number; friends?: number; outings?: number }
    setNotice(t('demo.cleared_notice', { members: d.members, friends: d.friends, outings: d.outings }))
    await refreshStatus()
  }

  const hasDemo =
    status !== null && (status.members > 0 || status.friends > 0 || status.outings > 0)

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-gray-200 bg-white p-5 space-y-2">
        <h2 className="font-medium text-gray-900">{t('demo.role_banner_title')}</h2>
        <p className="text-xs text-gray-600">
          {t('demo.role_banner_subtitle')}
        </p>
        <DemoBannerToggle />
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('demo.demo_data_title')}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {t('demo.demo_data_subtitle_pre')}
          <span className="inline-flex items-center rounded-full bg-brand-accent-light text-brand-primary-dark border border-brand-accent/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide align-middle">
            {t('demo.demo_pill')}
          </span>
          {t('demo.demo_data_subtitle_post')}
        </p>
      </div>

      {wards.length > 1 ? (
        <div className="rounded-md border border-gray-200 bg-white p-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-gray-700">{t('demo.ward_label')}</span>
            <select
              value={wardId}
              onChange={(e) => setWardId(e.target.value)}
              className="form-input"
              disabled={wardsLoading}
            >
              <option value="">{wardsLoading ? t('loading') : t('pick_a_ward')}</option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm text-gray-900">
          {notice}
        </div>
      ) : null}
      {err ? (
        <div className="rounded-md border border-error/30 bg-error/5 p-3 text-sm text-gray-900">
          {err}
        </div>
      ) : null}

      <div className="rounded-md border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="font-medium text-gray-900">{t('demo.current_data_title')}</h2>
        {loadingStatus ? (
          <p className="text-sm text-gray-500">{t('demo.loading')}</p>
        ) : status === null ? (
          <p className="text-sm text-gray-500">{t('demo.pick_ward_status')}</p>
        ) : (
          <dl className="grid grid-cols-3 gap-4 text-center">
            <Stat label={t('demo.stat_members')} value={status.members} />
            <Stat label={t('demo.stat_friends')} value={status.friends} />
            <Stat label={t('demo.stat_outings')} value={status.outings} />
          </dl>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={() => void load()}
            disabled={busy !== null || !wardId || hasDemo}
            className="btn-primary text-sm py-2 px-4"
          >
            {busy === 'load' ? t('demo.loading_btn') : hasDemo ? t('demo.already_loaded') : t('demo.load_label')}
          </button>
          <button
            onClick={() => void clear()}
            disabled={busy !== null || !hasDemo}
            className="rounded-md border-[1.5px] border-error/60 text-error px-4 py-2 text-sm font-semibold hover:bg-error/5 disabled:opacity-50 disabled:text-gray-400 disabled:border-gray-200"
          >
            {busy === 'clear' ? t('demo.clearing') : t('demo.clear_label')}
          </button>
        </div>
      </div>

      <details className="text-sm text-gray-600">
        <summary className="cursor-pointer font-medium text-gray-700">
          {t('demo.details_summary')}
        </summary>
        <div className="mt-3 space-y-3 pl-4">
          <p>
            <strong>6 members</strong> {t('demo.details_members')}
          </p>
          <p>
            <strong>3 friends</strong> {t('demo.details_friends')}
          </p>
          <p>
            <strong>8 outings</strong> {t('demo.details_outings')}{' '}
            <em>{t('demo.details_outings_happened')}</em>,{' '}
            <em>{t('demo.details_outings_flaked')}</em>, {t('or').toLowerCase()}{' '}
            <em>{t('demo.details_outings_scheduled')}</em>
            {t('demo.details_outings_post')}
          </p>
        </div>
      </details>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-gray-50 p-4">
      <div className="text-3xl font-semibold text-gray-900">{value}</div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mt-1">{label}</div>
    </div>
  )
}

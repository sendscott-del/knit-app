import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'

type Ctx = { profile: AdminProfile }

type Status = { members: number; friends: number; outings: number }

export default function AdminDemo() {
  const { profile } = useOutletContext<Ctx>()
  const { wards, loading: wardsLoading } = useWardOptions(profile)

  const [wardId, setWardId] = useState<string>(
    profile.role === 'ward_mission_leader' ? profile.ward_id ?? '' : '',
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
        ? `Demo data already present (${d.members} members · ${d.friends} friends · ${d.outings} outings).`
        : `Loaded ${d.members} members, ${d.friends} friends, ${d.outings} outings.`,
    )
    await refreshStatus()
  }

  async function clear() {
    if (!wardId) return
    if (!confirm('Delete all demo members, friends, and outings in this ward?')) return
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
    setNotice(`Cleared ${d.members} members, ${d.friends} friends, ${d.outings} outings.`)
    await refreshStatus()
  }

  const hasDemo =
    status !== null && (status.members > 0 || status.friends > 0 || status.outings > 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Demo data</h1>
        <p className="text-sm text-slate-600 mt-1">
          Seed a realistic set of members, friends, and outings so you can test
          the suggestion algorithm, onboarding flow, and sheet integration
          without hand-entering everything. Demo rows are tagged{' '}
          <span className="inline-flex items-center rounded-full bg-fuchsia-100 text-fuchsia-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide align-middle">
            demo
          </span>{' '}
          and can be wiped at any time.
        </p>
      </div>

      {wards.length > 1 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Ward</span>
            <select
              value={wardId}
              onChange={(e) => setWardId(e.target.value)}
              className="form-input"
              disabled={wardsLoading}
            >
              <option value="">{wardsLoading ? 'Loading…' : 'Pick a ward'}</option>
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
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}
      {err ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          {err}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="font-medium text-slate-900">Current demo data in this ward</h2>
        {loadingStatus ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : status === null ? (
          <p className="text-sm text-slate-500">Pick a ward to see status.</p>
        ) : (
          <dl className="grid grid-cols-3 gap-4 text-center">
            <Stat label="Members" value={status.members} />
            <Stat label="Friends" value={status.friends} />
            <Stat label="Outings" value={status.outings} />
          </dl>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={() => void load()}
            disabled={busy !== null || !wardId || hasDemo}
            className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            {busy === 'load' ? 'Loading…' : hasDemo ? 'Demo data already loaded' : 'Load demo data'}
          </button>
          <button
            onClick={() => void clear()}
            disabled={busy !== null || !hasDemo}
            className="rounded-lg border border-rose-300 text-rose-700 px-4 py-2 text-sm font-medium hover:bg-rose-50 disabled:opacity-50 disabled:text-slate-400 disabled:border-slate-200"
          >
            {busy === 'clear' ? 'Clearing…' : 'Clear demo data'}
          </button>
        </div>
      </div>

      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">
          What's in the demo dataset?
        </summary>
        <div className="mt-3 space-y-3 pl-4">
          <p>
            <strong>6 members</strong> with varied availability, interests, and
            participation styles. Two are Spanish speakers, one hasn't been
            onboarded yet so you can see the "Not onboarded" state.
          </p>
          <p>
            <strong>3 friends</strong> with different teaching statuses
            (investigating, progressing, on a baptism date) and languages.
          </p>
          <p>
            <strong>8 outings</strong> spread over the last 45 days, plus one
            scheduled 5 days out. Mix of <em>happened</em>, <em>flaked</em>, and{' '}
            <em>scheduled</em> — enough to exercise the freshness and reliability
            scoring in Suggest.
          </p>
        </div>
      </details>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <div className="text-3xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mt-1">{label}</div>
    </div>
  )
}

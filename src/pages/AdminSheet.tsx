import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import type { Database } from '@/lib/database.types'

type BindingRow = Database['public']['Tables']['knit_google_sheet_bindings']['Row']
type Ctx = { profile: AdminProfile }

async function authorizedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  headers.set('Content-Type', 'application/json')
  return fetch(path, { ...init, headers })
}

export default function AdminSheet() {
  const { profile } = useOutletContext<Ctx>()
  const { wards, loading: wardsLoading } = useWardOptions(profile)

  const [wardId, setWardId] = useState<string>(
    profile.role === 'ward_mission_leader' ? profile.ward_id ?? '' : '',
  )
  useEffect(() => {
    if (!wardId && wards.length === 1) setWardId(wards[0].id)
  }, [wards, wardId])

  const [binding, setBinding] = useState<BindingRow | null>(null)
  const [loadingBinding, setLoadingBinding] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function loadBinding() {
    if (!wardId) {
      setBinding(null)
      return
    }
    setLoadingBinding(true)
    setErr(null)
    try {
      const r = await authorizedFetch(
        `/api/admin/sheet/get?wardId=${encodeURIComponent(wardId)}`,
      )
      const body = await r.json()
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      setBinding(body.binding as BindingRow | null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load binding')
    } finally {
      setLoadingBinding(false)
    }
  }

  useEffect(() => {
    void loadBinding()
  }, [wardId])

  async function provision(e: FormEvent) {
    e.preventDefault()
    const emails = emailInput
      .split(/[,\s]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes('@'))
    if (!wardId) {
      setErr('Pick a ward first.')
      return
    }
    setBusy(true)
    setErr(null)
    setNotice(null)
    try {
      const r = await authorizedFetch('/api/admin/sheet/provision', {
        method: 'POST',
        body: JSON.stringify({ wardId, emails }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      setNotice('Sheet created and shared.')
      setEmailInput('')
      await loadBinding()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to provision sheet')
    } finally {
      setBusy(false)
    }
  }

  async function refresh() {
    if (!wardId) return
    setBusy(true)
    setErr(null)
    setNotice(null)
    try {
      const r = await authorizedFetch('/api/admin/sheet/refresh', {
        method: 'POST',
        body: JSON.stringify({ wardId }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      setNotice('Refreshed.')
      await loadBinding()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to refresh sheet')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Missionary sheet</h1>
        <p className="text-sm text-slate-600 mt-1">
          Provision a Google Sheet for the missionaries and share it with their
          church Gmail addresses. This sheet is the missionaries' workspace for
          viewing members, requesting suggestions, and logging outings.
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

      {loadingBinding ? (
        <div className="text-sm text-slate-500">Loading binding…</div>
      ) : binding && binding.sheet_id ? (
        <BoundCard binding={binding} onRefresh={() => void refresh()} busy={busy} />
      ) : (
        <ProvisionCard
          emailInput={emailInput}
          onEmailChange={setEmailInput}
          onProvision={(e) => void provision(e)}
          busy={busy}
          disabled={!wardId}
          binding={binding}
        />
      )}

      <FAQ />
    </div>
  )
}

function BoundCard({
  binding,
  onRefresh,
  busy,
}: {
  binding: BindingRow
  onRefresh: () => void
  busy: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-slate-900">Bound to a Google Sheet</h2>
          <p className="text-sm text-slate-600 mt-1">
            Status:{' '}
            <StatusBadge status={binding.status as 'healthy' | 'error' | 'not_configured'} />
          </p>
        </div>
        <a
          href={binding.sheet_url ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
        >
          Open sheet ↗
        </a>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Meta label="Shared with">
          {binding.shared_emails.length === 0
            ? '—'
            : binding.shared_emails.join(', ')}
        </Meta>
        <Meta label="Last push">
          {binding.last_push_at
            ? new Date(binding.last_push_at).toLocaleString()
            : '—'}
        </Meta>
        <Meta label="Last pull">
          {binding.last_pull_at
            ? new Date(binding.last_pull_at).toLocaleString()
            : 'Never'}
        </Meta>
        {binding.last_error ? (
          <Meta label="Last error">
            <span className="text-rose-700">{binding.last_error}</span>
          </Meta>
        ) : null}
      </dl>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onRefresh}
          disabled={busy}
          className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? 'Refreshing…' : 'Refresh data tabs now'}
        </button>
        <span className="text-xs text-slate-500">
          Re-populates Available, Friends, and Recent Outings with the current state.
        </span>
      </div>
    </div>
  )
}

function ProvisionCard({
  emailInput,
  onEmailChange,
  onProvision,
  busy,
  disabled,
  binding,
}: {
  emailInput: string
  onEmailChange: (v: string) => void
  onProvision: (e: FormEvent) => void
  busy: boolean
  disabled: boolean
  binding: BindingRow | null
}) {
  return (
    <form
      onSubmit={onProvision}
      className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
    >
      {binding && binding.status === 'error' ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          Previous attempt failed: {binding.last_error}
        </div>
      ) : null}
      <div>
        <h2 className="font-medium text-slate-900">Provision a new sheet</h2>
        <p className="text-sm text-slate-600 mt-1">
          We'll create a fresh Google Sheet, write the 7 tabs, and share it with
          the missionaries' church Gmail addresses.
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-700">
          Missionary Gmail addresses
        </span>
        <textarea
          value={emailInput}
          onChange={(e) => onEmailChange(e.target.value)}
          rows={3}
          placeholder="elder.smith@gmail.com, sister.jones@gmail.com"
          className="form-input font-mono text-sm"
          required
        />
        <span className="text-xs text-slate-500">
          Separate with commas, spaces, or newlines. They must be Google accounts
          (church-approved Gmail addresses).
        </span>
      </label>
      <button
        type="submit"
        disabled={busy || disabled}
        className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? 'Creating sheet…' : 'Create and share sheet'}
      </button>
    </form>
  )
}

function StatusBadge({ status }: { status: 'healthy' | 'error' | 'not_configured' }) {
  const palette = {
    healthy: 'bg-emerald-100 text-emerald-800',
    error: 'bg-rose-100 text-rose-800',
    not_configured: 'bg-slate-100 text-slate-700',
  }
  const label = status === 'healthy' ? 'Healthy' : status === 'error' ? 'Error' : 'Not configured'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}
    >
      {label}
    </span>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 font-medium uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-slate-800 mt-0.5">{children}</dd>
    </div>
  )
}

function FAQ() {
  return (
    <details className="text-sm text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">
        How do missionaries use this sheet?
      </summary>
      <div className="mt-2 space-y-2 pl-4">
        <p>
          <strong>Start Here</strong> — a guide inside the sheet.
        </p>
        <p>
          <strong>Available This Week</strong> — ward members who can help, with
          their availability, interests, and last outing. Refreshes on demand
          (and soon, every morning via a cron job).
        </p>
        <p>
          <strong>Friends We are Teaching</strong> — the friend roster with
          teaching status and stats.
        </p>
        <p>
          <strong>Suggestions</strong> — missionaries fill in a friend + day +
          time + need. Knit fills in the top 5 ranked members with reasons.
          (Pull-from-sheet coming in the next slice.)
        </p>
        <p>
          <strong>Log an Outing</strong> — missionaries log completed appointments.
          Pull-from-sheet coming in the next slice.
        </p>
        <p>
          <strong>Urgent Need</strong> — fires an SMS to matching ward members
          (Phase 3).
        </p>
        <p>
          <strong>Recent Outings</strong> — rolling 90-day read-only history.
        </p>
      </div>
    </details>
  )
}

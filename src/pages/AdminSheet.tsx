import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import type { Database } from '@/lib/database.types'

type BindingRow = Database['public']['Tables']['knit_google_sheet_bindings']['Row']
type Ctx = { profile: AdminProfile }

type OAuthStatus = { connected: boolean; email?: string; granted_at?: string }

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
  const [search, setSearch] = useSearchParams()

  const [wardId, setWardId] = useState<string>(
    profile.role === 'ward_mission_leader' ? profile.ward_id ?? '' : '',
  )
  useEffect(() => {
    if (!wardId && wards.length === 1) setWardId(wards[0].id)
  }, [wards, wardId])

  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)

  const [binding, setBinding] = useState<BindingRow | null>(null)
  const [loadingBinding, setLoadingBinding] = useState(false)

  const [emailInput, setEmailInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Surface the query-string feedback from the OAuth callback
  useEffect(() => {
    const connected = search.get('connected')
    const email = search.get('email')
    const errorCode = search.get('error')
    if (connected && email) {
      setNotice(`Connected as ${email}.`)
      search.delete('connected')
      search.delete('email')
      setSearch(search, { replace: true })
    } else if (errorCode) {
      setErr(oauthErrorMessage(errorCode, email ?? undefined))
      search.delete('error')
      search.delete('email')
      setSearch(search, { replace: true })
    }
  }, [search, setSearch])

  async function loadStatus() {
    setLoadingStatus(true)
    try {
      const r = await authorizedFetch('/api/admin/google/status')
      const body = (await r.json()) as OAuthStatus
      setOauthStatus(body)
    } finally {
      setLoadingStatus(false)
    }
  }

  async function loadBinding() {
    if (!wardId) {
      setBinding(null)
      return
    }
    setLoadingBinding(true)
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
    void loadStatus()
  }, [])

  useEffect(() => {
    void loadBinding()
  }, [wardId])

  async function connect() {
    setBusy(true)
    setErr(null)
    setNotice(null)
    try {
      const r = await authorizedFetch('/api/admin/google/authorize', {
        method: 'POST',
      })
      const body = await r.json()
      if (!r.ok || !body.url) throw new Error(body.error ?? 'Failed to start connect')
      window.location.href = body.url
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to start connect')
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect the Google account? New sheets can\'t be created until you reconnect.')) return
    setBusy(true)
    setErr(null)
    try {
      const r = await authorizedFetch('/api/admin/google/disconnect', {
        method: 'POST',
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setNotice('Disconnected.')
      await loadStatus()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Disconnect failed')
    } finally {
      setBusy(false)
    }
  }

  async function createSheet(e: FormEvent) {
    e.preventDefault()
    const emails = emailInput
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes('@'))
    if (!wardId) {
      setErr('Pick a ward first.')
      return
    }
    setBusy(true)
    setErr(null)
    setNotice(null)
    try {
      const r = await authorizedFetch('/api/admin/sheet/create', {
        method: 'POST',
        body: JSON.stringify({ wardId, emails }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      setNotice('Sheet created and shared.')
      setEmailInput('')
      await loadBinding()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create sheet')
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
      setErr(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    if (!wardId) return
    setBusy(true)
    setErr(null)
    setNotice(null)
    try {
      const r = await authorizedFetch('/api/admin/sheet/sync-now', {
        method: 'POST',
        body: JSON.stringify({ wardId }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      const rep = body.report as {
        suggestionsProcessed: number
        suggestionErrors: string[]
        outingsInserted: number
        outingErrors: string[]
        headersRepaired?: string[]
      }
      const parts: string[] = []
      if (rep.suggestionsProcessed > 0)
        parts.push(`${rep.suggestionsProcessed} suggestion${rep.suggestionsProcessed === 1 ? '' : 's'} filled`)
      if (rep.outingsInserted > 0)
        parts.push(`${rep.outingsInserted} outing${rep.outingsInserted === 1 ? '' : 's'} logged`)
      if (rep.headersRepaired && rep.headersRepaired.length > 0)
        parts.push(`Restored headers on: ${rep.headersRepaired.join(', ')}`)
      if (parts.length === 0) parts.push('Nothing new to sync')
      const errs = [...rep.suggestionErrors, ...rep.outingErrors]
      if (errs.length > 0) parts.push(`${errs.length} issue${errs.length === 1 ? '' : 's'}: ${errs.slice(0, 3).join('; ')}`)
      setNotice(parts.join(' · '))
      await loadBinding()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Missionary sheet</h1>
        <p className="text-sm text-gray-600 mt-1">
          Auto-create a Google Sheet for each ward and share it with the
          missionaries. Knit keeps the data tabs in sync.
        </p>
      </div>

      {wards.length > 1 ? (
        <div className="rounded-md border border-gray-200 bg-white p-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-gray-700">Ward</span>
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
        <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm text-gray-900">
          {notice}
        </div>
      ) : null}
      {err ? (
        <div className="rounded-md border border-error/30 bg-error/5 p-3 text-sm text-gray-900">
          {err}
        </div>
      ) : null}

      {/* ---- Google connection state ---- */}
      <GoogleConnectionCard
        loading={loadingStatus}
        status={oauthStatus}
        busy={busy}
        onConnect={() => void connect()}
        onDisconnect={() => void disconnect()}
      />

      {/* ---- Per-ward binding ---- */}
      {loadingBinding ? (
        <div className="text-sm text-gray-500">Loading sheet status…</div>
      ) : binding && binding.sheet_id ? (
        <BoundCard
          binding={binding}
          onRefresh={() => void refresh()}
          onSyncNow={() => void syncNow()}
          busy={busy}
        />
      ) : (
        <CreateSheetCard
          canCreate={oauthStatus?.connected ?? false}
          emailInput={emailInput}
          onEmailChange={setEmailInput}
          onSubmit={(e) => void createSheet(e)}
          busy={busy}
          disabled={!wardId}
          binding={binding}
        />
      )}
    </div>
  )
}

function GoogleConnectionCard({
  loading,
  status,
  busy,
  onConnect,
  onDisconnect,
}: {
  loading: boolean
  status: OAuthStatus | null
  busy: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-gray-900">Google connection</h2>
          {loading ? (
            <p className="text-sm text-gray-500 mt-1">Checking…</p>
          ) : status?.connected ? (
            <p className="text-sm text-gray-600 mt-1">
              Connected as <strong>{status.email}</strong>
              {status.granted_at ? (
                <span className="text-gray-400">
                  {' '}· since {new Date(status.granted_at).toLocaleDateString()}
                </span>
              ) : null}
              . New sheets will be created in this Google account's Drive.
            </p>
          ) : (
            <p className="text-sm text-gray-600 mt-1">
              Not connected. Connect a Google account so Knit can create sheets
              for you.
            </p>
          )}
        </div>
        {!loading ? (
          status?.connected ? (
            <button
              onClick={onDisconnect}
              disabled={busy}
              className="rounded-md border-[1.5px] border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 whitespace-nowrap"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={busy}
              className="btn-primary text-sm py-2 px-4 whitespace-nowrap"
            >
              Connect Google Account
            </button>
          )
        ) : null}
      </div>
    </div>
  )
}

function BoundCard({
  binding,
  onRefresh,
  onSyncNow,
  busy,
}: {
  binding: BindingRow
  onRefresh: () => void
  onSyncNow: () => void
  busy: boolean
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-gray-900">Sheet bound to this ward</h2>
          <p className="text-sm text-gray-600 mt-1">
            Status: <StatusBadge status={binding.status as 'healthy' | 'error' | 'not_configured'} />
          </p>
        </div>
        <a
          href={binding.sheet_url ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border-[1.5px] border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 whitespace-nowrap"
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
            <span className="text-error">{binding.last_error}</span>
          </Meta>
        ) : null}
      </dl>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          onClick={onRefresh}
          disabled={busy}
          className="btn-primary text-sm py-2 px-4"
        >
          {busy ? 'Working…' : 'Push data to sheet'}
        </button>
        <button
          onClick={onSyncNow}
          disabled={busy}
          className="rounded-md border-[1.5px] border-gray-200 bg-white text-gray-900 px-4 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-50"
        >
          Sync from sheet now
        </button>
      </div>
      <div className="grid gap-1 text-xs text-gray-500 pt-1">
        <span>
          <strong>Push:</strong> Available, Friends, and Recent Outings re-populated
          from the live DB. Runs automatically every morning at 12:00 UTC.
        </span>
        <span>
          <strong>Sync from sheet:</strong> reads pending Suggestions + Log Outing
          rows, runs the matching algorithm, and writes the results back. Click
          this after missionaries fill in the sheet.
        </span>
      </div>
    </div>
  )
}

function CreateSheetCard({
  canCreate,
  emailInput,
  onEmailChange,
  onSubmit,
  busy,
  disabled,
  binding,
}: {
  canCreate: boolean
  emailInput: string
  onEmailChange: (v: string) => void
  onSubmit: (e: FormEvent) => void
  busy: boolean
  disabled: boolean
  binding: BindingRow | null
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-gray-200 bg-white p-5 space-y-4"
    >
      {binding && binding.status === 'error' ? (
        <div className="rounded-md border border-error/30 bg-error/5 p-3 text-sm text-gray-900">
          Previous attempt failed: {binding.last_error}
        </div>
      ) : null}
      <div>
        <h2 className="font-medium text-gray-900">Create sheet for this ward</h2>
        <p className="text-sm text-gray-600 mt-1">
          {canCreate
            ? "We'll create a new Google Sheet in your connected Drive, share it with the missionaries, and lay out the 7 tabs."
            : 'Connect a Google account first (above), then come back to create the sheet.'}
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-gray-700">
          Missionary Gmail addresses
        </span>
        <textarea
          value={emailInput}
          onChange={(e) => onEmailChange(e.target.value)}
          rows={3}
          placeholder="elder.smith@gmail.com, sister.jones@gmail.com"
          className="form-input font-mono text-sm"
        />
        <span className="text-xs text-gray-500">
          Separate with commas, spaces, or newlines. Leave blank for now and
          share from the sheet directly later if you prefer.
        </span>
      </label>
      <button
        type="submit"
        disabled={busy || disabled || !canCreate}
        className="btn-primary text-sm py-2 px-4"
      >
        {busy ? 'Creating…' : 'Create and share sheet'}
      </button>
    </form>
  )
}

function StatusBadge({ status }: { status: 'healthy' | 'error' | 'not_configured' }) {
  const palette = {
    healthy: 'bg-emerald-100 text-emerald-800',
    error: 'bg-rose-100 text-rose-800',
    not_configured: 'bg-gray-100 text-gray-700',
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
      <dt className="text-xs text-gray-500 font-medium uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-gray-800 mt-0.5">{children}</dd>
    </div>
  )
}

function oauthErrorMessage(code: string, email?: string): string {
  switch (code) {
    case 'state_mismatch':
      return 'Connect attempt expired or was interfered with. Try again.'
    case 'no_refresh_token':
      return 'Google did not return a refresh token. Try again; if it keeps failing, remove the app at https://myaccount.google.com/permissions and reconnect.'
    case 'no_user_email':
      return 'Could not determine your Google email. Try again.'
    case 'no_admin_for_email':
      return `You connected as ${email ?? 'that Google account'}, but that email doesn't match any Knit admin. Sign in to Knit with that same email first (or use a Google account whose email matches your Knit admin email).`
    default:
      return `Connect failed: ${code}`
  }
}

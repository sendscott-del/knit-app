import { useEffect, useState, type FormEvent } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { useWardOptions } from '@/lib/wardOptions'
import { canEdit, isWardScoped } from '@/lib/roles'
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
  const { t } = useTranslation('common')
  const { wards, loading: wardsLoading } = useWardOptions(profile)
  const [search, setSearch] = useSearchParams()

  const [wardId, setWardId] = useState<string>(
    search.get('wardId') ??
      (isWardScoped(profile.role) && !profile.is_super_admin
        ? profile.ward_id ?? ''
        : ''),
  )
  const editor = canEdit(profile)
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
      setNotice(t('sheet.connected_as_email', { email }))
      search.delete('connected')
      search.delete('email')
      setSearch(search, { replace: true })
    } else if (errorCode) {
      setErr(oauthErrorMessage(errorCode, email ?? undefined, t))
      search.delete('error')
      search.delete('email')
      setSearch(search, { replace: true })
    }
  }, [search, setSearch, t])

  async function loadStatus() {
    setLoadingStatus(true)
    try {
      const r = await authorizedFetch('/api/admin/google?action=status')
      const body = (await r.json()) as OAuthStatus
      setOauthStatus(body)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('sheet.status_load_failed'))
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
        `/api/admin/sheet?action=get&wardId=${encodeURIComponent(wardId)}`,
      )
      const body = await r.json()
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      setBinding(body.binding as BindingRow | null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('sheet.binding_load_failed'))
    } finally {
      setLoadingBinding(false)
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  useEffect(() => {
    void loadBinding()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardId])

  async function connect() {
    setBusy(true)
    setErr(null)
    setNotice(null)
    try {
      const r = await authorizedFetch('/api/admin/google', {
        method: 'POST',
        body: JSON.stringify({ action: 'authorize' }),
      })
      const body = await r.json()
      if (!r.ok || !body.url) throw new Error(body.error ?? t('sheet.connect_failed'))
      window.location.href = body.url
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('sheet.connect_failed'))
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!confirm(t('sheet.disconnect_confirm'))) return
    setBusy(true)
    setErr(null)
    try {
      const r = await authorizedFetch('/api/admin/google', {
        method: 'POST',
        body: JSON.stringify({ action: 'disconnect' }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setNotice(t('sheet.disconnected'))
      await loadStatus()
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('sheet.disconnect_failed'))
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
      setErr(t('sheet.pick_ward_first'))
      return
    }
    setBusy(true)
    setErr(null)
    setNotice(null)
    try {
      const r = await authorizedFetch('/api/admin/sheet', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', wardId, emails }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      setNotice(t('sheet.sheet_created'))
      setEmailInput('')
      await loadBinding()
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('sheet.create_failed'))
    } finally {
      setBusy(false)
    }
  }

  async function syncBoth() {
    if (!wardId) return
    setBusy(true)
    setErr(null)
    setNotice(null)
    try {
      await pullThenRefresh(wardId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('sheet.sync_failed'))
    } finally {
      setBusy(false)
    }
  }

  async function pullThenRefresh(wardId: string) {
    const pullRes = await authorizedFetch('/api/admin/sheet', {
      method: 'POST',
      body: JSON.stringify({ action: 'sync_now', wardId }),
    })
    const pullBody = await pullRes.json()
    if (!pullRes.ok) throw new Error(pullBody.error ?? `HTTP ${pullRes.status}`)
    const rep = (pullBody.report ?? {}) as {
      suggestionsProcessed?: number
      suggestionErrors?: string[]
      outingsInserted?: number
      outingErrors?: string[]
      feedbackProcessed?: number
      feedbackErrors?: string[]
      friendsInserted?: number
      friendErrors?: string[]
      friendsRemoved?: number
      friendRemovalErrors?: string[]
      headersRepaired?: string[]
    }

    const refreshRes = await authorizedFetch('/api/admin/sheet', {
      method: 'POST',
      body: JSON.stringify({ action: 'refresh', wardId }),
    })
    if (!refreshRes.ok) {
      const body = await refreshRes.json().catch(() => null)
      throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${refreshRes.status}`)
    }

    const parts: string[] = []
    if ((rep.friendsInserted ?? 0) > 0)
      parts.push(t('sheet.report.friends_added', { count: rep.friendsInserted }))
    if ((rep.friendsRemoved ?? 0) > 0)
      parts.push(t('sheet.report.friends_removed', { count: rep.friendsRemoved }))
    if ((rep.suggestionsProcessed ?? 0) > 0)
      parts.push(t('sheet.report.suggestions_filled', { count: rep.suggestionsProcessed }))
    if ((rep.outingsInserted ?? 0) > 0)
      parts.push(t('sheet.report.outings_logged', { count: rep.outingsInserted }))
    if ((rep.feedbackProcessed ?? 0) > 0)
      parts.push(t('sheet.report.feedback_received', { count: rep.feedbackProcessed }))
    if ((rep.headersRepaired ?? []).length > 0)
      parts.push(t('sheet.report.headers_restored', { tabs: (rep.headersRepaired ?? []).join(', ') }))
    if (parts.length === 0) parts.push(t('sheet.sheet_up_to_date'))
    const errs = [
      ...(rep.suggestionErrors ?? []),
      ...(rep.outingErrors ?? []),
      ...(rep.feedbackErrors ?? []),
      ...(rep.friendErrors ?? []),
      ...(rep.friendRemovalErrors ?? []),
    ]
    if (errs.length > 0)
      parts.push(t('sheet.report.issues', { count: errs.length, detail: errs.slice(0, 3).join('; ') }))
    setNotice(parts.join(' · '))
    await loadBinding()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('sheet.page_title')}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {t('sheet.page_subtitle')}
        </p>
      </div>

      {wards.length > 1 ? (
        <div className="rounded-md border border-gray-200 bg-white p-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-gray-700">{t('ward')}</span>
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

      {!editor ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          {t('sheet.view_only_note')}
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
        busy={busy || !editor}
        editor={editor}
        onConnect={() => void connect()}
        onDisconnect={() => void disconnect()}
      />

      {/* ---- Per-ward binding ---- */}
      {loadingBinding ? (
        <div className="text-sm text-gray-500">{t('sheet.loading_status')}</div>
      ) : binding && binding.sheet_id ? (
        <BoundCard
          binding={binding}
          onSync={() => void syncBoth()}
          onShare={async (emails) => {
            const r = await authorizedFetch('/api/admin/sheet', {
              method: 'POST',
              body: JSON.stringify({ action: 'share_emails', wardId, emails }),
            })
            const body = await r.json()
            if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
            const added = (body.added ?? []) as string[]
            const already = (body.already_shared ?? []) as string[]
            const errs = (body.errors ?? []) as Array<{ email: string; error: string }>
            const parts: string[] = []
            if (added.length > 0)
              parts.push(t('sheet.shared_with', { list: added.join(', ') }))
            if (already.length > 0)
              parts.push(t('sheet.already_had', { list: already.join(', ') }))
            if (errs.length > 0) {
              const detail = errs.slice(0, 3).map((e) => `${e.email}: ${e.error}`).join(' · ')
              setErr(
                t('sheet.n_failed', { count: errs.length, detail: detail + (errs.length > 3 ? t('sheet.ellipsis_more') : '') }),
              )
              setNotice(parts.length > 0 ? parts.join(' · ') : null)
            } else {
              setNotice(parts.join(' · ') || t('sheet.no_changes'))
            }
            await loadBinding()
          }}
          onRevoke={async (email) => {
            if (!confirm(t('sheet.remove_email_confirm', { email }))) return
            const r = await authorizedFetch('/api/admin/sheet', {
              method: 'POST',
              body: JSON.stringify({ action: 'unshare_email', wardId, email }),
            })
            const body = await r.json()
            if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
            setNotice(t('sheet.removed_email', { email }))
            await loadBinding()
          }}
          onShareAdmins={async () => {
            const r = await authorizedFetch('/api/admin/sheet', {
              method: 'POST',
              body: JSON.stringify({ action: 'share_with_admins', wardId }),
            })
            const body = await r.json()
            if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
            const added = (body.added ?? []) as string[]
            const errs = (body.errors ?? []) as Array<{ email: string; error: string }>
            const parts: string[] = []
            if (added.length > 0) {
              parts.push(
                t('sheet.shared_with_n_admins', { count: added.length, list: added.join(', ') }),
              )
            }
            if (errs.length > 0) {
              const detail = errs.slice(0, 3).map((e) => `${e.email}: ${e.error}`).join(' · ')
              parts.push(
                t('sheet.n_failed', { count: errs.length, detail: detail + (errs.length > 3 ? t('sheet.ellipsis_more') : '') }),
              )
              setErr(parts.join(' · '))
              setNotice(null)
              await loadBinding()
              return
            }
            if (parts.length === 0) {
              parts.push(t('sheet.all_admins_have_access'))
            }
            setNotice(parts.join(' · '))
            await loadBinding()
          }}
          busy={busy || !editor}
          editor={editor}
        />
      ) : (
        <CreateSheetCard
          canCreate={(oauthStatus?.connected ?? false) && editor}
          emailInput={emailInput}
          onEmailChange={setEmailInput}
          onSubmit={(e) => void createSheet(e)}
          busy={busy || !editor}
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
  editor,
  onConnect,
  onDisconnect,
}: {
  loading: boolean
  status: OAuthStatus | null
  busy: boolean
  editor: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  const { t } = useTranslation('common')
  return (
    <div className="rounded-md border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-medium text-gray-900">{t('sheet.google_connection')}</h2>
          {loading ? (
            <p className="text-sm text-gray-500 mt-1">{t('sheet.checking')}</p>
          ) : status?.connected ? (
            <p className="text-sm text-gray-600 mt-1">
              <Trans
                i18nKey="sheet.connected_as"
                ns="common"
                values={{ email: status.email ?? '' }}
                components={{ strong: <strong /> }}
              />
              {status.granted_at ? (
                <span className="text-gray-400">
                  {t('sheet.since_date', { date: new Date(status.granted_at).toLocaleDateString() })}
                </span>
              ) : null}
              {t('sheet.new_sheets_drive')}
            </p>
          ) : (
            <p className="text-sm text-gray-600 mt-1">
              {t('sheet.not_connected')}
            </p>
          )}
        </div>
        {!loading && editor ? (
          status?.connected ? (
            <button
              onClick={onDisconnect}
              disabled={busy}
              className="rounded-md border-[1.5px] border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 whitespace-nowrap"
            >
              {t('sheet.disconnect')}
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={busy}
              className="btn-primary text-sm py-2 px-4 whitespace-nowrap"
            >
              {t('sheet.connect_google')}
            </button>
          )
        ) : null}
      </div>
    </div>
  )
}

function BoundCard({
  binding,
  onSync,
  onShare,
  onRevoke,
  onShareAdmins,
  busy,
  editor,
}: {
  binding: BindingRow
  onSync: () => void
  onShare: (emails: string[]) => Promise<void>
  onRevoke: (email: string) => Promise<void>
  onShareAdmins: () => Promise<void>
  busy: boolean
  editor: boolean
}) {
  const { t } = useTranslation('common')
  const [addEmails, setAddEmails] = useState('')
  const [sharing, setSharing] = useState(false)
  const [shareErr, setShareErr] = useState<string | null>(null)

  async function submitShare(e: FormEvent) {
    e.preventDefault()
    const emails = addEmails
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes('@'))
    if (emails.length === 0) {
      setShareErr(t('sheet.add_at_least_one_email'))
      return
    }
    setSharing(true)
    setShareErr(null)
    try {
      await onShare(emails)
      setAddEmails('')
    } catch (err) {
      setShareErr(err instanceof Error ? err.message : t('sheet.share_failed'))
    } finally {
      setSharing(false)
    }
  }

  async function submitRevoke(email: string) {
    setSharing(true)
    setShareErr(null)
    try {
      await onRevoke(email)
    } catch (err) {
      setShareErr(err instanceof Error ? err.message : t('sheet.remove_failed'))
    } finally {
      setSharing(false)
    }
  }

  async function submitShareAdmins() {
    setSharing(true)
    setShareErr(null)
    try {
      await onShareAdmins()
    } catch (err) {
      setShareErr(err instanceof Error ? err.message : t('sheet.share_admins_failed'))
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-medium text-gray-900">{t('sheet.sheet_bound_title')}</h2>
          <p className="text-sm text-gray-600 mt-1">
            {t('sheet.status_label')} <StatusBadge status={binding.status as 'healthy' | 'error' | 'not_configured'} />
          </p>
        </div>
        <a
          href={binding.sheet_url ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border-[1.5px] border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 whitespace-nowrap"
        >
          {t('sheet.open_sheet')}
        </a>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Meta label={t('sheet.last_push')}>
          {binding.last_push_at
            ? new Date(binding.last_push_at).toLocaleString()
            : t('dash')}
        </Meta>
        <Meta label={t('sheet.last_pull')}>
          {binding.last_pull_at
            ? new Date(binding.last_pull_at).toLocaleString()
            : t('sheet.never')}
        </Meta>
        {binding.last_error ? (
          <Meta label={t('sheet.last_error')}>
            <span className="text-error">{binding.last_error}</span>
          </Meta>
        ) : null}
      </dl>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          onClick={onSync}
          disabled={busy}
          className="btn-primary text-sm py-2 px-4"
        >
          {busy ? t('sheet.syncing') : t('sheet.sync_now')}
        </button>
      </div>
      <p className="text-xs text-gray-500 pt-1">
        {t('sheet.sync_explain')}
      </p>

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div>
          <h3 className="font-medium text-gray-900 text-sm">{t('sheet.who_has_access')}</h3>
          <p className="text-xs text-gray-500 mt-1">
            {t('sheet.access_intro')}
          </p>
        </div>
        {(binding.shared_emails ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">
            {t('sheet.nobody_added')}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {(binding.shared_emails ?? []).map((email) => (
              <li
                key={email}
                className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-800"
              >
                <span className="font-mono">{email}</span>
                {editor ? (
                  <button
                    type="button"
                    onClick={() => void submitRevoke(email)}
                    disabled={sharing || busy}
                    className="text-gray-500 hover:text-rose-600 disabled:opacity-40"
                    aria-label={t('sheet.remove_email_aria', { email })}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editor ? (
          <>
            <form onSubmit={submitShare} className="space-y-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-gray-700">
                  {t('sheet.add_emails_label')}
                </span>
                <textarea
                  value={addEmails}
                  onChange={(e) => setAddEmails(e.target.value)}
                  rows={2}
                  placeholder={t('sheet.emails_placeholder')}
                  className="form-input font-mono text-sm"
                  disabled={sharing || busy}
                />
              </label>
              {shareErr ? (
                <p className="text-xs text-error">{shareErr}</p>
              ) : null}
              <button
                type="submit"
                disabled={sharing || busy || addEmails.trim().length === 0}
                className="btn-primary text-sm py-1.5 px-3"
              >
                {sharing ? t('sheet.sharing') : t('sheet.share_sheet')}
              </button>
            </form>
            <div className="border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => void submitShareAdmins()}
                disabled={sharing || busy}
                className="rounded-md border-[1.5px] border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                {t('sheet.share_with_admins')}
              </button>
              <p className="text-xs text-gray-500 mt-1.5">
                {t('sheet.share_admins_explain')}
              </p>
            </div>
          </>
        ) : null}
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
  const { t } = useTranslation('common')
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-gray-200 bg-white p-5 space-y-4"
    >
      {binding && binding.status === 'error' ? (
        <div className="rounded-md border border-error/30 bg-error/5 p-3 text-sm text-gray-900">
          {t('sheet.previous_failed', { detail: binding.last_error })}
        </div>
      ) : null}
      <div>
        <h2 className="font-medium text-gray-900">{t('sheet.create_for_ward')}</h2>
        <p className="text-sm text-gray-600 mt-1">
          {canCreate ? t('sheet.create_intro_can') : t('sheet.create_intro_cannot')}
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-gray-700">
          {t('sheet.missionary_gmails')}
        </span>
        <textarea
          value={emailInput}
          onChange={(e) => onEmailChange(e.target.value)}
          rows={3}
          placeholder={t('sheet.emails_placeholder')}
          className="form-input font-mono text-sm"
        />
        <span className="text-xs text-gray-500">
          {t('sheet.emails_hint')}
        </span>
      </label>
      <button
        type="submit"
        disabled={busy || disabled || !canCreate}
        className="btn-primary text-sm py-2 px-4"
      >
        {busy ? t('sheet.creating') : t('sheet.create_and_share')}
      </button>
    </form>
  )
}

function StatusBadge({ status }: { status: 'healthy' | 'error' | 'not_configured' }) {
  const { t } = useTranslation('common')
  const palette = {
    healthy: 'bg-emerald-100 text-emerald-800',
    error: 'bg-rose-100 text-rose-800',
    not_configured: 'bg-gray-100 text-gray-700',
  }
  const label =
    status === 'healthy'
      ? t('sheet.status_healthy')
      : status === 'error'
        ? t('sheet.status_error')
        : t('sheet.status_not_configured')
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

function oauthErrorMessage(
  code: string,
  email: string | undefined,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  switch (code) {
    case 'state_mismatch':
      return t('sheet.oauth_err_state')
    case 'no_refresh_token':
      return t('sheet.oauth_err_no_refresh')
    case 'no_user_email':
      return t('sheet.oauth_err_no_email')
    case 'no_admin_for_email':
      return t('sheet.oauth_err_no_admin', { email: email ?? t('sheet.oauth_err_no_admin_default') })
    default:
      return t('sheet.oauth_err_default', { code })
  }
}

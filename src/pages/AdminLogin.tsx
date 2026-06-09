import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import KnitMark from '@/components/KnitMark'

type Mode = 'link' | 'password'

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

export default function AdminLogin() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation('common')
  const [mode, setMode] = useState<Mode>('link')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  if (loading) return <CenteredNote>{t('loading')}</CenteredNote>
  if (session) return <Navigate to="/admin" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email) return
    setStatus({ kind: 'sending' })
    if (mode === 'link') {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/admin/callback` },
      })
      if (error) setStatus({ kind: 'error', message: error.message })
      else setStatus({ kind: 'sent' })
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setStatus({ kind: 'error', message: error.message })
      else navigate('/admin', { replace: true })
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      {/* Suite auth-screen pattern: navy hero up top, white card below */}
      <div className="bg-brand-primary text-white">
        <div className="max-w-md mx-auto px-6 pt-14 pb-24 text-center">
          <Link to="/" className="inline-flex flex-col items-center gap-3">
            <KnitMark size={44} />
            <span className="text-2xl font-semibold tracking-tight">{t('app_name')}</span>
          </Link>
          <p className="text-base text-brand-primary-fade mt-4">{t('login.leader_sign_in')}</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 -mt-12 pb-12 w-full">
        <div className="suite-card p-6 sm:p-8 space-y-5">
          <div className="inline-flex rounded-md bg-gray-100 p-0.5 text-xs font-bold">
            <button
              type="button"
              onClick={() => { setMode('link'); setStatus({ kind: 'idle' }) }}
              className={`px-3 py-1 rounded ${mode === 'link' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
            >
              {t('login.email_link')}
            </button>
            <button
              type="button"
              onClick={() => { setMode('password'); setStatus({ kind: 'idle' }) }}
              className={`px-3 py-1 rounded ${mode === 'password' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
            >
              {t('login.password')}
            </button>
          </div>

          {status.kind === 'sent' ? (
            <div className="rounded-md border border-success/30 bg-success/5 p-5 space-y-2">
              <h2 className="text-lg font-semibold text-gray-900">{t('login.check_email_title')}</h2>
              <p className="text-base text-gray-700">
                <Trans
                  i18nKey="login.check_email_body"
                  ns="common"
                  values={{ email }}
                  components={{ strong: <strong /> }}
                />
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-gray-700">{t('signup.email')}</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                  placeholder={t('signup.email_placeholder')}
                />
              </label>
              {mode === 'password' && (
                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-gray-700">{t('login.password')}</span>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="form-input"
                  />
                </label>
              )}
              <button type="submit" disabled={status.kind === 'sending'} className="btn-primary w-full">
                {status.kind === 'sending'
                  ? t('login.working')
                  : mode === 'link'
                    ? t('login.email_me_link')
                    : t('login.sign_in')}
              </button>
              {mode === 'password' && (
                <p className="text-center text-sm">
                  <Link to="/forgot-password" className="text-knit-primary font-semibold underline">
                    {t('login.forgot_password')}
                  </Link>
                </p>
              )}
              {status.kind === 'error' ? (
                <p className="text-sm text-error">{status.message}</p>
              ) : null}
            </form>
          )}
        </div>

        <p className="text-sm text-gray-600 text-center pt-6">
          {t('login.no_access')}{' '}
          <Link to="/signup" className="text-knit-primary font-semibold underline">
            {t('login.get_access')}
          </Link>
        </p>
        <p className="text-xs text-gray-500 text-center pt-2">
          {t('login.members_no_signin')}
        </p>
        <p className="text-xs text-gray-400 text-center pt-4">
          {t('login.disclaimer')}
        </p>
      </div>
    </main>
  )
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-gray-500">
      {children}
    </main>
  )
}

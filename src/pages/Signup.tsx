import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import KnitMark from '@/components/KnitMark'

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

export default function Signup() {
  const { session, loading } = useAuth()
  const { t } = useTranslation('common')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  if (loading) return <CenteredNote>{t('loading')}</CenteredNote>
  if (session) return <Navigate to="/admin" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setStatus({ kind: 'error', message: t('signup.passwords_no_match') })
      return
    }
    if (password.length < 6) {
      setStatus({ kind: 'error', message: t('signup.password_too_short') })
      return
    }
    setStatus({ kind: 'sending' })
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/admin/callback`,
        data: { app: 'knit' },
      },
    })
    if (error) setStatus({ kind: 'error', message: error.message })
    else setStatus({ kind: 'sent' })
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-brand-primary text-white">
        <div className="max-w-md mx-auto px-6 pt-14 pb-24 text-center">
          <Link to="/" className="inline-flex flex-col items-center gap-3">
            <KnitMark size={44} />
            <span className="text-2xl font-semibold tracking-tight">{t('app_name')}</span>
          </Link>
          <p className="text-base text-brand-primary-fade mt-4">{t('signup.page_title')}</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 -mt-12 pb-12 w-full">
        <div className="suite-card p-6 sm:p-8 space-y-6">
          {status.kind === 'sent' ? (
            <div className="rounded-md border border-success/30 bg-success/5 p-5 space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">{t('signup.check_email_title')}</h2>
              <p className="text-base text-gray-700">
                <Trans
                  i18nKey="signup.check_email_body"
                  ns="common"
                  values={{ email }}
                  components={{ strong: <strong /> }}
                />
              </p>
              <p className="text-sm text-gray-600">
                {t('signup.after_confirm')}
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-gray-700">
                {t('signup.intro')}
              </p>
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
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-gray-700">{t('signup.password')}</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="form-input"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-gray-700">{t('signup.confirm_password')}</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="form-input"
                />
              </label>
              <button type="submit" disabled={status.kind === 'sending'} className="btn-primary w-full">
                {status.kind === 'sending' ? t('signup.creating') : t('signup.create_account')}
              </button>
              {status.kind === 'error' ? (
                <p className="text-sm text-error">{status.message}</p>
              ) : null}
              <p className="text-center text-sm text-gray-500">
                {t('signup.already_have_account')}{' '}
                <Link to="/admin/login" className="text-knit-primary font-semibold underline">
                  {t('sign_in')}
                </Link>
              </p>
            </form>
          )}

          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs text-gray-500 text-center">
              {t('signup.members_no_signup')}{' '}
              <Link to="/me" className="text-knit-primary underline font-semibold">/me</Link>
              {' '}page.
            </p>
          </div>
        </div>
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

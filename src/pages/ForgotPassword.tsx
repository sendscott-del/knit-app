import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import KnitMark from '@/components/KnitMark'

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

export default function ForgotPassword() {
  const { t } = useTranslation('common')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setStatus({ kind: 'sending' })
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
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
          <p className="text-base text-brand-primary-fade mt-4">{t('forgot_password.page_title')}</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 -mt-12 pb-12 w-full">
        <div className="suite-card p-6 sm:p-8 space-y-5">
          {status.kind === 'sent' ? (
            <div className="rounded-md border border-success/30 bg-success/5 p-5 space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">{t('forgot_password.check_email_title')}</h2>
              <p className="text-base text-gray-700">
                <Trans
                  i18nKey="forgot_password.check_email_body"
                  ns="common"
                  values={{ email }}
                  components={{ strong: <strong /> }}
                />
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-gray-700">
                {t('forgot_password.intro')}
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
              <button type="submit" disabled={status.kind === 'sending'} className="btn-primary w-full">
                {status.kind === 'sending' ? t('forgot_password.sending') : t('forgot_password.send_reset_link')}
              </button>
              {status.kind === 'error' ? (
                <p className="text-sm text-error">{status.message}</p>
              ) : null}
              <p className="text-center text-sm">
                <Link to="/admin/login" className="text-knit-primary font-semibold underline">
                  {t('forgot_password.back_to_sign_in')}
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}

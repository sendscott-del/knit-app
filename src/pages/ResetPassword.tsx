import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import KnitMark from '@/components/KnitMark'

export default function ResetPassword() {
  const navigate = useNavigate()
  const { t } = useTranslation('common')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState<boolean | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session))
  }, [])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError(t('reset_password.passwords_no_match'))
      return
    }
    if (password.length < 6) {
      setError(t('reset_password.password_too_short'))
      return
    }
    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (error) setError(error.message)
    else navigate('/admin', { replace: true })
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-brand-primary text-white">
        <div className="max-w-md mx-auto px-6 pt-14 pb-24 text-center">
          <KnitMark size={44} />
          <p className="text-2xl font-semibold tracking-tight mt-3">{t('app_name')}</p>
          <p className="text-base text-brand-primary-fade mt-4">{t('reset_password.page_title')}</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 -mt-12 pb-12 w-full">
        <div className="suite-card p-6 sm:p-8">
          {ready === null ? (
            <p className="text-sm text-gray-500">{t('loading')}</p>
          ) : !ready ? (
            <p className="text-sm text-gray-700">
              {t('reset_password.needs_email_link')}
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-gray-700">{t('reset_password.new_password')}</span>
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
                <span className="text-sm font-semibold text-gray-700">{t('reset_password.confirm_password')}</span>
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
              {error && <p className="text-sm text-error">{error}</p>}
              <button type="submit" disabled={submitting} className="btn-primary w-full">
                {submitting ? t('saving') : t('reset_password.update_password')}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}

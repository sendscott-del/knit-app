import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import KnitMark from '@/components/KnitMark'

export default function ResetPassword() {
  const navigate = useNavigate()
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
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
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
        <div className="max-w-md mx-auto px-6 pt-16 pb-20 text-center">
          <KnitMark size={56} />
          <p className="text-2xl font-semibold tracking-tight mt-3">Knit</p>
          <p className="text-base text-brand-primary-fade mt-4">Choose a new password</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 -mt-12 pb-12 w-full">
        <div className="suite-card p-6 sm:p-8">
          {ready === null ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : !ready ? (
            <p className="text-sm text-gray-700">
              This page only works from a password reset email link. Please use the link sent to your inbox.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-gray-700">New password</span>
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
                <span className="text-sm font-semibold text-gray-700">Confirm password</span>
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
                {submitting ? 'Saving…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import KnitMark from '@/components/KnitMark'

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

export default function ForgotPassword() {
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
        <div className="max-w-md mx-auto px-6 pt-16 pb-20 text-center">
          <Link to="/" className="inline-flex flex-col items-center gap-3">
            <KnitMark size={56} />
            <span className="text-2xl font-semibold tracking-tight">Knit</span>
          </Link>
          <p className="text-base text-brand-primary-fade mt-4">Reset your password</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 -mt-12 pb-12 w-full">
        <div className="suite-card p-6 sm:p-8 space-y-5">
          {status.kind === 'sent' ? (
            <div className="rounded-md border border-success/30 bg-success/5 p-5 space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">Check your email</h2>
              <p className="text-base text-gray-700">
                We sent a password reset link to <strong>{email}</strong>. Tap it from the same browser.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-gray-700">
                Enter your email and we&rsquo;ll send you a link to reset your password.
              </p>
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-gray-700">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                  placeholder="you@example.com"
                />
              </label>
              <button type="submit" disabled={status.kind === 'sending'} className="btn-primary w-full">
                {status.kind === 'sending' ? 'Sending…' : 'Send reset link'}
              </button>
              {status.kind === 'error' ? (
                <p className="text-sm text-error">{status.message}</p>
              ) : null}
              <p className="text-center text-sm">
                <Link to="/admin/login" className="text-knit-primary font-semibold underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}

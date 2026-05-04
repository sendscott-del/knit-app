import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  if (loading) return <CenteredNote>Loading…</CenteredNote>
  if (session) return <Navigate to="/admin" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setStatus({ kind: 'error', message: 'Passwords do not match.' })
      return
    }
    if (password.length < 6) {
      setStatus({ kind: 'error', message: 'Password must be at least 6 characters.' })
      return
    }
    setStatus({ kind: 'sending' })
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/admin/callback` },
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
            <span className="text-2xl font-semibold tracking-tight">Knit</span>
          </Link>
          <p className="text-base text-brand-primary-fade mt-4">Create your leader account</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 -mt-12 pb-12 w-full">
        <div className="suite-card p-6 sm:p-8 space-y-6">
          {status.kind === 'sent' ? (
            <div className="rounded-md border border-success/30 bg-success/5 p-5 space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">Check your email</h2>
              <p className="text-base text-gray-700">
                We sent a confirmation link to <strong>{email}</strong>. Tap it from the same browser
                you opened this page in.
              </p>
              <p className="text-sm text-gray-600">
                After you confirm, ask your stake&rsquo;s missionary high councilor to add you as a
                Ward Mission Leader (or Stake President to add another stake leader). You&rsquo;ll
                see Knit data once they&rsquo;ve granted you a role.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-gray-700">
                Knit accepts both email magic-link and email + password sign-in. Pick a password
                here if you&rsquo;d rather not wait for an email link each time.
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
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-gray-700">Password</span>
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
              <button type="submit" disabled={status.kind === 'sending'} className="btn-primary w-full">
                {status.kind === 'sending' ? 'Creating…' : 'Create account'}
              </button>
              {status.kind === 'error' ? (
                <p className="text-sm text-error">{status.message}</p>
              ) : null}
              <p className="text-center text-sm text-gray-500">
                Already have an account?{' '}
                <Link to="/admin/login" className="text-knit-primary font-semibold underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}

          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs text-gray-500 text-center">
              Members &mdash; don&rsquo;t sign up here. The Ward Mission Leader will text you a
              personal link to your <Link to="/me" className="text-knit-primary underline font-semibold">/me</Link>
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

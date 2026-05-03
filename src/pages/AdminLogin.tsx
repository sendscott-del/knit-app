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

export default function AdminLogin() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  if (loading) return <CenteredNote>Loading…</CenteredNote>
  if (session) return <Navigate to="/admin" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email) return
    setStatus({ kind: 'sending' })
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/admin/callback`,
      },
    })
    if (error) {
      setStatus({ kind: 'error', message: error.message })
    } else {
      setStatus({ kind: 'sent' })
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      {/* Suite auth-screen pattern: navy hero up top, white card below */}
      <div className="bg-brand-primary text-white">
        <div className="max-w-md mx-auto px-6 pt-16 pb-20 text-center">
          <Link to="/" className="inline-flex flex-col items-center gap-3">
            <KnitMark size={56} />
            <span className="text-2xl font-semibold tracking-tight">Knit</span>
          </Link>
          <p className="text-base text-brand-primary-fade mt-4">Leader sign in</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 -mt-12 pb-12 w-full">
        <div className="suite-card p-6 sm:p-8 space-y-5">
          {status.kind === 'sent' ? (
            <div className="rounded-md border border-success/30 bg-success/5 p-5 space-y-2">
              <h2 className="text-lg font-semibold text-gray-900">Check your email</h2>
              <p className="text-base text-gray-700">
                We sent a sign-in link to <strong>{email}</strong>. Tap it from the
                same browser you opened this page in.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
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
                {status.kind === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
              </button>
              {status.kind === 'error' ? (
                <p className="text-sm text-error">{status.message}</p>
              ) : null}
            </form>
          )}
        </div>

        <p className="text-xs text-gray-500 text-center pt-6">
          Members — don't sign in here. Use the link we texted you.
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

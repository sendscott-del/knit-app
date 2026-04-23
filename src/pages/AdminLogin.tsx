import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'

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
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Link to="/" className="text-4xl font-semibold text-slate-900 tracking-tight block">
            Knit
          </Link>
          <p className="text-slate-600">Leader sign in</p>
        </div>

        {status.kind === 'sent' ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 space-y-2">
            <h2 className="text-lg font-medium text-emerald-900">Check your email</h2>
            <p className="text-sm text-emerald-800">
              We sent a sign-in link to <strong>{email}</strong>. Tap it from the
              same browser you opened this page in.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-base focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                placeholder="you@example.com"
              />
            </label>
            <button
              type="submit"
              disabled={status.kind === 'sending'}
              className="w-full rounded-lg bg-slate-900 text-white px-4 py-3 text-base font-medium hover:bg-slate-800 transition disabled:opacity-50"
            >
              {status.kind === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            {status.kind === 'error' ? (
              <p className="text-sm text-rose-700">{status.message}</p>
            ) : null}
          </form>
        )}

        <p className="text-xs text-slate-500 text-center">
          Members — don't sign in here. Use the link we texted you.
        </p>
      </div>
    </main>
  )
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-500">
      {children}
    </main>
  )
}

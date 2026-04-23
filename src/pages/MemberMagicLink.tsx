import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { writeMemberAuth } from '@/lib/memberAuth'

type Status = { kind: 'verifying' } | { kind: 'error'; message: string }

export default function MemberMagicLink() {
  const { memberId, token } = useParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>({ kind: 'verifying' })

  useEffect(() => {
    if (!memberId || !token) {
      setStatus({ kind: 'error', message: 'This link is missing its member id or token.' })
      return
    }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc('knit_member_self_read', {
        p_member_id: memberId,
        p_token: token,
      })
      if (cancelled) return
      if (error || !data) {
        setStatus({
          kind: 'error',
          message:
            error?.message ??
            "We couldn't verify this link. It may have expired or been replaced.",
        })
        return
      }
      writeMemberAuth({ memberId, token })
      navigate('/me', { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [memberId, token, navigate])

  if (status.kind === 'verifying') {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-600">
        Verifying your link…
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Sign-in link didn't work</h1>
        <p className="text-slate-600">{status.message}</p>
        <p className="text-sm text-slate-500">
          Ask your ward mission leader to send you a fresh link.
        </p>
        <Link to="/" className="inline-block text-slate-700 underline">
          Go home
        </Link>
      </div>
    </main>
  )
}

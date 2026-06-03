import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { writeMemberAuth } from '@/lib/memberAuth'

type Status = { kind: 'verifying' } | { kind: 'error'; message: string }

export default function MemberMagicLink() {
  const { memberId, token } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<Status>({ kind: 'verifying' })

  useEffect(() => {
    if (!memberId || !token) {
      setStatus({ kind: 'error', message: t('magic_link.missing_token') })
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
            error?.message ?? t('magic_link.could_not_verify'),
        })
        return
      }
      writeMemberAuth({ memberId, token })
      navigate('/me', { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [memberId, token, navigate, t])

  if (status.kind === 'verifying') {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-gray-600">
        {t('magic_link.verifying')}
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900">{t('magic_link.title_failed')}</h1>
        <p className="text-gray-600">{status.message}</p>
        <p className="text-sm text-gray-500">
          {t('magic_link.ask_for_fresh')}
        </p>
        <Link to="/" className="inline-block text-gray-700 underline">
          {t('go_home')}
        </Link>
      </div>
    </main>
  )
}

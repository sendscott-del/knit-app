import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'

export default function AdminCallback() {
  const { session, loading } = useAuth()
  const { t } = useTranslation('common')

  useEffect(() => {
    // Supabase JS auto-consumes the hash (#access_token=...) on load.
    // Clean the URL if the tokens are still present after the session settled.
    if (!loading && session && window.location.hash) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [loading, session])

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">
        {t('callback.signing_in')}
      </main>
    )
  }

  if (session) return <Navigate to="/admin" replace />
  return <Navigate to="/admin/login" replace />
}

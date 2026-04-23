import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CURRENT_VERSION } from '@/constants/changelog'

export default function Landing() {
  const { t } = useTranslation('common')
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-lg text-center space-y-6">
        <h1 className="text-6xl font-semibold text-slate-900 tracking-tight">
          {t('app_name')}
        </h1>
        <p className="text-lg text-slate-600 italic">"{t('tagline')}"</p>
        <p className="text-base text-slate-500 max-w-md mx-auto">
          A fellowship-matching app that helps ward members form lasting
          friendships with the people the missionaries are teaching.
        </p>
        <div className="pt-4">
          <Link
            to="/admin/login"
            className="inline-block px-6 py-3 rounded-lg bg-slate-900 text-white text-base font-medium hover:bg-slate-800 transition"
          >
            Leader sign in
          </Link>
        </div>
        <p className="text-xs text-slate-400 pt-8">v{CURRENT_VERSION}</p>
      </div>
    </main>
  )
}

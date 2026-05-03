import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CURRENT_VERSION } from '@/constants/changelog'
import KnitMark from '@/components/KnitMark'

export default function Landing() {
  const { t } = useTranslation('common')
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      {/* Navy hero — matches the suite auth-screen pattern */}
      <div className="bg-brand-primary text-white">
        <div className="max-w-3xl mx-auto px-6 pt-16 pb-24 text-center">
          <div className="flex justify-center mb-6">
            <KnitMark size={64} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight mb-3">{t('app_name')}</h1>
          <p className="text-lg text-brand-primary-fade italic">"{t('tagline')}"</p>
        </div>
      </div>

      {/* White card sitting on top of the hero */}
      <div className="max-w-xl mx-auto px-6 -mt-12 pb-12 w-full">
        <div className="suite-card p-8 text-center space-y-6">
          <p className="text-base text-gray-700 leading-relaxed">
            A fellowship-matching app that helps ward members form lasting friendships
            with the people the missionaries are teaching.
          </p>
          <div className="pt-2">
            <Link to="/admin/login" className="btn-primary w-full sm:w-auto">
              Leader sign in
            </Link>
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center pt-6">v{CURRENT_VERSION}</p>
      </div>
    </main>
  )
}

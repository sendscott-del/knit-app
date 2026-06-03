import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import KnitMark from '@/components/KnitMark'

export default function NotFound() {
  const { t } = useTranslation('common')
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <KnitMark size={48} />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('not_found.title')}</h1>
        <p className="text-base text-gray-600">{t('not_found.body')}</p>
        <Link to="/" className="btn-outline mt-2">
          {t('go_home')}
        </Link>
      </div>
    </main>
  )
}

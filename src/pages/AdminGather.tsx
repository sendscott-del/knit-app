import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

// Gather now has its own standalone deployment — one canonical place to
// manage user access across all five apps. This route stays as a redirect so
// old bookmarks and the previous admin-nav entry still land somewhere useful.
// The nav link in AdminLayout now points to the canonical URL directly,
// so a click from inside Knit skips this hop.
const CANONICAL_URL = 'https://gathered-admin-neon.vercel.app/gather'

export default function AdminGather() {
  const { t } = useTranslation('common')
  useEffect(() => {
    window.location.replace(CANONICAL_URL)
  }, [])

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-lg font-bold text-gray-900">{t('gather_redirect.title')}</h1>
        <p className="text-sm text-gray-600">
          {t('gather_redirect.body')}
        </p>
        <a
          href={CANONICAL_URL}
          className="inline-block text-sm font-medium text-rose-600 hover:underline"
        >
          {t('gather_redirect.open_link')}
        </a>
      </div>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { CHANGELOG } from '@/constants/changelog'

export default function AdminReleaseNotes() {
  const { t } = useTranslation('common')
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('release_notes.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t('release_notes.subtitle')}
        </p>
      </header>
      <div className="space-y-4">
        {CHANGELOG.map((entry) => (
          <article
            key={entry.version}
            className="rounded-lg border border-gray-200 bg-white p-5"
          >
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-base font-bold text-gray-900">v{entry.version}</h2>
              <div className="text-xs text-gray-500">{entry.date}</div>
            </div>
            <p className="text-sm text-gray-800 font-medium">{entry.summary}</p>
            {entry.details && entry.details.length > 0 ? (
              <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-gray-700">
                {entry.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  )
}

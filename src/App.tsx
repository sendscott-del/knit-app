import { useTranslation } from 'react-i18next'
import { CHANGELOG, CURRENT_VERSION } from '@/constants/changelog'

export default function App() {
  const { t } = useTranslation('common')
  const latest = CHANGELOG[0]
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-lg text-center space-y-4">
        <h1 className="text-6xl font-semibold text-slate-900 tracking-tight">
          {t('app_name')}
        </h1>
        <p className="text-lg text-slate-600 italic">"{t('tagline')}"</p>
        <p className="text-sm text-slate-500">
          {t('scaffold_ready')} — v{CURRENT_VERSION}
        </p>
        {latest ? (
          <p className="text-xs text-slate-400">{latest.summary}</p>
        ) : null}
      </div>
    </main>
  )
}

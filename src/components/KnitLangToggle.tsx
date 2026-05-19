import { useTranslation } from 'react-i18next'

/**
 * EN/ES toggle for Knit. Suite-consistent placement: sits in the persistent
 * top sub-bar (below the Gathered chrome and brand stripe) so language
 * switching is always one tap away from any admin screen — matches the
 * pattern in Tidings, Glean, Steward, and Magnify.
 */
export default function KnitLangToggle() {
  const { i18n } = useTranslation()
  const lang = (i18n.language || 'en').slice(0, 2) === 'es' ? 'es' : 'en'
  const set = (next: 'en' | 'es') => {
    void i18n.changeLanguage(next)
    try {
      localStorage.setItem('i18nextLng', next)
    } catch {
      /* localStorage may be blocked — i18next-browser-languagedetector still works. */
    }
  }
  return (
    <div className="flex items-center gap-1 text-[11px] font-semibold tracking-wide select-none">
      <button
        type="button"
        onClick={() => set('en')}
        aria-pressed={lang === 'en'}
        aria-label="English"
        className={lang === 'en' ? 'text-knit-primary' : 'text-gray-400 hover:text-gray-600'}
      >
        EN
      </button>
      <span className="text-gray-300">|</span>
      <button
        type="button"
        onClick={() => set('es')}
        aria-pressed={lang === 'es'}
        aria-label="Español"
        className={lang === 'es' ? 'text-knit-primary' : 'text-gray-400 hover:text-gray-600'}
      >
        ES
      </button>
    </div>
  )
}

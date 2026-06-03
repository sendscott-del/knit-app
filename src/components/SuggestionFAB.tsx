import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'

const SUBMIT_URL =
  'https://isogetmvnpimcmouakeg.supabase.co/functions/v1/submit-suggestion'

type Props = {
  /** When provided, parent controls modal open state. Used by the
   *  mobile More-sheet to open the modal without a floating button. */
  controlledOpen?: boolean
  onControlledClose?: () => void
}

export default function SuggestionFAB({
  controlledOpen,
  onControlledClose,
}: Props = {}) {
  const { t } = useTranslation('common')
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (v: boolean) => {
    if (controlledOpen !== undefined) {
      if (!v) onControlledClose?.()
    } else {
      setInternalOpen(v)
    }
  }
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [me, setMe] = useState<{ name: string | null; email: string | null; id: string | null }>({
    name: null,
    email: null,
    id: null,
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase.auth.getUser()
        if (cancelled) return
        const u = data.user
        if (u) {
          setMe({
            name:
              (u.user_metadata?.full_name as string) ??
              (u.user_metadata?.name as string) ??
              null,
            email: u.email ?? null,
            id: u.id,
          })
        }
      } catch {
        /* anonymous still allowed */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function submit() {
    if (!text.trim() || sending) return
    setSending(true)
    setErr(null)
    try {
      const res = await fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app: 'knit',
          suggestion: text.trim(),
          submittedByName: me.name,
          submittedByEmail: me.email,
          submittedByUserId: me.id,
          pageUrl: typeof window !== 'undefined' ? window.location.href : null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      setText('')
      setOpen(false)
      setSent(true)
      setTimeout(() => setSent(false), 3500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {sent && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold rounded-lg px-4 py-2 shadow flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          {t('suggest_fab.thanks')}
        </div>
      )}

      {/* Floating button is DESKTOP-ONLY now. On mobile the
          same action lives inside the More bottom-sheet, which
          opens this modal via the controlledOpen prop. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('suggest_fab.title')}
        className="hidden md:flex fixed bottom-6 right-6 z-[100] w-10 h-10 rounded-full bg-knit-primary text-white shadow-lg hover:scale-105 active:scale-95 transition-transform items-center justify-center opacity-80 hover:opacity-100"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[300] bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl" aria-hidden>
                💡
              </span>
              <h2 className="text-base font-bold text-gray-900 flex-1">{t('suggest_fab.title')}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
                aria-label={t('close')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              {t('suggest_fab.prompt')}
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('suggest_fab.placeholder')}
              rows={5}
              autoFocus
              className="w-full resize-none bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-rose-300"
              maxLength={5000}
            />
            {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setText('')
                  setErr(null)
                }}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!text.trim() || sending}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-knit-primary disabled:opacity-50"
              >
                {sending ? t('suggest_fab.sending') : t('suggest_fab.send')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

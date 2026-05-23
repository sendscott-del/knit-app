import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import KnitMark from '@/components/KnitMark'

/**
 * Public landing for members. Two audiences:
 *
 *   1) A member who tapped this URL because a missionary shared it — they
 *      type their name + phone, we look them up in the ward roster, and
 *      text them their personal Knit link.
 *   2) A member who lost their original SMS link and wants it back.
 *
 * Same flow either way. By design the page does not say whether we found a
 * match — it always responds with the same "if we found you, we just texted
 * you" message so a stranger can't enumerate phones.
 */
export default function MemberJoin() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<
    | { kind: 'ok'; text: string }
    | { kind: 'err'; text: string }
    | null
  >(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setOutcome(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/me/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          phone,
        }),
      })
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; message?: string; error?: string }
        | null
      if (!res.ok || body?.ok === false) {
        setOutcome({ kind: 'err', text: body?.error ?? `Request failed (${res.status})` })
      } else {
        setOutcome({
          kind: 'ok',
          text:
            body?.message ??
            "If we found you in your ward roster, we just texted your Knit link to that number. Tap it to open your survey.",
        })
      }
    } catch (err) {
      setOutcome({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Something went wrong.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-brand-primary text-white">
        <div className="max-w-3xl mx-auto px-6 pt-12 pb-16 text-center">
          <div className="flex justify-center mb-4">
            <KnitMark size={56} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">Get your Knit link</h1>
          <p className="text-base text-brand-primary-fade max-w-md mx-auto">
            Tell us who you are and we'll text your personal survey link.
          </p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 -mt-10 pb-12 w-full">
        <form onSubmit={submit} className="suite-card p-6 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-gray-700">First name</span>
            <input
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="form-input"
              autoComplete="given-name"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-gray-700">Last name</span>
            <input
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="form-input"
              autoComplete="family-name"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-gray-700">Phone</span>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-1234"
              className="form-input"
              autoComplete="tel"
              inputMode="tel"
            />
            <span className="text-xs text-gray-500">
              The number you usually get texts on. We'll text your link there.
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Text me my link'}
          </button>

          {outcome ? (
            <p
              className={`text-sm ${outcome.kind === 'ok' ? 'text-emerald-700' : 'text-error'}`}
              role="status"
              aria-live="polite"
            >
              {outcome.text}
            </p>
          ) : null}

          <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">
            Trouble? Ask your ward mission leader to add you, or reach out to your bishop.
          </p>
        </form>

        <p className="text-xs text-gray-400 text-center pt-6">
          <Link to="/" className="hover:underline">
            ← Knit home
          </Link>
        </p>
      </div>
    </main>
  )
}

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import AvailabilityGrid from '@/components/AvailabilityGrid'
import InterestChipPicker from '@/components/InterestChipPicker'
import StylePicker from '@/components/StylePicker'
import { slotsToString, type Slot } from '@/lib/availability'
import type { MemberAuth } from '@/lib/memberAuth'

type Step = 1 | 2 | 3 | 4 | 5 | 6

type Props = {
  auth: MemberAuth
  firstName: string
  wardId: string | null
  onDone: () => void | Promise<void>
}

export default function MemberOnboarding({ auth, firstName, wardId, onDone }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [slots, setSlots] = useState<Slot[]>([])
  const [interestIds, setInterestIds] = useState<string[]>([])
  const [styleKeys, setStyleKeys] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveStep() {
    setSaving(true)
    setError(null)
    try {
      if (step === 3) {
        const { error } = await supabase.rpc('knit_member_self_save_availability', {
          p_member_id: auth.memberId,
          p_token: auth.token,
          p_slots: slots.map((s) => ({
            day_of_week: s.day,
            time_slot: s.timeSlot,
          })),
        })
        if (error) throw error
      } else if (step === 4) {
        const { error } = await supabase.rpc('knit_member_self_save_interests', {
          p_member_id: auth.memberId,
          p_token: auth.token,
          p_tag_ids: interestIds,
        })
        if (error) throw error
      } else if (step === 5) {
        const { error } = await supabase.rpc('knit_member_self_save_styles', {
          p_member_id: auth.memberId,
          p_token: auth.token,
          p_style_keys: styleKeys,
        })
        if (error) throw error
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setSaving(false)
      return false
    }
    setSaving(false)
    return true
  }

  async function next() {
    const ok = await saveStep()
    if (!ok) return
    setStep((s) => Math.min(6, s + 1) as Step)
  }

  async function finish() {
    setSaving(true)
    setError(null)
    const { error } = await supabase.rpc('knit_member_self_complete_onboarding', {
      p_member_id: auth.memberId,
      p_token: auth.token,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    await onDone()
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-start sm:items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <span
              key={n}
              className={`h-1.5 flex-1 rounded-full ${
                n <= step ? 'bg-slate-900' : 'bg-slate-200'
              }`}
            />
          ))}
        </div>

        {step === 1 ? (
          <ScreenWelcome firstName={firstName} onYes={() => setStep(3)} onTellMore={() => setStep(2)} />
        ) : null}

        {step === 2 ? <ScreenWhatWeAsk onContinue={() => setStep(3)} /> : null}

        {step === 3 ? (
          <ScreenDays
            slots={slots}
            onChange={setSlots}
            wardId={wardId}
          />
        ) : null}

        {step === 4 ? (
          <ScreenInterests wardId={wardId} value={interestIds} onChange={setInterestIds} />
        ) : null}

        {step === 5 ? <ScreenStyles value={styleKeys} onChange={setStyleKeys} /> : null}

        {step === 6 ? (
          <ScreenConfirm
            firstName={firstName}
            slots={slots}
            interestIds={interestIds}
            styleKeys={styleKeys}
          />
        ) : null}

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}

        <div className="flex items-center justify-between">
          {step > 1 && step < 6 ? (
            <button
              onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
              className="text-sm text-slate-600 hover:text-slate-900"
              disabled={saving}
            >
              Back
            </button>
          ) : (
            <span />
          )}

          {step === 1 ? null : step === 6 ? (
            <button
              onClick={() => void finish()}
              disabled={saving}
              className="rounded-lg bg-slate-900 text-white px-6 py-3 text-base font-medium hover:bg-slate-800 disabled:opacity-50 min-h-[48px]"
            >
              {saving ? 'Saving…' : 'All set'}
            </button>
          ) : step === 2 ? (
            <button
              onClick={() => setStep(3)}
              className="rounded-lg bg-slate-900 text-white px-6 py-3 text-base font-medium hover:bg-slate-800 min-h-[48px]"
            >
              Got it, continue
            </button>
          ) : (
            <button
              onClick={() => void next()}
              disabled={saving}
              className="rounded-lg bg-slate-900 text-white px-6 py-3 text-base font-medium hover:bg-slate-800 disabled:opacity-50 min-h-[48px]"
            >
              {saving ? 'Saving…' : 'Next'}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}

function ScreenWelcome({
  firstName,
  onYes,
  onTellMore,
}: {
  firstName: string
  onYes: () => void
  onTellMore: () => void
}) {
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-semibold text-slate-900">
        Hi {firstName || 'there'}. This is Knit.
      </h1>
      <p className="text-lg text-slate-700 leading-relaxed">
        Our missionaries are teaching people who could use a friend — a real one,
        who stays after the missionaries transfer.
      </p>
      <p className="text-lg text-slate-700">Want to help?</p>
      <div className="grid gap-3 pt-2">
        <button
          onClick={onYes}
          className="rounded-lg bg-slate-900 text-white px-6 py-4 text-base font-medium hover:bg-slate-800 min-h-[48px]"
        >
          Yes, let's go
        </button>
        <button
          onClick={onTellMore}
          className="rounded-lg border border-slate-300 bg-white text-slate-900 px-6 py-4 text-base font-medium hover:bg-slate-100 min-h-[48px]"
        >
          Tell me more first
        </button>
      </div>
    </div>
  )
}

function ScreenWhatWeAsk({ onContinue: _ }: { onContinue: () => void }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">What we'll ask</h1>
      <ul className="space-y-3 text-lg text-slate-700">
        <li>• What days you're usually free</li>
        <li>• What you love doing</li>
        <li>• How you'd like to help</li>
      </ul>
      <p className="text-base text-slate-600 pt-2">
        We keep just those things. No address, no finances, no family details.
      </p>
    </div>
  )
}

function ScreenDays({
  slots,
  onChange,
  wardId: _wardId,
}: {
  slots: Slot[]
  onChange: (next: Slot[]) => void
  wardId: string | null
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">When are you usually free?</h1>
      <p className="text-base text-slate-600">Tap any times that work most weeks.</p>
      <AvailabilityGrid value={slots} onChange={onChange} />
      {slots.length > 0 ? (
        <p className="text-sm text-slate-600">
          <strong>{slotsToString(slots)}</strong>
        </p>
      ) : null}
    </div>
  )
}

function ScreenInterests({
  wardId,
  value,
  onChange,
}: {
  wardId: string | null
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">What do you love doing?</h1>
      <p className="text-base text-slate-600">Pick a few — as many as you want.</p>
      <InterestChipPicker wardId={wardId} value={value} onChange={onChange} />
    </div>
  )
}

function ScreenStyles({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">How can you help?</h1>
      <p className="text-base text-slate-600">
        Missionaries need different kinds of help. What are you happy to do?
      </p>
      <StylePicker value={value} onChange={onChange} />
    </div>
  )
}

function ScreenConfirm({
  firstName,
  slots,
  interestIds,
  styleKeys,
}: {
  firstName: string
  slots: Slot[]
  interestIds: string[]
  styleKeys: string[]
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Got it, {firstName || 'friend'}.</h1>
      <p className="text-base text-slate-600">Here's what we have:</p>
      <ul className="space-y-3 text-base text-slate-800">
        <li>
          <strong>Free:</strong> {slotsToString(slots) || '— (none yet)'}
        </li>
        <li>
          <strong>Love:</strong> {interestIds.length === 0 ? '— (none yet)' : `${interestIds.length} interest${interestIds.length === 1 ? '' : 's'} picked`}
        </li>
        <li>
          <strong>Willing to:</strong> {styleKeys.length === 0 ? '— (none yet)' : `${styleKeys.length} way${styleKeys.length === 1 ? '' : 's'} to help`}
        </li>
      </ul>
      <p className="text-sm text-slate-600 pt-2">
        We'll text you every Sunday — just a quick check-in. You can always adjust.
      </p>
    </div>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('common')
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
      setError(e instanceof Error ? e.message : t('layout.something_wrong'))
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

  const total = 6
  const showBack = step > 1 && step < 6
  // Step 1 has its own dual-CTA inside ScreenWelcome — no sticky footer needed.
  const showFooter = step !== 1

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top-of-viewport progress bar (replaces the 6-pip row) */}
      <div className="h-1 bg-gray-100">
        <div
          className="h-full bg-knit-primary transition-all"
          style={{ width: `${(step / total) * 100}%` }}
        />
      </div>

      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 flex justify-center">
        <div
          className="w-full max-w-md space-y-5"
          style={{
            paddingBottom: showFooter
              ? 'calc(80px + env(safe-area-inset-bottom))'
              : 'env(safe-area-inset-bottom)',
          }}
        >
          {showBack ? (
            <button
              onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
              className="text-sm text-gray-600 hover:text-gray-900"
              disabled={saving}
            >
              {t('onboarding_inline.back')}
            </button>
          ) : null}

          {step === 1 ? (
            <ScreenWelcome
              firstName={firstName}
              onYes={() => setStep(3)}
              onTellMore={() => setStep(2)}
            />
          ) : null}

          {step === 2 ? <ScreenWhatWeAsk onContinue={() => setStep(3)} /> : null}

          {step === 3 ? (
            <ScreenDays slots={slots} onChange={setSlots} wardId={wardId} />
          ) : null}

          {step === 4 ? (
            <ScreenInterests
              wardId={wardId}
              value={interestIds}
              onChange={setInterestIds}
            />
          ) : null}

          {step === 5 ? (
            <ScreenStyles value={styleKeys} onChange={setStyleKeys} />
          ) : null}

          {step === 6 ? (
            <ScreenConfirm
              firstName={firstName}
              slots={slots}
              interestIds={interestIds}
              styleKeys={styleKeys}
            />
          ) : null}

          {error ? <p className="text-sm text-error">{error}</p> : null}
        </div>
      </main>

      {showFooter ? (
        <footer
          className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3"
          style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}
        >
          <div className="max-w-md mx-auto">
            {step === 6 ? (
              <button
                onClick={() => void finish()}
                disabled={saving}
                className="k-btn w-full"
              >
                {saving ? t('saving') : t('all_set')}
              </button>
            ) : step === 2 ? (
              <button
                onClick={() => setStep(3)}
                disabled={saving}
                className="k-btn w-full"
              >
                {t('got_it_continue')}
              </button>
            ) : (
              <button
                onClick={() => void next()}
                disabled={saving}
                className="k-btn w-full"
              >
                {saving ? t('saving') : t('next')}
              </button>
            )}
          </div>
        </footer>
      ) : null}
    </div>
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
  const { t } = useTranslation('common')
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-semibold text-gray-900">
        {t('onboarding_inline.hi_name', { name: firstName || t('onboarding_inline.hi_there') })}
      </h1>
      <p className="text-lg text-gray-700 leading-relaxed">
        {t('onboarding_inline.intro')}
      </p>
      <p className="text-lg text-gray-700">{t('onboarding_inline.want_help')}</p>
      <div className="grid gap-3 pt-2">
        <button
          onClick={onYes}
          className="btn-primary min-h-[48px] px-6 py-4 w-full"
        >
          {t('onboarding_inline.yes_go')}
        </button>
        <button
          onClick={onTellMore}
          className="rounded-md border-[1.5px] border-gray-200 bg-white text-gray-900 px-6 py-4 text-base font-medium hover:bg-gray-100 min-h-[48px]"
        >
          {t('onboarding_inline.tell_more')}
        </button>
      </div>
    </div>
  )
}

function ScreenWhatWeAsk({ onContinue: _ }: { onContinue: () => void }) {
  const { t } = useTranslation('common')
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">{t('onboarding_inline.what_we_ask_title')}</h1>
      <ul className="space-y-3 text-lg text-gray-700">
        <li>• {t('onboarding_inline.what_days')}</li>
        <li>• {t('onboarding_inline.what_love')}</li>
        <li>• {t('onboarding_inline.what_help')}</li>
      </ul>
      <p className="text-base text-gray-600 pt-2">
        {t('onboarding_inline.privacy')}
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
  const { t } = useTranslation('common')
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">{t('onboarding_inline.days_title')}</h1>
      <p className="text-base text-gray-600">{t('onboarding_inline.days_hint')}</p>
      <AvailabilityGrid value={slots} onChange={onChange} />
      {slots.length > 0 ? (
        <p className="text-sm text-gray-600">
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
  const { t } = useTranslation('common')
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">{t('onboarding_inline.interests_title')}</h1>
      <p className="text-base text-gray-600">{t('onboarding_inline.interests_hint')}</p>
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
  const { t } = useTranslation('common')
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">{t('onboarding_inline.styles_title')}</h1>
      <p className="text-base text-gray-600">
        {t('onboarding_inline.styles_hint')}
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
  const { t } = useTranslation('common')
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">
        {t('onboarding_inline.confirm_title', { name: firstName || t('onboarding_inline.confirm_friend') })}
      </h1>
      <p className="text-base text-gray-600">{t('onboarding_inline.confirm_intro')}</p>
      <ul className="space-y-3 text-base text-gray-800">
        <li>
          <strong>{t('onboarding_inline.label_free')}</strong> {slotsToString(slots) || t('onboarding_inline.none_yet')}
        </li>
        <li>
          <strong>{t('onboarding_inline.label_love')}</strong>{' '}
          {interestIds.length === 0
            ? t('onboarding_inline.none_yet')
            : t('onboarding_inline.interests_count', { count: interestIds.length })}
        </li>
        <li>
          <strong>{t('onboarding_inline.label_willing')}</strong>{' '}
          {styleKeys.length === 0
            ? t('onboarding_inline.none_yet')
            : t('onboarding_inline.ways_count', { count: styleKeys.length })}
        </li>
      </ul>
      <p className="text-sm text-gray-600 pt-2">
        {t('onboarding_inline.footer_note')}
      </p>
    </div>
  )
}

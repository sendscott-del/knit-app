import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

type Props = {
  open: boolean
  onClose: () => void
  onSignOut: () => void
  /** Opens the existing SuggestionFAB modal — supplied by AdminLayout. */
  onSuggestEnhancement: () => void
  showStakeAdminTabs: boolean
  showInvitations: boolean
}

const GATHER_CANONICAL_URL = 'https://gathered-admin-neon.vercel.app/gather'

/**
 * Bottom sheet shown when the user taps "More" on the mobile tab
 * bar. Replaces the hamburger drawer pattern. Hosts the secondary
 * routes AND the "Suggest an enhancement" action (which is what
 * the floating FAB used to be on mobile).
 */
export default function MoreSheet({
  open,
  onClose,
  onSignOut,
  onSuggestEnhancement,
  showStakeAdminTabs,
  showInvitations,
}: Props) {
  const { t } = useTranslation('common')

  // Lock body scroll while sheet is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Esc closes the sheet.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="md:hidden fixed inset-0 z-50"
      role="dialog"
      aria-label={t('nav.more')}
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="absolute left-0 right-0 bottom-0 bg-white rounded-t-2xl shadow-2xl px-3 pt-2"
        style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto w-9 h-1 bg-gray-300 rounded-full mt-1 mb-2" />

        <SheetGroup title={t('more.workspace')}>
          <SheetLink
            to="/admin/outings"
            icon="calendar-outline"
            label={t('more.outings')}
            onClose={onClose}
          />
          <SheetLink
            to="/admin/sheet"
            icon="grid-outline"
            label={t('more.google_sheet')}
            onClose={onClose}
          />
          {showInvitations && (
            <SheetLink
              to="/admin/invitations"
              icon="mail-outline"
              label={t('more.invitations')}
              onClose={onClose}
            />
          )}
          {showStakeAdminTabs && (
            <SheetLink
              to="/admin/users"
              icon="shield-outline"
              label={t('more.users_roles')}
              onClose={onClose}
            />
          )}
          <SheetLink
            to="/admin/settings"
            icon="settings-outline"
            label={t('more.settings')}
            onClose={onClose}
          />
          <SheetExternal
            href={GATHER_CANONICAL_URL}
            icon="apps-outline"
            label={t('more.gather')}
            onClose={onClose}
          />
        </SheetGroup>

        <SheetGroup title={t('more.help')}>
          <SheetButton
            icon="bulb-outline"
            label={t('more.suggest_enhancement')}
            onClick={() => {
              onClose()
              onSuggestEnhancement()
            }}
          />
          <SheetLink
            to="/admin/guide"
            icon="book-outline"
            label={t('more.user_guide')}
            onClose={onClose}
          />
          <SheetLink
            to="/admin/release-notes"
            icon="sparkles-outline"
            label={t('more.release_notes')}
            onClose={onClose}
          />
        </SheetGroup>

        <SheetButton
          icon="log-out-outline"
          label={t('sign_out')}
          muted
          onClick={() => {
            onClose()
            onSignOut()
          }}
        />
      </div>
    </div>
  )
}

function SheetGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="pb-1">
      <h4 className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-500">
        {title}
      </h4>
      {children}
    </div>
  )
}

function SheetLink({
  to,
  icon,
  label,
  onClose,
}: {
  to: string
  icon: string
  label: string
  onClose: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onClose}
      className="flex items-center gap-3 px-2 py-3 min-h-[44px] rounded-lg active:bg-gray-100"
    >
      <SheetIcon name={icon} />
      <span className="flex-1 text-sm font-semibold text-gray-900">{label}</span>
      <span className="text-gray-400 text-lg leading-none">›</span>
    </NavLink>
  )
}

function SheetExternal({
  href,
  icon,
  label,
  onClose,
}: {
  href: string
  icon: string
  label: string
  onClose: () => void
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onClose}
      className="flex items-center gap-3 px-2 py-3 min-h-[44px] rounded-lg active:bg-gray-100"
    >
      <SheetIcon name={icon} />
      <span className="flex-1 text-sm font-semibold text-gray-900">{label}</span>
      <ion-icon
        name="open-outline"
        style={{ fontSize: 16, color: 'var(--color-gray-400)' }}
        aria-hidden="true"
      />
    </a>
  )
}

function SheetButton({
  icon,
  label,
  onClick,
  muted,
}: {
  icon: string
  label: string
  onClick: () => void
  muted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-2 py-3 min-h-[44px] rounded-lg active:bg-gray-100 text-left"
    >
      <SheetIcon name={icon} muted={muted} />
      <span
        className={`flex-1 text-sm font-semibold ${
          muted ? 'text-gray-700' : 'text-gray-900'
        }`}
      >
        {label}
      </span>
    </button>
  )
}

function SheetIcon({ name, muted }: { name: string; muted?: boolean }) {
  const bg = muted ? 'var(--color-gray-100)' : 'var(--color-knit-primary-fade)'
  const fg = muted ? 'var(--color-gray-500)' : 'var(--color-knit-primary)'
  return (
    <span
      className="inline-flex items-center justify-center rounded-lg flex-shrink-0"
      style={{ width: 32, height: 32, background: bg, color: fg }}
    >
      <ion-icon name={name} style={{ fontSize: 18 }} aria-hidden="true" />
    </span>
  )
}

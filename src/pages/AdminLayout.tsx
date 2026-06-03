import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth'
import { useAdmin } from '@/lib/useAdmin'
import { supabase } from '@/lib/supabase'
import {
  roleLabel,
  canManageStake,
  canSendInvitations,
  type AdminRole,
} from '@/lib/roles'
import KnitMark from '@/components/KnitMark'
import AppSwitcher from '@/components/AppSwitcher'
import KnitLangToggle from '@/components/KnitLangToggle'
import SuggestionFAB from '@/components/SuggestionFAB'
import MobileTabBar from '@/components/MobileTabBar'
import MoreSheet from '@/components/MoreSheet'

/**
 * Suite-wide layout for Knit's admin area. Mirrors the Glean shell on
 * desktop (sidebar nav, scripture rail, big content column). On phones
 * we drop the hamburger drawer in favor of a 5-item bottom tab bar
 * plus a "More" bottom sheet — see MobileTabBar + MoreSheet. The
 * floating suggestion FAB is desktop-only now; on mobile the same
 * action lives inside the More sheet.
 */
export default function AdminLayout() {
  const { session, loading: authLoading, signOut } = useAuth()
  const admin = useAdmin()
  const { t } = useTranslation('common')
  const [moreOpen, setMoreOpen] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)

  // Best-effort: as soon as we have a confirmed admin profile, ask the server
  // to share every bound ward sheet this admin can view with their Gmail.
  // Fire-and-forget — failures don't surface here; the morning-push cron is
  // the backstop. Once-per-session is enforced via sessionStorage so we don't
  // hammer Drive on every page nav. MUST live above the early returns so the
  // hook order stays stable across renders.
  const readyAdminId = admin.status === 'ready' ? admin.profile.id : null
  useSheetAccessOnce(readyAdminId)

  if (authLoading) return <FullPage>{t('loading')}</FullPage>
  if (!session) return <Navigate to="/admin/login" replace />

  if (admin.status === 'loading') return <FullPage>{t('layout.loading_profile')}</FullPage>

  if (admin.status === 'error') {
    return (
      <FullPage>
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-semibold text-gray-900">{t('layout.something_wrong')}</h1>
          <p className="text-sm text-error">{admin.message}</p>
        </div>
      </FullPage>
    )
  }

  if (admin.status === 'no_admin_row') {
    return (
      <FullPage>
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold text-gray-900">{t('layout.not_provisioned_title')}</h1>
          <p className="text-base text-gray-600">
            <Trans
              i18nKey="layout.not_provisioned_body"
              ns="common"
              values={{ email: admin.email }}
              components={{ strong: <strong /> }}
            />
          </p>
          <button onClick={() => void signOut()} className="btn-outline">
            {t('sign_out')}
          </button>
        </div>
      </FullPage>
    )
  }

  if (admin.status !== 'ready') return null

  const { profile } = admin
  const wardScoped =
    profile.role === 'ward_mission_leader' ||
    profile.role === 'relief_society_presidency' ||
    profile.role === 'elders_quorum_presidency'
  const scopeLabel = wardScoped
    ? profile.ward?.name ?? t('layout.your_ward')
    : profile.stake?.name ?? t('layout.your_stake')
  const showStakeAdminTabs = canManageStake(profile)
  const showInvitations = canSendInvitations(profile)

  return (
    <div className="min-h-screen bg-gray-50">
      <AppSwitcher />
      <div className="h-[3px] w-full bg-knit-primary" aria-hidden="true" />
      <SuiteTopBar
        scopeLabel={scopeLabel}
        role={profile.role}
        email={profile.email}
        isSuper={!!profile.is_super_admin}
        onSignOut={() => void signOut()}
      />
      <div className="md:flex">
        <Sidebar
          showStakeAdminTabs={showStakeAdminTabs}
          showInvitations={showInvitations}
        />
        <main className="flex-1 min-w-0 min-h-screen md:bg-white md:border-l md:border-gray-200 safe-pb-tabbar">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 md:py-8">
            <Outlet context={{ profile }} />
          </div>
        </main>
      </div>

      {/* Mobile-only chrome */}
      <MobileTabBar onMoreClick={() => setMoreOpen(true)} />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onSignOut={() => void signOut()}
        onSuggestEnhancement={() => setSuggestOpen(true)}
        showStakeAdminTabs={showStakeAdminTabs}
        showInvitations={showInvitations}
      />

      <SuggestionFAB
        controlledOpen={suggestOpen}
        onControlledClose={() => setSuggestOpen(false)}
      />
    </div>
  )
}

function SuiteTopBar({
  scopeLabel,
  role,
  email,
  isSuper,
  onSignOut,
}: {
  scopeLabel: string
  role: AdminRole
  email: string
  isSuper: boolean
  onSignOut: () => void
}) {
  const { t } = useTranslation('common')
  const scripture = t('app.scripture')
  const scriptureRef = t('app.scriptureRef')
  return (
    <div className="sticky top-0 z-30 w-full bg-white border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3">
        {/* Mobile: just the scope label. Scripture moves into More sheet
            via the Help group's User guide / release notes; the bar
            stays at a single 44px row. */}
        <div className="md:hidden flex-1 min-w-0 text-[12px] font-semibold text-gray-700 truncate">
          {scopeLabel}
        </div>

        {/* Desktop: scripture + scope + role + email */}
        <div className="hidden md:flex flex-1 min-w-0 text-[11px] text-gray-500 truncate text-left">
          <span className="italic">{scripture}</span>
          <span className="text-gray-400 not-italic ml-1">{scriptureRef}</span>
        </div>
        <KnitLangToggle />
        <div className="hidden md:flex items-center gap-2 text-xs text-gray-500">
          <span className="font-medium text-gray-800">{scopeLabel}</span>
          <span className="opacity-50">·</span>
          <span>{roleLabel(role, t)}</span>
          {isSuper ? (
            <span className="rounded-full bg-knit-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              {t('layout.super')}
            </span>
          ) : null}
          <span className="opacity-50">·</span>
          <span className="truncate max-w-[180px]" title={email}>{email}</span>
        </div>
        <button
          onClick={onSignOut}
          className="hidden md:inline text-xs font-medium text-gray-500 hover:text-gray-800"
        >
          {t('sign_out')}
        </button>
      </div>
    </div>
  )
}

// Gather is hosted in Glean now — one canonical place to manage user access
// across all five apps. The Knit /admin/gather route still exists as a
// redirect for stragglers, but the nav links straight out to skip the hop.
const GATHER_CANONICAL_URL = 'https://gathered-admin-neon.vercel.app/gather'

function useNavLinks(showStakeAdminTabs: boolean, showInvitations: boolean) {
  const { t } = useTranslation('common')
  return [
    { to: '/admin', label: t('layout.nav_dashboard'), end: true },
    { to: '/admin/members', label: t('layout.nav_members') },
    ...(showInvitations ? [{ to: '/admin/invitations', label: t('layout.nav_invitations') }] : []),
    { to: '/admin/friends', label: t('layout.nav_friends') },
    { to: '/admin/outings', label: t('layout.nav_outings') },
    { to: '/admin/suggest', label: t('layout.nav_suggest') },
    { to: '/admin/sheet', label: t('layout.nav_sheet') },
    ...(showStakeAdminTabs ? [{ to: '/admin/users', label: t('layout.nav_users_roles') }] : []),
    { to: '/admin/settings', label: t('layout.nav_settings') },
    { href: GATHER_CANONICAL_URL, label: t('layout.nav_gather'), external: true as const },
  ]
}

function Sidebar({
  showStakeAdminTabs,
  showInvitations,
}: {
  showStakeAdminTabs: boolean
  showInvitations: boolean
}) {
  const { t } = useTranslation('common')
  const links = useNavLinks(showStakeAdminTabs, showInvitations)
  return (
    <aside
      className="hidden md:flex md:flex-col md:flex-shrink-0 sticky top-0 h-screen text-white"
      style={{ width: 224, background: '#1B3A6B' }}
    >
      <div className="px-5 pt-6 pb-8 flex items-center gap-2.5">
        <KnitMark size={28} />
        <div className="text-xl font-bold tracking-tight leading-none">{t('app_name')}</div>
      </div>
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {links.map((item) =>
          'external' in item ? (
            <a
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-semibold text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            >
              {item.label}
            </a>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          )
        )}
      </nav>
      <div className="px-2 pb-5 mt-2 space-y-0.5 border-t border-white/10 pt-3">
        <NavLink
          to="/admin/guide"
          className={({ isActive }) =>
            `block px-3 py-2 rounded-md text-xs font-medium transition-colors ${
              isActive
                ? 'bg-white/15 text-white'
                : 'text-white/60 hover:bg-white/10 hover:text-white'
            }`
          }
        >
          {t('layout.user_guide')}
        </NavLink>
        <NavLink
          to="/admin/release-notes"
          className={({ isActive }) =>
            `block px-3 py-2 rounded-md text-xs font-medium transition-colors ${
              isActive
                ? 'bg-white/15 text-white'
                : 'text-white/60 hover:bg-white/10 hover:text-white'
            }`
          }
        >
          {t('layout.release_notes')}
        </NavLink>
      </div>
    </aside>
  )
}

function FullPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-gray-700">
      {children}
    </main>
  )
}

/**
 * Fire `/api/admin/sheet?action=ensure_my_access` once per admin per session.
 * Guarded by sessionStorage so route changes don't repeat the call. Silent on
 * failure — the morning-push cron also reconciles. Must be called
 * unconditionally (above AdminLayout's early returns) to keep the hook order
 * stable; passes `null` while the admin profile is still loading and the
 * effect no-ops until a real id arrives.
 */
function useSheetAccessOnce(adminId: string | null) {
  useEffect(() => {
    if (!adminId) return
    const key = `knit:sheet-access-checked:${adminId}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token) return
        await fetch('/api/admin/sheet', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'ensure_my_access' }),
        })
      } catch {
        // best-effort; cron is the backstop
      }
    })()
  }, [adminId])
}

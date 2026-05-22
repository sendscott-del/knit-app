import { useState } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useAdmin } from '@/lib/useAdmin'
import { ROLE_LABELS, canManageStake, type AdminRole } from '@/lib/roles'
import KnitMark from '@/components/KnitMark'
import AppSwitcher from '@/components/AppSwitcher'
import KnitLangToggle from '@/components/KnitLangToggle'
import SuggestionFAB from '@/components/SuggestionFAB'
import { useTranslation } from 'react-i18next'

/**
 * Suite-wide layout for Knit's admin area. Mirrors the Glean shell:
 *   - Gathered chrome at the top (cross-app switcher)
 *   - 3px brand stripe in the per-app color
 *   - Persistent scripture + EN/ES sub-row
 *   - Left sidebar with a single brand header, primary nav, and bottom
 *     links for the user guide, release notes, and sign-out
 *   - Mobile fallback: hamburger drawer instead of a bottom tab bar so
 *     the existing top-of-page actions on each admin screen keep working
 *
 * Demo was promoted out of the primary nav per the suite-wide rule that
 * demo mode lives behind Settings. The route still exists for direct
 * navigation; only the visible tab was removed.
 */
export default function AdminLayout() {
  const { session, loading: authLoading, signOut } = useAuth()
  const admin = useAdmin()
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (authLoading) return <FullPage>Loading…</FullPage>
  if (!session) return <Navigate to="/admin/login" replace />

  if (admin.status === 'loading') return <FullPage>Loading your profile…</FullPage>

  if (admin.status === 'error') {
    return (
      <FullPage>
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
          <p className="text-sm text-error">{admin.message}</p>
        </div>
      </FullPage>
    )
  }

  if (admin.status === 'no_admin_row') {
    return (
      <FullPage>
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold text-gray-900">Not yet provisioned</h1>
          <p className="text-base text-gray-600">
            You're signed in as <strong>{admin.email}</strong>, but you don't have a Knit
            admin profile yet. Ask the person who invited you to finish setting up your
            account, or — if you're the first admin for your stake — reach out to support.
          </p>
          <button onClick={() => void signOut()} className="btn-outline">
            Sign out
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
    ? profile.ward?.name ?? 'Your ward'
    : profile.stake?.name ?? 'Your stake'
  const showStakeAdminTabs = canManageStake(profile)

  return (
    <div className="min-h-screen bg-gray-50">
      <AppSwitcher />
      <div className="h-[3px] w-full bg-knit-primary" aria-hidden="true" />
      <SuiteTopBar
        scopeLabel={scopeLabel}
        role={profile.role}
        email={profile.email}
        isSuper={!!profile.is_super_admin}
        onMenu={() => setDrawerOpen(true)}
        onSignOut={() => void signOut()}
      />
      <div className="md:flex">
        <Sidebar showStakeAdminTabs={showStakeAdminTabs} />
        {drawerOpen && (
          <MobileDrawer
            showStakeAdminTabs={showStakeAdminTabs}
            onClose={() => setDrawerOpen(false)}
          />
        )}
        <main className="flex-1 min-w-0 min-h-screen md:bg-white md:border-l md:border-gray-200">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
            <Outlet context={{ profile }} />
          </div>
        </main>
      </div>
      <SuggestionFAB />
    </div>
  )
}

function SuiteTopBar({
  scopeLabel,
  role,
  email,
  isSuper,
  onMenu,
  onSignOut,
}: {
  scopeLabel: string
  role: AdminRole
  email: string
  isSuper: boolean
  onMenu: () => void
  onSignOut: () => void
}) {
  const { t } = useTranslation('common')
  // i18n key is best-effort — older locale bundles may not have these yet.
  const scripture = t('app.scripture', {
    defaultValue:
      '“Their hearts [were] knit together in unity and in love.”',
  })
  const scriptureRef = t('app.scriptureRef', { defaultValue: 'Mosiah 18:21' })
  return (
    <div className="w-full bg-white border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-1.5 flex items-center gap-3">
        <button
          type="button"
          onClick={onMenu}
          className="md:hidden -ml-1 p-1 text-gray-500 hover:text-gray-700"
          aria-label="Open navigation"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <div className="flex-1 min-w-0 text-[11px] text-gray-500 truncate text-center md:text-left">
          <span className="italic">{scripture}</span>{' '}
          <span className="text-gray-400 not-italic">{scriptureRef}</span>
        </div>
        <KnitLangToggle />
        <div className="hidden md:flex items-center gap-2 text-xs text-gray-500">
          <span className="font-medium text-gray-800">{scopeLabel}</span>
          <span className="opacity-50">·</span>
          <span>{ROLE_LABELS[role]}</span>
          {isSuper ? (
            <span className="rounded-full bg-knit-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Super
            </span>
          ) : null}
          <span className="opacity-50">·</span>
          <span className="truncate max-w-[180px]" title={email}>{email}</span>
        </div>
        <button
          onClick={onSignOut}
          className="text-xs font-medium text-gray-500 hover:text-gray-800"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

function navLinks(showStakeAdminTabs: boolean) {
  return [
    { to: '/admin', label: 'Dashboard', end: true },
    { to: '/admin/members', label: 'Members' },
    { to: '/admin/friends', label: 'Friends' },
    { to: '/admin/outings', label: 'Outings' },
    { to: '/admin/suggest', label: 'Suggest' },
    { to: '/admin/sheet', label: 'Sheet' },
    ...(showStakeAdminTabs ? [{ to: '/admin/users', label: 'Users' }] : []),
    ...(showStakeAdminTabs ? [{ to: '/admin/roles', label: 'Roles' }] : []),
    { to: '/admin/settings', label: 'Settings' },
    { to: '/admin/gather', label: 'Gather' },
  ]
}

function Sidebar({ showStakeAdminTabs }: { showStakeAdminTabs: boolean }) {
  const links = navLinks(showStakeAdminTabs)
  return (
    <aside
      className="hidden md:flex md:flex-col md:flex-shrink-0 sticky top-0 h-screen text-white"
      style={{ width: 224, background: '#1B3A6B' }}
    >
      <div className="px-5 pt-6 pb-8 flex items-center gap-2.5">
        <KnitMark size={28} />
        <div className="text-xl font-bold tracking-tight leading-none">Knit</div>
      </div>
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {links.map((item) => (
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
        ))}
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
          User guide
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
          Release notes
        </NavLink>
      </div>
    </aside>
  )
}

function MobileDrawer({
  showStakeAdminTabs,
  onClose,
}: {
  showStakeAdminTabs: boolean
  onClose: () => void
}) {
  const links = navLinks(showStakeAdminTabs)
  return (
    <>
      <div
        className="md:hidden fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="md:hidden fixed inset-y-0 left-0 z-50 w-64 text-white flex flex-col"
        style={{ background: '#1B3A6B' }}
        role="dialog"
        aria-label="Navigation"
      >
        <div className="px-5 pt-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <KnitMark size={28} />
            <div className="text-xl font-bold tracking-tight leading-none">Knit</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-white/70 hover:text-white"
            aria-label="Close navigation"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                `block px-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-2 pb-5 mt-2 space-y-0.5 border-t border-white/10 pt-3">
          <NavLink
            to="/admin/guide"
            onClick={onClose}
            className="block px-3 py-2 rounded-md text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white"
          >
            User guide
          </NavLink>
          <NavLink
            to="/admin/release-notes"
            onClick={onClose}
            className="block px-3 py-2 rounded-md text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white"
          >
            Release notes
          </NavLink>
        </div>
      </aside>
    </>
  )
}

function FullPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-gray-700">
      {children}
    </main>
  )
}

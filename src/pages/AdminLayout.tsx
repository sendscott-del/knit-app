import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useAdmin } from '@/lib/useAdmin'
import KnitMark from '@/components/KnitMark'

export default function AdminLayout() {
  const { session, loading: authLoading, signOut } = useAuth()
  const admin = useAdmin()

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
  const scopeLabel =
    profile.role === 'ward_mission_leader'
      ? profile.ward?.name ?? 'Your ward'
      : profile.stake?.name ?? 'Your stake'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Suite chrome — navy header with brand mark, mirrors Magnify/Steward/Tidings/Glean */}
      <header className="bg-brand-primary text-white shadow-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <NavLink
            to="/admin"
            end
            className="flex items-center gap-2.5 text-white hover:opacity-90 transition"
          >
            <KnitMark size={28} />
            <span className="text-lg font-semibold tracking-tight">Knit</span>
          </NavLink>
          <div className="hidden sm:flex items-center gap-2 text-sm text-brand-primary-fade">
            <span className="font-medium text-white">{scopeLabel}</span>
            <span className="opacity-50">·</span>
            <RoleLabel role={profile.role} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-brand-primary-fade hidden md:inline">
              {profile.email}
            </span>
            <button
              onClick={() => void signOut()}
              className="text-sm font-medium text-brand-primary-fade hover:text-white transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Tab nav — white strip, knit-primary underline on active */}
      <nav className="bg-white border-b border-gray-200 sticky top-14 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <ul className="flex items-center gap-1 overflow-x-auto -mb-px">
            <TabLink to="/admin" end>Dashboard</TabLink>
            <TabLink to="/admin/members">Members</TabLink>
            <TabLink to="/admin/friends">Friends</TabLink>
            <TabLink to="/admin/outings">Outings</TabLink>
            <TabLink to="/admin/suggest">Suggest</TabLink>
            <TabLink to="/admin/sheet">Sheet</TabLink>
            <TabLink to="/admin/demo">Demo</TabLink>
          </ul>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <Outlet context={{ profile }} />
      </main>
    </div>
  )
}

function RoleLabel({
  role,
}: {
  role: 'stake_president' | 'stake_missionary_hc' | 'ward_mission_leader'
}) {
  const labels = {
    stake_president: 'Stake President',
    stake_missionary_hc: 'Stake HC (Missionary)',
    ward_mission_leader: 'Ward Mission Leader',
  } as const
  return <span>{labels[role]}</span>
}

function TabLink({
  to,
  end,
  children,
}: {
  to: string
  end?: boolean
  children: React.ReactNode
}) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
          `inline-block px-4 py-3 text-sm font-semibold border-b-2 transition ${
            isActive
              ? 'border-knit-primary text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`
        }
      >
        {children}
      </NavLink>
    </li>
  )
}

function FullPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-gray-700">
      {children}
    </main>
  )
}

import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useAdmin } from '@/lib/useAdmin'

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
          <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
          <p className="text-sm text-rose-700">{admin.message}</p>
        </div>
      </FullPage>
    )
  }

  if (admin.status === 'no_admin_row') {
    return (
      <FullPage>
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Not yet provisioned</h1>
          <p className="text-sm text-slate-600">
            You're signed in as <strong>{admin.email}</strong>, but you don't have a Knit
            admin profile yet. Ask the person who invited you to finish setting up your
            account, or — if you're the first admin for your stake — reach out to support.
          </p>
          <button
            onClick={() => void signOut()}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
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
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <NavLink to="/admin" end className="text-xl font-semibold text-slate-900 tracking-tight">
            Knit
          </NavLink>
          <div className="text-sm text-slate-600 hidden sm:block">
            {scopeLabel} · <RoleLabel role={profile.role} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500 hidden md:inline">{profile.email}</span>
            <button
              onClick={() => void signOut()}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 sm:px-6 border-t border-slate-100">
          <ul className="flex items-center gap-1 overflow-x-auto">
            <TabLink to="/admin" end>Dashboard</TabLink>
            <TabLink to="/admin/members">Members</TabLink>
            <TabLink to="/admin/friends">Friends</TabLink>
          </ul>
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <Outlet context={{ profile }} />
      </main>
    </div>
  )
}

function RoleLabel({ role }: { role: 'stake_president' | 'stake_missionary_hc' | 'ward_mission_leader' }) {
  const labels = {
    stake_president: 'Stake President',
    stake_missionary_hc: 'Stake HC (Missionary)',
    ward_mission_leader: 'Ward Mission Leader',
  } as const
  return <>{labels[role]}</>
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
          `inline-block px-4 py-3 text-sm font-medium border-b-2 -mb-px transition ${
            isActive
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
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
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-600">
      {children}
    </main>
  )
}

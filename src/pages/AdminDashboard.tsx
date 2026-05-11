import { Link, useOutletContext } from 'react-router-dom'
import type { AdminProfile } from '@/lib/useAdmin'
import { ROLE_LABELS, isWardScoped, canManageStake, canEdit } from '@/lib/roles'

type Ctx = { profile: AdminProfile }

export default function AdminDashboard() {
  const { profile } = useOutletContext<Ctx>()
  const wardScope = isWardScoped(profile.role) && !profile.is_super_admin
  const scopeName = wardScope ? profile.ward?.name ?? '—' : profile.stake?.name ?? '—'
  const editor = canEdit(profile)
  const stakeAdmin = canManageStake(profile)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
          {greeting(profile.name ?? profile.email)}
        </h1>
        <p className="text-base text-gray-600 mt-1">
          {ROLE_LABELS[profile.role]} · {scopeName}
          {profile.is_super_admin ? ' · Super admin' : ''}
        </p>
        {!editor ? (
          <p className="text-sm text-gray-500 mt-2 italic">
            You have read-only access to Knit. Names, availability, and outings are
            visible, but only ward leaders can make changes.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <LinkCard
          to="/admin/members"
          title="Members"
          body={
            wardScope
              ? "Invite members, see who's active, review availability."
              : 'See member engagement across the stake.'
          }
        />
        <LinkCard
          to="/admin/friends"
          title="Friends being taught"
          body="Roster of people the missionaries are fellowshipping."
        />
        <LinkCard
          to="/admin/outings"
          title="Outings"
          body="Log completed outings, see upcoming."
        />
        <LinkCard
          to="/admin/suggest"
          title="Suggestions"
          body="Who should go with which friend? Ranked matches with reasons."
        />
        <LinkCard
          to="/admin/sheet"
          title="Sheet"
          body="Provision and refresh the Google Sheet for the missionaries."
        />
        <LinkCard
          to="/admin/settings"
          title="Settings"
          body={
            stakeAdmin
              ? 'Stake info, wards, sheet bindings.'
              : 'View ward + stake configuration.'
          }
        />
        {stakeAdmin ? (
          <LinkCard
            to="/admin/users"
            title="Users"
            body="Add, edit, or remove Knit admins across the stake."
          />
        ) : null}
      </div>
    </div>
  )
}

function greeting(label: string) {
  const hour = new Date().getHours()
  const prefix = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const first = label.split('@')[0].split(/[\s.]/)[0]
  const name = first.charAt(0).toUpperCase() + first.slice(1)
  return `${prefix}, ${name}`
}

function LinkCard({ to, title, body }: { to: string; title: string; body: string }) {
  return (
    <Link
      to={to}
      className="suite-card p-5 space-y-2 hover:border-knit-primary hover:shadow-lg transition group"
    >
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-600">{body}</p>
      <p className="text-xs font-semibold text-knit-primary pt-2 group-hover:translate-x-0.5 transition">
        Open →
      </p>
    </Link>
  )
}

import { Link, useOutletContext } from 'react-router-dom'
import type { AdminProfile } from '@/lib/useAdmin'

type Ctx = { profile: AdminProfile }

export default function AdminDashboard() {
  const { profile } = useOutletContext<Ctx>()
  const isWardScope = profile.role === 'ward_mission_leader'

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
          {greeting(profile.name ?? profile.email)}
        </h1>
        <p className="text-base text-gray-600 mt-1">
          {isWardScope
            ? `Ward Mission Leader · ${profile.ward?.name ?? '—'}`
            : `${profile.role === 'stake_president' ? 'Stake President' : 'Stake Missionary HC'} · ${profile.stake?.name ?? '—'}`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <LinkCard
          to="/admin/members"
          title="Members"
          body={
            isWardScope
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
        <PlaceholderCard title="Settings" body="Interest tags, companionships, admins." />
      </div>

      <p className="text-xs text-gray-400">
        Phase 1 shell — individual tabs come online as each Phase 1 milestone lands.
      </p>
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

function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="suite-card p-5 space-y-2 opacity-70">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-600">{body}</p>
      <p className="text-xs text-gray-400 pt-2">Coming later in Phase 1</p>
    </div>
  )
}

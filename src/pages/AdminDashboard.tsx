import { useOutletContext } from 'react-router-dom'
import type { AdminProfile } from '@/lib/useAdmin'

type Ctx = { profile: AdminProfile }

export default function AdminDashboard() {
  const { profile } = useOutletContext<Ctx>()
  const isWardScope = profile.role === 'ward_mission_leader'

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">
          {greeting(profile.name ?? profile.email)}
        </h1>
        <p className="text-slate-600 mt-1">
          {isWardScope
            ? `Ward Mission Leader · ${profile.ward?.name ?? '—'}`
            : `${profile.role === 'stake_president' ? 'Stake President' : 'Stake Missionary HC'} · ${profile.stake?.name ?? '—'}`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <PlaceholderCard
          title="Members"
          body={isWardScope ? 'Invite members, see who\'s active, review availability.' : 'See member engagement across the stake.'}
        />
        <PlaceholderCard
          title="Friends being taught"
          body="Roster of people the missionaries are fellowshipping."
        />
        <PlaceholderCard title="Outings" body="Log completed outings, see upcoming." />
        <PlaceholderCard title="Suggestions" body="Who should go with which friend?" />
        {isWardScope ? (
          <PlaceholderCard title="Sheet" body="Google Sheet setup for your companionships." />
        ) : null}
        <PlaceholderCard title="Settings" body="Interest tags, companionships, admins." />
      </div>

      <p className="text-xs text-slate-400">
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

function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
      <h2 className="font-medium text-slate-900">{title}</h2>
      <p className="text-sm text-slate-600">{body}</p>
      <p className="text-xs text-slate-400 pt-2">Coming in Phase 1</p>
    </div>
  )
}

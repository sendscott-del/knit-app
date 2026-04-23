import { useParams } from 'react-router-dom'

export default function MemberMagicLink() {
  const { memberId, token } = useParams()
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-3xl font-semibold text-slate-900">Welcome</h1>
        <p className="text-slate-600">
          Your sign-in link will be verified here once the member flow is built.
        </p>
        <p className="text-xs text-slate-400 mt-4">
          Member {memberId?.slice(0, 8)}… · token {token?.slice(0, 6)}…
        </p>
      </div>
    </main>
  )
}

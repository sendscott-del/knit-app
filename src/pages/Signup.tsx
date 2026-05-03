import { Link } from 'react-router-dom'
import KnitMark from '@/components/KnitMark'

export default function Signup() {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-brand-primary text-white">
        <div className="max-w-md mx-auto px-6 pt-16 pb-20 text-center">
          <Link to="/" className="inline-flex flex-col items-center gap-3">
            <KnitMark size={56} />
            <span className="text-2xl font-semibold tracking-tight">Knit</span>
          </Link>
          <p className="text-base text-brand-primary-fade mt-4">Get access</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 -mt-12 pb-12 w-full">
        <div className="suite-card p-6 sm:p-8 space-y-6">
          <p className="text-base text-gray-700">
            Knit uses an email magic-link sign-in &mdash; no password to create. How you get access
            depends on your role:
          </p>

          <ol className="space-y-5 text-sm text-gray-700">
            <li>
              <p className="font-semibold text-gray-900">Stake President / Stake High Councilor (Missionary)</p>
              <p>
                You&rsquo;re seeded as an admin directly in the database. Tap{' '}
                <Link to="/admin/login" className="text-knit-primary underline font-semibold">Sign in</Link>,
                enter your email, then click the link we email you.
              </p>
            </li>
            <li>
              <p className="font-semibold text-gray-900">Ward Mission Leader</p>
              <p>
                Your stake&rsquo;s missionary high councilor invites you. Once they add your email,
                use the same{' '}
                <Link to="/admin/login" className="text-knit-primary underline font-semibold">Sign in</Link>
                {' '}page &mdash; no separate signup.
              </p>
            </li>
            <li>
              <p className="font-semibold text-gray-900">Member</p>
              <p>
                You don&rsquo;t sign in to Knit at all. The ward mission leader sends you a personal
                link by SMS &mdash; that link is your access. Tap it and you&rsquo;ll land on your{' '}
                <Link to="/me" className="text-knit-primary underline font-semibold">Me</Link>
                {' '}page where you can edit your availability, interests, and willingness.
              </p>
            </li>
          </ol>

          <div className="border-t border-gray-200 pt-4 space-y-3">
            <Link to="/admin/login" className="block w-full text-center py-2.5 bg-brand-primary text-white rounded-md text-sm font-semibold hover:opacity-90">
              Continue to sign in
            </Link>
            <p className="text-xs text-gray-500 text-center">
              Magic-link auth means no &ldquo;forgot password&rdquo; flow &mdash; if you can&rsquo;t get in, just request a fresh link.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}

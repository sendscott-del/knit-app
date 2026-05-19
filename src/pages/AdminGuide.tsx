import { Link } from 'react-router-dom'

/**
 * Knit user guide. Top-level prose explanation of what Knit does and how
 * the different roles use it. Updated alongside meaningful product changes;
 * for granular what-changed, point readers at /admin/release-notes.
 */
export default function AdminGuide() {
  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">User guide</h1>
        <p className="text-sm text-gray-500 mt-1">
          How Knit works, what each role can do, and where to start.
        </p>
      </header>

      <Section title="What is Knit?">
        <p>
          Knit pairs ward members with the people the missionaries are teaching, so
          investigators and recent converts gain real friendships in the ward — not
          just appointments. It tracks members, their availability and interests,
          the friends being taught, and the outings that bring them together.
        </p>
        <p>
          The name comes from <em>Mosiah 18:21</em> — "their hearts [were] knit
          together in unity and in love."
        </p>
      </Section>

      <Section title="Roles">
        <ul className="space-y-2">
          <li>
            <strong>Stake presidency &amp; high council</strong> — view-only across
            every ward in the stake.
          </li>
          <li>
            <strong>Ward mission leader</strong> — edit access for their ward.
            Adds members and friends, logs outings, and manages the ward's Google
            Sheet binding.
          </li>
          <li>
            <strong>Relief Society / Elders Quorum presidency</strong> — edit
            access for their ward, scoped to their auxiliary's members.
          </li>
          <li>
            <strong>Super admin</strong> — bypasses scope checks; manages users
            across the suite.
          </li>
        </ul>
      </Section>

      <Section title="Where to start">
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            <strong>Members</strong> — add the ward members who are available to
            befriend investigators. Capture availability and interests so Suggest
            can do its job.
          </li>
          <li>
            <strong>Friends</strong> — add the people the missionaries are
            teaching. Track which lessons they've had and what they enjoy.
          </li>
          <li>
            <strong>Suggest</strong> — see proposed pairings based on overlap.
          </li>
          <li>
            <strong>Outings</strong> — log when ward members and friends spend
            time together. Outings build the data Suggest learns from.
          </li>
        </ol>
      </Section>

      <Section title="Settings">
        <p>
          Stake / ward roster, sheet bindings, and your own account live under
          Settings. Demo mode (a safe way to walk a leader through Knit without
          touching real data) is enabled from Settings too — it is not a
          top-level tab.
        </p>
      </Section>

      <Section title="Language">
        <p>
          The EN / ES toggle in the top bar switches the interface language and
          remembers your preference. Spanish coverage is still being expanded —
          some long-form admin copy may stay English-only for now.
        </p>
      </Section>

      <footer className="pt-4 border-t border-gray-200 text-sm text-gray-500">
        See <Link to="/admin/release-notes" className="text-knit-primary font-medium hover:underline">release notes</Link> for
        the version-by-version history.
      </footer>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 text-sm text-gray-700 leading-relaxed">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  )
}

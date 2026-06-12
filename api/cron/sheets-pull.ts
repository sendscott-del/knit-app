import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyCron } from '../_lib/cronAuth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { pullSheet } from '../_lib/sheetPull.js'

/**
 * Every 5 minutes: scan every bound sheet's Suggestions, Log an Outing,
 * Add a Friend, Send Feedback, and Friends (Remove?) tabs for pending rows.
 *
 * Pulls bindings in BOTH `healthy` and `error` states — previously filtered
 * to healthy only, which meant a single transient push failure would mark a
 * binding `error` and silently drop every subsequent missionary write until
 * the next morning push recovered it. Now error bindings get pulled too; a
 * successful pull flips the binding back to healthy.
 *
 * Overlap guard: pg_cron fires every 5 minutes whether or not the previous
 * run finished. Two concurrent pulls both read unsynced rows before either
 * stamps them — duplicate outings/friends. Each binding is "claimed" by
 * setting last_pull_started_at; a claim younger than 4 minutes means another
 * run (cron or the admin Sync-now button) is still working that binding.
 *
 * Rate-limit retries happen per Sheets call inside the helpers; wrapping the
 * whole pullSheet in retryOn429 re-ran every read/write when one late call
 * hit quota — multiplying API usage exactly when quota was exhausted.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!verifyCron(req)) return res.status(401).json({ error: 'Unauthorized' })

  const sb = supabaseAdmin()
  const { data: bindings, error: bindingsErr } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, ward_id, sheet_id, status')
    .in('status', ['healthy', 'error'])
    .not('sheet_id', 'is', null)
  if (bindingsErr) {
    // Surface loudly — a silent empty list here looks like "nothing to do".
    return res.status(500).json({ error: `bindings query failed: ${bindingsErr.message}` })
  }

  const results: unknown[] = []
  let skippedInFlight = 0
  for (const b of bindings ?? []) {
    if (!b.sheet_id) continue

    // Claim the binding (conditional update = atomic test-and-set).
    const { data: claimed, error: claimErr } = await sb
      .from('knit_google_sheet_bindings')
      .update({ last_pull_started_at: new Date().toISOString() })
      .eq('id', b.id)
      .or(`last_pull_started_at.is.null,last_pull_started_at.lt.${new Date(Date.now() - 4 * 60_000).toISOString()}`)
      .select('id')
    if (claimErr) {
      results.push({ ward_id: b.ward_id, error: `claim failed: ${claimErr.message}` })
      continue
    }
    if (!claimed || claimed.length === 0) {
      skippedInFlight += 1
      continue
    }

    try {
      const report = await pullSheet({
        wardId: b.ward_id,
        spreadsheetId: b.sheet_id!,
      })
      // Per-tab failures are caught inside pullSheet and collected in the
      // report — they used to vanish into the (discarded) cron response while
      // the binding showed green. Surface them in last_error; the binding
      // stays healthy because the pull as a whole ran.
      const tabErrors = [
        ...report.suggestionErrors,
        ...report.outingErrors,
        ...report.feedbackErrors,
        ...report.friendErrors,
        ...report.friendRemovalErrors,
      ]
      await sb
        .from('knit_google_sheet_bindings')
        .update({
          last_pull_at: new Date().toISOString(),
          status: 'healthy',
          last_error: tabErrors.length
            ? `pull issues: ${tabErrors.join(' | ')}`.slice(0, 500)
            : null,
        })
        .eq('id', b.id)
      results.push({ ward_id: b.ward_id, report })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Surface pull failures on the binding row so admins see them in
      // /admin/sheet rather than only in cron response bodies.
      await sb
        .from('knit_google_sheet_bindings')
        .update({ status: 'error', last_error: `pull failed: ${msg}`.slice(0, 500) })
        .eq('id', b.id)
      results.push({ ward_id: b.ward_id, error: msg })
    }
  }

  return res.status(200).json({
    processed: results.length,
    skipped_in_flight: skippedInFlight,
    successes: results.filter((r) => (r as { error?: string }).error == null).length,
    failures: results.filter((r) => (r as { error?: string }).error != null).length,
    results,
  })
}

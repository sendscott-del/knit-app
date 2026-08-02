import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyCron } from '../_lib/cronAuth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { pullSheet, peekSheet } from '../_lib/sheetPull.js'

/**
 * Every 5 minutes: scan every bound sheet's Suggestions, Log an Outing,
 * Add a Friend, Send Feedback, and Friends (Remove?) tabs for pending rows.
 *
 * Idle bindings do ZERO database work. Each binding is peeked first — the
 * sheet tabs are fetched from Google (no DB) and checked for a pending
 * missionary request. Only when there's real work (or the hourly roster
 * refresh is due) does the run touch Postgres: claim, pull, finalize. This
 * was added because the per-binding "claim" + "finalize" UPDATEs fired for
 * all 10 bindings every 5 minutes regardless of activity and were ~46% of
 * the whole shared instance's write IO — nearly all of it on quiet wards.
 * Quiet wards now get at most a throttled last_pull_at heartbeat.
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
 * run (cron or the admin Sync-now button) is still working that binding. The
 * claim is now taken only when there's work, so a race can only occur when
 * two runs both see the same pending row — exactly the case it guards.
 *
 * Rate-limit retries happen per Sheets call inside the helpers; wrapping the
 * whole pullSheet in retryOn429 re-ran every read/write when one late call
 * hit quota — multiplying API usage exactly when quota was exhausted.
 */
// Refresh the hidden roster + dropdowns at most this often per binding (the
// roster only changes on the nightly Tidings sync or an occasional opt-out).
const ROSTER_REFRESH_MS = 55 * 60_000
// On a fully idle binding, still bump last_pull_at this often so /admin/sheet
// shows a live heartbeat rather than a stale "last pulled hours ago".
const IDLE_HEARTBEAT_MS = 30 * 60_000

const olderThan = (ts: string | null, ms: number) =>
  !ts || Date.now() - new Date(ts).getTime() > ms

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!verifyCron(req)) return res.status(401).json({ error: 'Unauthorized' })

  const sb = supabaseAdmin()
  const { data: bindings, error: bindingsErr } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, ward_id, sheet_id, status, last_pull_at, last_roster_refresh_at')
    .in('status', ['healthy', 'error'])
    .not('sheet_id', 'is', null)
  if (bindingsErr) {
    // Surface loudly — a silent empty list here looks like "nothing to do".
    return res.status(500).json({ error: `bindings query failed: ${bindingsErr.message}` })
  }

  const results: unknown[] = []
  let skippedInFlight = 0
  let skippedIdle = 0
  let heartbeats = 0
  for (const b of bindings ?? []) {
    if (!b.sheet_id) continue

    const rosterDue = olderThan(b.last_roster_refresh_at as string | null, ROSTER_REFRESH_MS)

    // Peek the sheet from Google (no DB write) to see if anything is pending.
    let hasWork: boolean
    let prefetch
    try {
      const peek = await peekSheet(b.sheet_id!)
      hasWork = peek.hasWork
      prefetch = peek.prefetch
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      results.push({ ward_id: b.ward_id, error: `peek failed: ${msg}` })
      continue
    }

    // Nothing to pull and roster not due → do no DB writes at all, beyond an
    // occasional heartbeat so the binding doesn't look stalled.
    if (!hasWork && !rosterDue) {
      if (olderThan(b.last_pull_at as string | null, IDLE_HEARTBEAT_MS)) {
        await sb
          .from('knit_google_sheet_bindings')
          .update({ last_pull_at: new Date().toISOString() })
          .eq('id', b.id)
        heartbeats += 1
      }
      skippedIdle += 1
      continue
    }

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
        prefetch,
        refreshRoster: rosterDue,
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
          // Only stamped on the hourly roster cadence so the throttle in the
          // idle branch can tell when the next refresh is due.
          ...(rosterDue ? { last_roster_refresh_at: new Date().toISOString() } : {}),
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
    skipped_idle: skippedIdle,
    heartbeats,
    successes: results.filter((r) => (r as { error?: string }).error == null).length,
    failures: results.filter((r) => (r as { error?: string }).error != null).length,
    results,
  })
}

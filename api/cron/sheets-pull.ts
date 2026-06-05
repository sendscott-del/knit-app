import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyCron } from '../_lib/cronAuth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { pullSheet } from '../_lib/sheetPull.js'
import { retryOn429 } from '../_lib/sheets.js'
import { logServerEvent } from '../_lib/logEvent.js'

/**
 * Every 5 minutes: scan every bound sheet's Suggestions, Log an Outing,
 * Add a Friend, Send Feedback, and Friends (Remove?) tabs for pending rows.
 *
 * Pulls bindings in BOTH `healthy` and `error` states — previously filtered
 * to healthy only, which meant a single transient push failure would mark a
 * binding `error` and silently drop every subsequent missionary write until
 * the next morning push recovered it. Now error bindings get pulled too; a
 * successful pull flips the binding back to healthy.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!verifyCron(req)) return res.status(401).json({ error: 'Unauthorized' })

  const sb = supabaseAdmin()
  const { data: bindings } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, ward_id, sheet_id, status')
    .in('status', ['healthy', 'error'])
    .not('sheet_id', 'is', null)

  const results: unknown[] = []
  for (const b of bindings ?? []) {
    if (!b.sheet_id) continue
    try {
      const report = await retryOn429(() =>
        pullSheet({
          wardId: b.ward_id,
          spreadsheetId: b.sheet_id!,
        }),
      )
      // Pull succeeded — flip status back to healthy and clear last_error.
      await sb
        .from('knit_google_sheet_bindings')
        .update({
          last_pull_at: new Date().toISOString(),
          status: 'healthy',
          last_error: null,
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
      await logServerEvent({
        name: 'cron_sheets_pull_failed',
        message: msg,
        route: '/api/cron/sheets-pull',
        ward_id: b.ward_id,
      })
      results.push({ ward_id: b.ward_id, error: msg })
    }
  }

  return res.status(200).json({
    processed: results.length,
    successes: results.filter((r) => (r as { error?: string }).error == null).length,
    failures: results.filter((r) => (r as { error?: string }).error != null).length,
    results,
  })
}

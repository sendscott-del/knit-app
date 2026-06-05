import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyCron } from '../_lib/cronAuth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { populateDataTabs } from '../_lib/sheetSync.js'
import { formatGoogleError, retryOn429 } from '../_lib/sheets.js'
import { reconcileBindingAccess } from '../_lib/sheetAccess.js'
import { logServerEvent } from '../_lib/logEvent.js'

/**
 * Daily: refresh Available This Week, Friends We are Teaching, Recent Outings
 * on every bound sheet. Hit by Vercel Cron.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!verifyCron(req)) return res.status(401).json({ error: 'Unauthorized' })

  const sb = supabaseAdmin()
  const { data: bindings } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, ward_id, sheet_id, status')
    .not('sheet_id', 'is', null)

  const results: Array<{
    ward_id: string
    ok: boolean
    error?: string
    access_added?: string[]
    access_errors?: string[]
  }> = []
  for (const b of bindings ?? []) {
    if (!b.sheet_id) continue
    let accessAdded: string[] = []
    let accessErrors: string[] = []
    try {
      // populateDataTabs already re-applies protections; calling
      // protectSpreadsheet again here doubled the protection writes.
      // retryOn429 absorbs the transient quota bursts that used to mark
      // bindings status=error on the first ward of a busy run.
      await retryOn429(() =>
        populateDataTabs({ spreadsheetId: b.sheet_id!, wardId: b.ward_id }),
      )
      // Same sweep also picks up any new Knit admins (e.g. someone granted
      // via Gathered's cross-app RPC) and shares the sheet with them.
      // Non-fatal — Drive errors here don't mark the binding unhealthy.
      try {
        const report = await reconcileBindingAccess(sb, b.id)
        accessAdded = report.added
        accessErrors = report.errors
      } catch (e) {
        accessErrors.push(e instanceof Error ? e.message : String(e))
      }
      await sb
        .from('knit_google_sheet_bindings')
        .update({
          status: 'healthy',
          last_push_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', b.id)
      results.push({
        ward_id: b.ward_id,
        ok: true,
        access_added: accessAdded,
        access_errors: accessErrors,
      })
    } catch (e) {
      const msg = formatGoogleError(e)
      await sb
        .from('knit_google_sheet_bindings')
        .update({ status: 'error', last_error: msg })
        .eq('id', b.id)
      await logServerEvent({
        name: 'cron_sheets_push_failed',
        message: msg,
        route: '/api/cron/sheets-morning-push',
        ward_id: b.ward_id,
      })
      results.push({ ward_id: b.ward_id, ok: false, error: msg })
    }
  }

  return res.status(200).json({
    processed: results.length,
    successes: results.filter((r) => r.ok).length,
    failures: results.filter((r) => !r.ok).length,
    access_added_total: results.reduce(
      (n, r) => n + (r.access_added?.length ?? 0),
      0,
    ),
    results,
  })
}

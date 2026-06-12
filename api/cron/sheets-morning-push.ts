import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyCron } from '../_lib/cronAuth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { populateDataTabs } from '../_lib/sheetSync.js'
import { pullSheet } from '../_lib/sheetPull.js'
import { formatGoogleError } from '../_lib/sheets.js'
import { reconcileBindingAccess } from '../_lib/sheetAccess.js'

/**
 * Daily: refresh Available This Week, Friends We are Teaching, Recent Outings
 * on every bound sheet. Hit by Vercel Cron.
 *
 * Pull BEFORE push: the push rewrites the Friends tab (clearing Remove?
 * checkboxes) and the entry tabs' stamped columns. A Remove? checked in the
 * minutes before the push used to be silently destroyed. Running a full pull
 * first banks every pending missionary entry before anything is rewritten.
 *
 * Rate-limit retries happen per Sheets call inside the helpers (see
 * sheets.ts retryOn429 note) — no whole-routine retry here.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!verifyCron(req)) return res.status(401).json({ error: 'Unauthorized' })

  const sb = supabaseAdmin()
  const { data: bindings, error: bindingsErr } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, ward_id, sheet_id, status')
    .not('sheet_id', 'is', null)
  if (bindingsErr) {
    return res.status(500).json({ error: `bindings query failed: ${bindingsErr.message}` })
  }

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
      // Bank pending missionary entries (outings, new friends, removals,
      // feedback) before the rewrite below clears their checkboxes/stamps.
      await pullSheet({ wardId: b.ward_id, spreadsheetId: b.sheet_id! })

      // populateDataTabs already re-applies protections; calling
      // protectSpreadsheet again here doubled the protection writes.
      await populateDataTabs({ spreadsheetId: b.sheet_id!, wardId: b.ward_id })
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

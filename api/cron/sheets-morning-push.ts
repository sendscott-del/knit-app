import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyCron } from '../_lib/cronAuth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { populateDataTabs, protectSpreadsheet } from '../_lib/sheetSync.js'
import { formatGoogleError } from '../_lib/sheets.js'

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

  const results: Array<{ ward_id: string; ok: boolean; error?: string }> = []
  for (const b of bindings ?? []) {
    if (!b.sheet_id) continue
    try {
      await populateDataTabs({ spreadsheetId: b.sheet_id, wardId: b.ward_id })
      // Idempotent — existing bindings auto-upgrade to the protection rules
      // and any drift (manually-removed protection) heals on the next cron tick.
      await protectSpreadsheet(b.sheet_id)
      await sb
        .from('knit_google_sheet_bindings')
        .update({
          status: 'healthy',
          last_push_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', b.id)
      results.push({ ward_id: b.ward_id, ok: true })
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
    results,
  })
}

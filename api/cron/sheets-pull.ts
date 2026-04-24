import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyCron } from '../_lib/cronAuth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { pullSheet } from '../_lib/sheetPull.js'

/**
 * Every N minutes (Vercel Pro schedule): scan every bound sheet's Suggestions
 * and Log an Outing tabs for pending rows; generate + write suggestions,
 * insert outing rows, and checkmark synced rows.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!verifyCron(req)) return res.status(401).json({ error: 'Unauthorized' })

  const sb = supabaseAdmin()
  const { data: bindings } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, ward_id, sheet_id, status')
    .eq('status', 'healthy')
    .not('sheet_id', 'is', null)

  const results: unknown[] = []
  for (const b of bindings ?? []) {
    if (!b.sheet_id) continue
    try {
      const report = await pullSheet({
        wardId: b.ward_id,
        spreadsheetId: b.sheet_id,
      })
      await sb
        .from('knit_google_sheet_bindings')
        .update({ last_pull_at: new Date().toISOString() })
        .eq('id', b.id)
      results.push({ ward_id: b.ward_id, report })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      results.push({ ward_id: b.ward_id, error: msg })
    }
  }

  return res.status(200).json({ processed: results.length, results })
}

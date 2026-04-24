import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  requireAdmin,
  adminCanActOnWard,
  roleIsWritable,
} from '../../_lib/auth.js'
import { supabaseAdmin } from '../../_lib/supabaseAdmin.js'
import {
  createSpreadsheetAsUser,
  shareFileAsUser,
  ensureTabs,
  formatGoogleError,
} from '../../_lib/sheets.js'
import { bindSpreadsheet, TAB_ORDER } from '../../_lib/sheetSync.js'
import { userClientFrom } from '../../_lib/googleOAuth.js'

/**
 * Auto-create a Google Sheet in the connected admin's Drive, share it with
 * the service account (for ongoing writes) and the missionary gmails, lay out
 * the 7 tabs, populate headers + initial data, store the binding.
 *
 * Requires /api/admin/google/authorize to have been completed for the stake.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })

  const { wardId, emails } = (req.body ?? {}) as {
    wardId?: string
    emails?: string[]
  }
  if (!wardId) return res.status(400).json({ error: 'Missing wardId' })
  if (!roleIsWritable(auth.admin.role)) {
    return res.status(403).json({ error: 'Your role cannot create a sheet' })
  }
  if (!(await adminCanActOnWard(auth.admin, wardId))) {
    return res.status(403).json({ error: 'This ward is outside your scope' })
  }
  if (!auth.admin.stake_id) {
    return res.status(400).json({ error: 'Your admin account has no stake' })
  }

  const sb = supabaseAdmin()

  // 1. Load the stake's OAuth refresh token
  const { data: oauth } = await sb
    .from('knit_google_oauth')
    .select('refresh_token, granted_by_email')
    .eq('stake_id', auth.admin.stake_id)
    .maybeSingle()
  if (!oauth) {
    return res.status(412).json({
      error:
        'No Google account connected for your stake yet. Click "Connect Google Account" first.',
      code: 'OAUTH_REQUIRED',
    })
  }

  // 2. Load ward name + existing binding
  const { data: ward } = await sb
    .from('knit_wards')
    .select('id, name')
    .eq('id', wardId)
    .single()
  if (!ward) return res.status(404).json({ error: 'Ward not found' })

  const { data: existing } = await sb
    .from('knit_google_sheet_bindings')
    .select('*')
    .eq('ward_id', wardId)
    .maybeSingle()
  if (existing && existing.sheet_id && existing.status === 'healthy') {
    return res.status(409).json({
      error:
        'A sheet is already bound to this ward. Disconnect or delete the old binding first.',
      binding: existing,
    })
  }

  const normalizedEmails = (emails ?? [])
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && e.includes('@'))

  try {
    // 3. Create the sheet in the connected user's Drive
    const userClient = userClientFrom(oauth.refresh_token)
    const title = `Knit — ${ward.name}`
    const sheet = await createSpreadsheetAsUser(userClient, title)

    // 4. Share with the service account so ongoing writes don't need OAuth
    const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    if (saEmail) {
      await shareFileAsUser(userClient, sheet.spreadsheetId, [saEmail], {
        sendNotificationEmail: false,
      })
    }

    // 5. Share with missionary gmails (notify=true so they get the Drive email)
    if (normalizedEmails.length > 0) {
      await shareFileAsUser(
        userClient,
        sheet.spreadsheetId,
        normalizedEmails,
        { sendNotificationEmail: true },
      )
    }

    // 6. Now the SA has edit access — use it (no OAuth needed) to lay out tabs + data
    await ensureTabs(sheet.spreadsheetId, TAB_ORDER)
    await bindSpreadsheet(sheet.spreadsheetId, ward.name, wardId)

    // 7. Store binding
    const nowIso = new Date().toISOString()
    const payload = {
      ward_id: wardId,
      sheet_id: sheet.spreadsheetId,
      sheet_url: sheet.spreadsheetUrl,
      shared_emails: normalizedEmails,
      status: 'healthy' as const,
      last_push_at: nowIso,
      last_error: null,
    }
    if (existing) {
      await sb
        .from('knit_google_sheet_bindings')
        .update(payload)
        .eq('id', existing.id)
    } else {
      await sb.from('knit_google_sheet_bindings').insert(payload)
    }

    // Record last-used
    await sb
      .from('knit_google_oauth')
      .update({ last_used_at: nowIso })
      .eq('stake_id', auth.admin.stake_id)

    return res.status(200).json({
      binding: {
        sheet_id: sheet.spreadsheetId,
        sheet_url: sheet.spreadsheetUrl,
        shared_emails: normalizedEmails,
        status: 'healthy',
        last_push_at: nowIso,
      },
    })
  } catch (e) {
    const message = formatGoogleError(e)
    await sb.from('knit_google_sheet_bindings').upsert(
      {
        ward_id: wardId,
        status: 'error',
        last_error: message,
        shared_emails: normalizedEmails,
      },
      { onConflict: 'ward_id' },
    )
    return res.status(500).json({ error: message })
  }
}

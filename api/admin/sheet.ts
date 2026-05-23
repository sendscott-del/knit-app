import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  requireAdmin,
  adminCanActOnWard,
  adminCanViewWard,
  adminCanWrite,
  type AuthenticatedAdmin,
} from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import {
  createSpreadsheetAsUser,
  shareFileAsUser,
  ensureTabs,
  formatGoogleError,
} from '../_lib/sheets.js'
import {
  bindSpreadsheet,
  populateDataTabs,
  protectSpreadsheet,
  TAB_ORDER,
} from '../_lib/sheetSync.js'
import { pullSheet } from '../_lib/sheetPull.js'
import { userClientFrom } from '../_lib/googleOAuth.js'

/**
 * Consolidated sheet admin endpoint. Replaces the former
 * /api/admin/sheet/{get,create,refresh,sync-now} files — same set of
 * actions, one file, to stay under Vercel Hobby's 12-function cap as
 * the API surface grows. Auth still happens per-action.
 *
 *   GET  /api/admin/sheet?action=get&wardId=...
 *   POST /api/admin/sheet  { action: 'create',   wardId, emails }
 *   POST /api/admin/sheet  { action: 'refresh',  wardId }
 *   POST /api/admin/sheet  { action: 'sync_now', wardId }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const action = (req.query.action as string | undefined) ?? 'get'
    if (action !== 'get') return res.status(400).json({ error: 'Unknown GET action' })
    return getBinding(req, res)
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const body = (req.body ?? {}) as { action?: string }
  switch (body.action) {
    case 'create':
      return createSheet(req, res)
    case 'refresh':
      return refreshSheet(req, res)
    case 'sync_now':
      return syncNow(req, res)
    default:
      return res.status(400).json({ error: 'Unknown action' })
  }
}

async function getBinding(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const wardId = (req.query.wardId as string | undefined) ?? ''
  if (!wardId) return res.status(400).json({ error: 'Missing wardId' })
  if (!(await adminCanViewWard(auth.admin, wardId))) {
    return res.status(403).json({ error: 'This ward is outside your scope' })
  }
  const sb = supabaseAdmin()
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('*')
    .eq('ward_id', wardId)
    .maybeSingle()
  return res.status(200).json({ binding })
}

async function refreshSheet(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const { wardId } = (req.body ?? {}) as { wardId?: string }
  const guard = await requireWardWrite(auth, wardId, res)
  if (!guard) return
  const sb = supabaseAdmin()
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('*')
    .eq('ward_id', guard.wardId)
    .maybeSingle()
  if (!binding || !binding.sheet_id) {
    return res.status(404).json({ error: 'No sheet bound for this ward' })
  }
  try {
    await populateDataTabs({ spreadsheetId: binding.sheet_id, wardId: guard.wardId })
    await protectSpreadsheet(binding.sheet_id)
    const nowIso = new Date().toISOString()
    await sb
      .from('knit_google_sheet_bindings')
      .update({ status: 'healthy', last_push_at: nowIso, last_error: null })
      .eq('id', binding.id)
    return res.status(200).json({ last_push_at: nowIso })
  } catch (e) {
    const message = formatGoogleError(e)
    await sb
      .from('knit_google_sheet_bindings')
      .update({ status: 'error', last_error: message })
      .eq('id', binding.id)
    return res.status(500).json({ error: message })
  }
}

async function syncNow(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const { wardId } = (req.body ?? {}) as { wardId?: string }
  const guard = await requireWardWrite(auth, wardId, res)
  if (!guard) return
  const sb = supabaseAdmin()
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, sheet_id')
    .eq('ward_id', guard.wardId)
    .maybeSingle()
  if (!binding?.sheet_id) {
    return res.status(404).json({ error: 'No sheet bound for this ward' })
  }
  try {
    const report = await pullSheet({
      wardId: guard.wardId,
      spreadsheetId: binding.sheet_id,
    })
    await sb
      .from('knit_google_sheet_bindings')
      .update({ last_pull_at: new Date().toISOString() })
      .eq('id', binding.id)
    return res.status(200).json({ report })
  } catch (e) {
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) })
  }
}

async function createSheet(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const { wardId, emails } = (req.body ?? {}) as {
    wardId?: string
    emails?: string[]
  }
  const guard = await requireWardWrite(auth, wardId, res)
  if (!guard) return
  if (!auth.admin.stake_id) {
    return res.status(400).json({ error: 'Your admin account has no stake' })
  }

  const sb = supabaseAdmin()
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

  const { data: ward } = await sb
    .from('knit_wards')
    .select('id, name')
    .eq('id', guard.wardId)
    .single()
  if (!ward) return res.status(404).json({ error: 'Ward not found' })

  const { data: existing } = await sb
    .from('knit_google_sheet_bindings')
    .select('*')
    .eq('ward_id', guard.wardId)
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
    const userClient = userClientFrom(oauth.refresh_token)
    const title = `Knit — ${ward.name}`
    const sheet = await createSpreadsheetAsUser(userClient, title)

    const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    if (saEmail) {
      await shareFileAsUser(userClient, sheet.spreadsheetId, [saEmail], {
        sendNotificationEmail: false,
      })
    }
    if (normalizedEmails.length > 0) {
      await shareFileAsUser(
        userClient,
        sheet.spreadsheetId,
        normalizedEmails,
        { sendNotificationEmail: true },
      )
    }

    await ensureTabs(sheet.spreadsheetId, TAB_ORDER)
    await bindSpreadsheet(sheet.spreadsheetId, ward.name, guard.wardId)

    const nowIso = new Date().toISOString()
    const payload = {
      ward_id: guard.wardId,
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
        ward_id: guard.wardId,
        status: 'error',
        last_error: message,
        shared_emails: normalizedEmails,
      },
      { onConflict: 'ward_id' },
    )
    return res.status(500).json({ error: message })
  }
}

/**
 * Shared write-permission gate: ensures we have a wardId, the role can
 * write, and the ward is in the admin's scope. Returns { wardId } on
 * success or sends a 4xx and returns null.
 */
async function requireWardWrite(
  auth: AuthenticatedAdmin,
  wardId: string | undefined,
  res: VercelResponse,
): Promise<{ wardId: string } | null> {
  if (!wardId) {
    res.status(400).json({ error: 'Missing wardId' })
    return null
  }
  if (!adminCanWrite(auth.admin)) {
    res.status(403).json({ error: 'Your role cannot perform this action' })
    return null
  }
  if (!(await adminCanActOnWard(auth.admin, wardId))) {
    res.status(403).json({ error: 'This ward is outside your scope' })
    return null
  }
  return { wardId }
}

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { google } from 'googleapis'
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
import { reconcileAdminAccess } from '../_lib/sheetAccess.js'
import { getAuth as getServiceAccountAuth } from '../_lib/sheets.js'

/**
 * Drive v3 client authed as the Knit service account. The SA has full
 * `drive` scope and is added as Editor on every sheet at creation, so it
 * can run permissions.* calls without the silent per-personal-Gmail share
 * rate limits that were eating v0.43.x shares. Share / unshare / verify /
 * resync paths all use this; sheet creation + push still use the user
 * OAuth because those operate inside the user's Drive.
 */
function driveAsServiceAccount() {
  return google.drive({ version: 'v3', auth: getServiceAccountAuth() })
}

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
    case 'share_emails':
      return shareEmails(req, res)
    case 'unshare_email':
      return unshareEmail(req, res)
    case 'share_with_admins':
      return shareWithAdmins(req, res)
    case 'ensure_my_access':
      return ensureMyAccess(req, res)
    case 'verify_access':
      return verifyAccess(req, res)
    case 'force_resync_access':
      return forceResyncAccess(req, res)
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
 * Adds new editor permissions on the bound sheet for the given ward. Skips
 * any emails already in `shared_emails`, persists the merged list on the
 * binding, and is idempotent against Google's "already shared" 400 errors.
 */
async function shareEmails(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const { wardId, emails } = (req.body ?? {}) as {
    wardId?: string
    emails?: string[]
  }
  const guard = await requireWardWrite(auth, wardId, res)
  if (!guard) return

  const normalized = (emails ?? [])
    .map((e) => String(e ?? '').trim().toLowerCase())
    .filter((e) => e.length > 0 && e.includes('@'))
  if (normalized.length === 0) {
    return res.status(400).json({ error: 'No valid emails provided' })
  }

  const sb = supabaseAdmin()
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, sheet_id, shared_emails, ward_id')
    .eq('ward_id', guard.wardId)
    .maybeSingle()
  if (!binding?.sheet_id) {
    return res.status(404).json({ error: 'No sheet bound for this ward' })
  }

  const confirmedShared: string[] = []
  const shareErrors: Array<{ email: string; error: string }> = []
  try {
    const drive = driveAsServiceAccount()
    // Always dedupe against Drive truth — shared_emails has lied in the
    // past. Anyone the caller asked for who isn't already on Drive gets
    // a fresh share attempt.
    const livePerms = await listDriveUserEmails(drive, binding.sheet_id)
    const toAttempt = normalized.filter((e) => !livePerms.has(e))
    const alreadyShared = normalized.filter((e) => livePerms.has(e))

    for (const e of toAttempt) {
      try {
        await drive.permissions.create({
          fileId: binding.sheet_id,
          requestBody: { role: 'writer', type: 'user', emailAddress: e },
          sendNotificationEmail: true,
        })
        confirmedShared.push(e)
      } catch (err) {
        shareErrors.push({
          email: e,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    const finalLive = new Set(livePerms)
    for (const e of confirmedShared) finalLive.add(e)
    const merged = Array.from(finalLive).sort()
    await sb
      .from('knit_google_sheet_bindings')
      .update({ shared_emails: merged })
      .eq('id', binding.id)
    return res.status(200).json({
      shared_emails: merged,
      added: confirmedShared,
      already_shared: alreadyShared,
      errors: shareErrors,
    })
  } catch (e) {
    return res.status(500).json({ error: formatGoogleError(e) })
  }
}

/**
 * Revokes a single email's Drive permission on the bound sheet and drops it
 * from `shared_emails`. Safe to call for emails that aren't currently shared.
 */
async function unshareEmail(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const { wardId, email } = (req.body ?? {}) as {
    wardId?: string
    email?: string
  }
  const guard = await requireWardWrite(auth, wardId, res)
  if (!guard) return
  const normalized = String(email ?? '').trim().toLowerCase()
  if (!normalized.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' })
  }

  const sb = supabaseAdmin()
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, sheet_id, shared_emails, ward_id')
    .eq('ward_id', guard.wardId)
    .maybeSingle()
  if (!binding?.sheet_id) {
    return res.status(404).json({ error: 'No sheet bound for this ward' })
  }

  try {
    const drive = driveAsServiceAccount()
    // Look up the permission ID for this email so we can delete it.
    const perms = await drive.permissions.list({
      fileId: binding.sheet_id,
      fields: 'permissions(id, emailAddress, role, type)',
    })
    const match = (perms.data.permissions ?? []).find(
      (p) =>
        (p.emailAddress ?? '').toLowerCase() === normalized && p.type === 'user',
    )
    if (match?.id) {
      await drive.permissions.delete({
        fileId: binding.sheet_id,
        permissionId: match.id,
      })
    }
    const remaining = (binding.shared_emails ?? []).filter(
      (e: string) => e.toLowerCase() !== normalized,
    )
    await sb
      .from('knit_google_sheet_bindings')
      .update({ shared_emails: remaining })
      .eq('id', binding.id)
    return res
      .status(200)
      .json({ shared_emails: remaining, removed: match?.id ? normalized : null })
  } catch (e) {
    return res.status(500).json({ error: formatGoogleError(e) })
  }
}

/**
 * Auto-grant: ensure the calling admin has Drive perms on every sheet they
 * can view. Called from AdminLayout on sign-in so a Gathered cross-app grant
 * doesn't leave the admin needing a separate "Request access" round-trip to
 * Google. Always returns 200 — failures land in the response body, never as
 * a thrown error, because this is best-effort.
 */
async function ensureMyAccess(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const sb = supabaseAdmin()
    const report = await reconcileAdminAccess(sb, auth.userId)
    return res.status(200).json(report)
  } catch (e) {
    return res
      .status(200)
      .json({ added_wards: [], errors: [e instanceof Error ? e.message : String(e)] })
  }
}

/**
 * Shares the bound sheet with every Knit admin who can view this ward:
 *   - super admins (can view everything)
 *   - stake-scoped admins (stake_presidency, high_councilor) in the same stake
 *   - ward-scoped admins assigned to this ward
 * Idempotent. Useful after a new admin is granted via Gathered's cross-app
 * RPC (which creates the knit_admin_users row but doesn't touch Drive perms).
 */
async function shareWithAdmins(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const { wardId } = (req.body ?? {}) as { wardId?: string }
  const guard = await requireWardWrite(auth, wardId, res)
  if (!guard) return

  const sb = supabaseAdmin()
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, sheet_id, shared_emails')
    .eq('ward_id', guard.wardId)
    .maybeSingle()
  if (!binding?.sheet_id) {
    return res.status(404).json({ error: 'No sheet bound for this ward' })
  }

  const { data: ward } = await sb
    .from('knit_wards')
    .select('stake_id')
    .eq('id', guard.wardId)
    .single()
  const stakeId = (ward as { stake_id: string } | null)?.stake_id
  if (!stakeId) return res.status(404).json({ error: 'Ward stake not found' })

  // All Knit admins who can view this ward.
  const { data: adminsRaw } = await sb
    .from('knit_admin_users')
    .select('email, role, ward_id, stake_id, is_super_admin')
  const admins = (adminsRaw ?? []) as Array<{
    email: string
    role: string
    ward_id: string | null
    stake_id: string | null
    is_super_admin: boolean
  }>
  const STAKE_VIEW_ROLES = new Set(['stake_presidency', 'high_councilor'])
  const eligibleEmails = admins
    .filter((a) => {
      if (!a.email) return false
      if (a.is_super_admin) return true
      if (STAKE_VIEW_ROLES.has(a.role)) return a.stake_id === stakeId
      return a.ward_id === guard.wardId
    })
    .map((a) => a.email.toLowerCase())

  if (eligibleEmails.length === 0) {
    return res.status(200).json({
      shared_emails: binding.shared_emails ?? [],
      added: [],
      already_shared: [],
    })
  }

  const confirmedShared: string[] = []
  const shareErrors: Array<{ email: string; error: string }> = []
  try {
    const drive = driveAsServiceAccount()
    // Dedupe against Drive truth, NOT shared_emails. Cache was polluted by
    // v0.43.x phantom shares — entries can exist in shared_emails while
    // Drive never accepted the share. Always re-attempt anyone Drive
    // doesn't actually know about.
    const livePerms = await listDriveUserEmails(drive, binding.sheet_id)
    const toAttempt = Array.from(new Set(eligibleEmails)).filter(
      (e) => !livePerms.has(e),
    )
    const alreadyShared = eligibleEmails.filter((e) => livePerms.has(e))

    for (const e of toAttempt) {
      try {
        await drive.permissions.create({
          fileId: binding.sheet_id,
          requestBody: { role: 'writer', type: 'user', emailAddress: e },
          sendNotificationEmail: true,
        })
        confirmedShared.push(e)
      } catch (err) {
        shareErrors.push({
          email: e,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Sync shared_emails to live Drive truth (after our adds). Drops any
    // phantom entries that never had a real Drive permission.
    const finalLive = new Set(livePerms)
    for (const e of confirmedShared) finalLive.add(e)
    const merged = Array.from(finalLive).sort()
    await sb
      .from('knit_google_sheet_bindings')
      .update({ shared_emails: merged })
      .eq('id', binding.id)
    return res.status(200).json({
      shared_emails: merged,
      added: confirmedShared,
      already_shared: alreadyShared,
      errors: shareErrors,
    })
  } catch (e) {
    return res.status(500).json({ error: formatGoogleError(e) })
  }
}

/**
 * Returns the set of lower-cased user emails actually present on a file's
 * Drive permission list. Ground truth when shared_emails is suspect.
 */
async function listDriveUserEmails(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drive: any,
  fileId: string,
): Promise<Set<string>> {
  const out = new Set<string>()
  try {
    const res = await drive.permissions.list({
      fileId,
      fields: 'permissions(emailAddress, type)',
    })
    for (const p of (res.data.permissions ?? []) as Array<{
      emailAddress?: string | null
      type?: string | null
    }>) {
      if (p.type === 'user' && p.emailAddress) {
        out.add(String(p.emailAddress).toLowerCase())
      }
    }
  } catch {
    // Caller will surface any downstream error itself.
  }
  return out
}

/**
 * Diagnostic: read-only. Compares shared_emails on the binding to the
 * actual Drive permissions for the bound sheet and returns the diff. Use
 * when a user reports they can't access a sheet the DB thinks they can.
 *
 *   POST /api/admin/sheet { action: 'verify_access', wardId }
 */
async function verifyAccess(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const { wardId } = (req.body ?? {}) as { wardId?: string }
  if (!wardId) return res.status(400).json({ error: 'Missing wardId' })
  if (!(await adminCanViewWard(auth.admin, wardId))) {
    return res.status(403).json({ error: 'This ward is outside your scope' })
  }

  const sb = supabaseAdmin()
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, sheet_id, shared_emails')
    .eq('ward_id', wardId)
    .maybeSingle()
  if (!binding?.sheet_id) {
    return res.status(404).json({ error: 'No sheet bound for this ward' })
  }

  try {
    const drive = driveAsServiceAccount()
    const live = await listDriveUserEmails(drive, binding.sheet_id)
    const cached = new Set(
      ((binding.shared_emails as string[] | null) ?? []).map((e) =>
        e.toLowerCase(),
      ),
    )
    const inDbNotOnDrive = [...cached].filter((e) => !live.has(e))
    const onDriveNotInDb = [...live].filter((e) => !cached.has(e))
    return res.status(200).json({
      sheet_id: binding.sheet_id,
      cached_emails: [...cached].sort(),
      live_emails: [...live].sort(),
      in_db_not_on_drive: inDbNotOnDrive,
      on_drive_not_in_db: onDriveNotInDb,
    })
  } catch (e) {
    return res.status(500).json({ error: formatGoogleError(e) })
  }
}

/**
 * Recovery: forces a fresh reconcile pass for a single email on a single
 * ward, ignoring shared_emails. Lists Drive perms, adds the email if not
 * present, surfaces any Drive error verbatim, then syncs shared_emails.
 *
 *   POST /api/admin/sheet { action: 'force_resync_access', wardId, email }
 */
async function forceResyncAccess(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const { wardId, email } = (req.body ?? {}) as {
    wardId?: string
    email?: string
  }
  const guard = await requireWardWrite(auth, wardId, res)
  if (!guard) return
  const normalized = String(email ?? '').trim().toLowerCase()
  if (!normalized.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' })
  }

  const sb = supabaseAdmin()
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, sheet_id, shared_emails')
    .eq('ward_id', guard.wardId)
    .maybeSingle()
  if (!binding?.sheet_id) {
    return res.status(404).json({ error: 'No sheet bound for this ward' })
  }

  try {
    const drive = driveAsServiceAccount()
    const live = await listDriveUserEmails(drive, binding.sheet_id)
    let driveAction: 'already_present' | 'created' | 'failed' = 'failed'
    let driveError: string | null = null
    if (live.has(normalized)) {
      driveAction = 'already_present'
    } else {
      try {
        await drive.permissions.create({
          fileId: binding.sheet_id,
          requestBody: {
            role: 'writer',
            type: 'user',
            emailAddress: email!.trim(),
          },
          sendNotificationEmail: true,
        })
        driveAction = 'created'
      } catch (err) {
        driveError = err instanceof Error ? err.message : String(err)
      }
    }

    // Sync shared_emails to live truth: keep everything Drive has, plus our
    // newly-confirmed email if create succeeded.
    const liveAfter = new Set(live)
    if (driveAction === 'created') liveAfter.add(normalized)
    const merged = Array.from(liveAfter).sort()
    await sb
      .from('knit_google_sheet_bindings')
      .update({ shared_emails: merged })
      .eq('id', binding.id)

    return res
      .status(driveAction === 'failed' ? 500 : 200)
      .json({ ward_id: guard.wardId, email: normalized, driveAction, driveError, shared_emails: merged })
  } catch (e) {
    return res.status(500).json({ error: formatGoogleError(e) })
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

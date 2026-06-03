import { google } from 'googleapis'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAuth as getServiceAccountAuth } from './sheets.js'

const STAKE_VIEW_ROLES = new Set(['stake_presidency', 'high_councilor'])

/**
 * Returns a Drive v3 client authed as the Knit service account. The SA is
 * added as Editor on every sheet at creation time (see api/admin/sheet.ts
 * createSheet → shareFileAsUser) and has the full `drive` scope, so it can
 * manage permissions on any bound sheet. Using the SA instead of the user's
 * OAuth refresh token sidesteps the per-personal-Gmail share rate limits
 * that were silently rejecting our v0.43.x shares — Drive returned a 4xx,
 * the old code treated it as 'already shared,' and shared_emails went out
 * of sync with reality.
 */
function driveAsServiceAccount() {
  return google.drive({ version: 'v3', auth: getServiceAccountAuth() })
}

export type BindingReconcileReport = {
  ward_id: string
  added: string[]
  already_shared: string[]
  errors: string[]
  skipped?: string
}

/**
 * Make sure every Knit admin who can view this ward also has Drive editor
 * access on the bound sheet. Idempotent — safe to call from cron, from the
 * admin sign-in path, and after any single admin grant.
 *
 * Eligibility mirrors `adminCanViewWard`:
 *   - super admins (any ward)
 *   - stake_presidency / high_councilor (any ward in the same stake)
 *   - ward-edit roles (WML / RSP / EQP) for matching ward_id
 *
 * Per-stake OAuth refresh token is required. If the stake hasn't connected
 * Google yet, returns a skipped report instead of throwing.
 */
export async function reconcileBindingAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
  bindingId: string,
): Promise<BindingReconcileReport> {
  const { data: binding } = await sb
    .from('knit_google_sheet_bindings')
    .select('id, sheet_id, shared_emails, ward_id')
    .eq('id', bindingId)
    .maybeSingle()
  if (!binding?.sheet_id) {
    return {
      ward_id: '',
      added: [],
      already_shared: [],
      errors: [],
      skipped: 'no binding',
    }
  }

  const wardId = binding.ward_id as string

  const { data: ward } = await sb
    .from('knit_wards')
    .select('stake_id')
    .eq('id', wardId)
    .single()
  const stakeId = (ward as { stake_id: string } | null)?.stake_id
  if (!stakeId) {
    return {
      ward_id: wardId,
      added: [],
      already_shared: [],
      errors: [],
      skipped: 'no stake on ward',
    }
  }

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
  const eligibleEmails = admins
    .filter((a) => {
      if (!a.email) return false
      if (a.is_super_admin) return true
      if (STAKE_VIEW_ROLES.has(a.role)) return a.stake_id === stakeId
      return a.ward_id === wardId
    })
    .map((a) => a.email.toLowerCase())

  const report: BindingReconcileReport = {
    ward_id: wardId,
    added: [],
    already_shared: [],
    errors: [],
  }

  try {
    // Service account — see comment above. Dedupe against Drive truth, NOT
    // shared_emails: the cache was polluted by v0.43.x's "treat 400 as
    // already shared" bug, so an email could be in shared_emails while
    // Drive never accepted the share. Anyone in shared_emails who isn't
    // actually on Drive must be re-shared.
    const drive = driveAsServiceAccount()
    const livePerms = await listDriveEmails(drive, binding.sheet_id)
    const toAttempt = Array.from(new Set(eligibleEmails)).filter(
      (e) => !livePerms.has(e),
    )
    report.already_shared = eligibleEmails.filter((e) => livePerms.has(e))

    for (const email of toAttempt) {
      try {
        await drive.permissions.create({
          fileId: binding.sheet_id,
          requestBody: { role: 'writer', type: 'user', emailAddress: email },
          // Silent for cron-driven reconciles — admins don't need an email
          // blast every morning when the sweep reconfirms existing access.
          // The explicit "Share with all current Knit admins" UI action and
          // the new-admin invite path still pass sendNotificationEmail: true.
          sendNotificationEmail: false,
        })
        report.added.push(email)
      } catch (err) {
        // Real error. Do NOT pretend the share succeeded — surface it.
        report.errors.push(
          `${email}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // Sync shared_emails to live Drive truth (after our adds): authoritative
    // source becomes Drive, not the cache. Anyone in shared_emails who isn't
    // on Drive gets dropped; anyone on Drive gets reflected.
    const finalLive = new Set(livePerms)
    for (const e of report.added) finalLive.add(e)
    const merged = Array.from(finalLive).sort()
    await sb
      .from('knit_google_sheet_bindings')
      .update({ shared_emails: merged })
      .eq('id', binding.id)
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err))
  }
  return report
}

/**
 * Returns the set of lower-cased user emails currently on a file's Drive
 * permission list. Used as ground truth when we can't trust shared_emails.
 */
async function listDriveEmails(
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
    for (const p of res.data.permissions ?? []) {
      if (p.type === 'user' && p.emailAddress) {
        out.add(String(p.emailAddress).toLowerCase())
      }
    }
  } catch {
    // If we can't list, return empty — callers will attempt to create and
    // surface any error there instead of silently pretending.
  }
  return out
}

/**
 * Reconcile a single admin's access — shares every bound sheet they can view
 * but aren't yet on. Cheaper path than `reconcileBindingAccess` looped, since
 * it pulls the admin row once and only touches bindings that mention them.
 *
 * Returns the wards we added the admin to (by ward_id).
 */
export async function reconcileAdminAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
  userId: string,
): Promise<{ added_wards: string[]; errors: string[] }> {
  const out = { added_wards: [] as string[], errors: [] as string[] }

  const { data: admin } = await sb
    .from('knit_admin_users')
    .select('email, role, stake_id, ward_id, is_super_admin')
    .eq('id', userId)
    .maybeSingle()
  if (!admin?.email || !admin.stake_id) return out

  const email = admin.email.toLowerCase()

  let bindingsQuery = sb
    .from('knit_google_sheet_bindings')
    .select('id, sheet_id, shared_emails, ward_id, knit_wards!inner(stake_id)')
    .not('sheet_id', 'is', null)

  if (
    admin.is_super_admin ||
    STAKE_VIEW_ROLES.has(admin.role)
  ) {
    bindingsQuery = bindingsQuery.eq('knit_wards.stake_id', admin.stake_id)
  } else if (admin.ward_id) {
    bindingsQuery = bindingsQuery.eq('ward_id', admin.ward_id)
  } else {
    return out
  }
  const { data: bindings } = await bindingsQuery
  if (!bindings || bindings.length === 0) return out

  // SA, not user OAuth — see the comment in reconcileBindingAccess.
  const drive = driveAsServiceAccount()

  for (const b of bindings as Array<{
    id: string
    sheet_id: string
    shared_emails: string[] | null
    ward_id: string
  }>) {
    // Ground truth comes from Drive, not shared_emails — historical bug
    // meant the cache could claim a share that Drive rejected. If Drive
    // already has the user, just sync the cache. If not, try to create the
    // perm and surface any real error.
    const livePerms = await listDriveEmails(drive, b.sheet_id)
    if (livePerms.has(email)) {
      const merged = Array.from(
        new Set([...(b.shared_emails ?? []), admin.email]),
      )
      await sb
        .from('knit_google_sheet_bindings')
        .update({ shared_emails: merged })
        .eq('id', b.id)
      out.added_wards.push(b.ward_id)
      continue
    }
    try {
      await drive.permissions.create({
        fileId: b.sheet_id,
        requestBody: { role: 'writer', type: 'user', emailAddress: admin.email },
        // Silent for sign-in-triggered reconciles — same reasoning as the
        // cron path; admins don't need a Google notification every session.
        sendNotificationEmail: false,
      })
      const merged = Array.from(
        new Set([...(b.shared_emails ?? []), admin.email]),
      )
      await sb
        .from('knit_google_sheet_bindings')
        .update({ shared_emails: merged })
        .eq('id', b.id)
      out.added_wards.push(b.ward_id)
    } catch (err) {
      // Do NOT pretend success — leaves a paper trail for diagnosis.
      out.errors.push(
        `${b.ward_id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return out
}

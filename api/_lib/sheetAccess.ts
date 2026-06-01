import { google } from 'googleapis'
import type { SupabaseClient } from '@supabase/supabase-js'
import { userClientFrom } from './googleOAuth.js'

const STAKE_VIEW_ROLES = new Set(['stake_presidency', 'high_councilor'])

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

  const { data: oauth } = await sb
    .from('knit_google_oauth')
    .select('refresh_token')
    .eq('stake_id', stakeId)
    .maybeSingle()
  if (!oauth) {
    return {
      ward_id: wardId,
      added: [],
      already_shared: [],
      errors: [],
      skipped: 'no oauth for stake',
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

  const existing = new Set(
    (binding.shared_emails ?? []).map((e: string) => e.toLowerCase()),
  )
  const toAdd = Array.from(new Set(eligibleEmails)).filter(
    (e) => !existing.has(e),
  )

  const report: BindingReconcileReport = {
    ward_id: wardId,
    added: [],
    already_shared: eligibleEmails.filter((e) => existing.has(e)),
    errors: [],
  }
  if (toAdd.length === 0) return report

  try {
    const userClient = userClientFrom(oauth.refresh_token)
    const drive = google.drive({ version: 'v3', auth: userClient })
    // Ground truth: list what Drive actually has so we don't trust a
    // potentially-stale shared_emails cache. The historical bug was treating
    // any 400/409 from permissions.create as "already shared" — which silently
    // promoted a real failure (invalid user, sharing restriction, rate limit)
    // into a phantom share. shared_emails got the email; Drive did not.
    const livePerms = await listDriveEmails(drive, binding.sheet_id)
    for (const email of toAdd) {
      if (livePerms.has(email)) {
        // DB didn't know, Drive does — just sync the cache, no API call.
        report.added.push(email)
        continue
      }
      try {
        await drive.permissions.create({
          fileId: binding.sheet_id,
          requestBody: { role: 'writer', type: 'user', emailAddress: email },
          sendNotificationEmail: true,
        })
        report.added.push(email)
      } catch (err) {
        // Real error. Do NOT pretend the share succeeded — surface it.
        report.errors.push(
          `${email}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    if (report.added.length > 0) {
      const merged = Array.from(
        new Set([...(binding.shared_emails ?? []), ...report.added]),
      )
      await sb
        .from('knit_google_sheet_bindings')
        .update({ shared_emails: merged })
        .eq('id', binding.id)
    }
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

  const { data: oauth } = await sb
    .from('knit_google_oauth')
    .select('refresh_token')
    .eq('stake_id', admin.stake_id)
    .maybeSingle()
  if (!oauth) return out

  const userClient = userClientFrom(oauth.refresh_token)
  const drive = google.drive({ version: 'v3', auth: userClient })

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
        sendNotificationEmail: true,
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

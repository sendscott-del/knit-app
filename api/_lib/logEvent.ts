import { supabaseAdmin } from './supabaseAdmin.js'

/**
 * Server-side, best-effort writer for the knit_events capture table.
 * Never throws — telemetry failures must not break the path that's already
 * failing. Use inside catch blocks on serverless handlers / crons:
 *
 *   catch (e) {
 *     await logServerEvent({ name: 'cron_sheets_push_failed', error: e, ward_id })
 *     ...
 *   }
 *
 * PII-safe: pass UUID references (ward_id / member_id) and developer-facing
 * error strings only. Do not pass member names, emails, or phone numbers.
 */
export type ServerEventInput = {
  name: string
  error?: unknown
  message?: string
  severity?: 'info' | 'warning' | 'error'
  route?: string
  ward_id?: string | null
  member_id?: string | null
  detail?: Record<string, unknown>
}

export async function logServerEvent(input: ServerEventInput): Promise<void> {
  try {
    const message =
      input.message ??
      (input.error instanceof Error
        ? input.error.message
        : input.error != null
          ? String(input.error)
          : null)

    await supabaseAdmin()
      .from('knit_events')
      .insert({
        kind: 'error',
        name: input.name.slice(0, 120),
        severity: input.severity ?? 'error',
        source: 'server',
        route: input.route ?? null,
        ward_id: input.ward_id ?? null,
        member_id: input.member_id ?? null,
        message: message ? message.slice(0, 1000) : null,
        detail: input.detail ?? {},
        app_version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
      })
  } catch {
    // swallow — never let logging break the caller
  }
}

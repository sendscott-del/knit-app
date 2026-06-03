import type { TFunction } from 'i18next'

/**
 * Maps the most common Supabase / PostgREST / Postgres errors to friendly
 * translated messages. Falls back to the original message when the pattern
 * isn't recognized — Supabase errors that come up rarely are still useful
 * raw, especially while debugging. The fallback path uses
 * `errors.unknown_prefix` so the EN/ES toggle at least swaps the framing.
 */
export function translateSupabaseError(
  err: unknown,
  t: TFunction,
): string {
  if (!err) return t('errors.unknown')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any
  const code: string | undefined = e?.code
  const msg: string = String(e?.message ?? e ?? '').trim()
  const lower = msg.toLowerCase()

  // Postgres / PostgREST error code mapping where it's unambiguous.
  if (code === '23505') return t('errors.unique_violation')
  if (code === '23503') return t('errors.fk_violation')
  if (code === '23502') return t('errors.not_null')
  if (code === '23514') return t('errors.check_violation')
  if (code === '42501' || code === 'PGRST301') return t('errors.permission_denied')
  if (code === 'PGRST116') return t('errors.not_found')

  // Pattern matching for messages that don't carry a clean code (Supabase
  // auth, Drive API errors bubbling through, etc.).
  if (lower.includes('email rate limit') || lower.includes('429')) {
    return t('errors.rate_limited')
  }
  if (lower.includes('invalid login credentials') || lower.includes('invalid grant')) {
    return t('errors.invalid_credentials')
  }
  if (lower.includes('email not confirmed')) {
    return t('errors.email_not_confirmed')
  }
  if (lower.includes('user not found') || lower.includes('no rows')) {
    return t('errors.not_found')
  }
  if (lower.includes('jwt') || lower.includes('not authenticated')) {
    return t('errors.unauthenticated')
  }
  if (lower.includes('row level security') || lower.includes('rls')) {
    return t('errors.permission_denied')
  }
  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('failed to fetch')) {
    return t('errors.network')
  }

  // Unknown — surface the raw message under a translated frame so the
  // language toggle at least changes the prefix.
  return msg ? `${t('errors.unknown_prefix')}: ${msg}` : t('errors.unknown')
}

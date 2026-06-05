import { CHANGELOG } from '@/constants/changelog'

/**
 * Lightweight, PII-safe client error reporting for Knit.
 *
 * Errors are POSTed to /api/events, which scrubs + writes them to the
 * knit_events table via the service role. Only app super admins can read
 * them back (RLS), surfaced on /admin/insights.
 *
 * Design rules (church lane — never log names/specifics):
 *  - We send the error message + a sanitized route PATTERN, never the raw
 *    URL (the magic-link path carries a member token) and never query/hash.
 *  - We do NOT attach member names, emails, or phone numbers.
 *  - Fire-and-forget with a hard throttle so an error loop can't spam the
 *    endpoint or the table.
 */

export const APP_VERSION = CHANGELOG[0]?.version ?? 'unknown'

/** Strip the token off the magic-link path and drop query/hash so a
 *  sensitive token never lands in the events table. Returns a route
 *  pattern, e.g. /m/:memberId/:token, /me, /admin/insights. */
export function sanitizeRoute(rawPath: string): string {
  const path = (rawPath || '/').split('?')[0].split('#')[0]
  const segs = path.split('/').filter(Boolean)
  // /m/<memberId>/<token>  ->  /m/:memberId/:token
  if (segs[0] === 'm') {
    return '/m' + (segs[1] ? '/:memberId' : '') + (segs[2] ? '/:token' : '')
  }
  return '/' + segs.join('/')
}

type ReportInput = {
  name: string
  message: string
  /** structured, already-scrubbed extra context */
  detail?: Record<string, unknown>
  severity?: 'info' | 'warning' | 'error'
}

// Throttle: cap at 8 reports / 60s and suppress exact-duplicate (name+message)
// repeats inside that window so a render loop can't flood the table.
const WINDOW_MS = 60_000
const MAX_IN_WINDOW = 8
let windowStart = 0
let countInWindow = 0
const seen = new Set<string>()

export function reportClientError(input: ReportInput): void {
  try {
    const now = Date.now()
    if (now - windowStart > WINDOW_MS) {
      windowStart = now
      countInWindow = 0
      seen.clear()
    }
    const dedupeKey = `${input.name}::${input.message}`.slice(0, 300)
    if (seen.has(dedupeKey)) return
    if (countInWindow >= MAX_IN_WINDOW) return
    seen.add(dedupeKey)
    countInWindow += 1

    const payload = {
      kind: 'error',
      name: input.name.slice(0, 120),
      severity: input.severity ?? 'error',
      source: 'client',
      route: sanitizeRoute(
        typeof window !== 'undefined' ? window.location.pathname : '/',
      ),
      message: (input.message || '').slice(0, 1000),
      detail: input.detail ?? {},
      app_version: APP_VERSION,
    }

    const body = JSON.stringify(payload)
    // sendBeacon survives page unload (good for window.onerror right before
    // a crash navigation); fall back to fetch+keepalive.
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }))
    } else if (typeof fetch !== 'undefined') {
      void fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // Telemetry must never throw into the app.
  }
}

let installed = false

/** Register window.onerror + unhandledrejection once. Safe to call twice. */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (e: ErrorEvent) => {
    const msg = e.message || (e.error instanceof Error ? e.error.message : 'error')
    reportClientError({
      name: 'window_error',
      message: msg,
      detail: {
        source_file: sanitizeFileRef(e.filename),
        line: e.lineno ?? null,
        col: e.colno ?? null,
      },
    })
  })

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason = e.reason
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : safeStringify(reason)
    reportClientError({
      name: 'unhandled_rejection',
      message: msg || 'unhandled promise rejection',
    })
  })
}

/** Keep only the file basename + position; never the full origin URL. */
function sanitizeFileRef(file: string | undefined): string | null {
  if (!file) return null
  try {
    const u = new URL(file)
    return u.pathname.split('/').pop() ?? null
  } catch {
    return file.split('/').pop() ?? null
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)?.slice(0, 300) ?? String(v)
  } catch {
    return String(v)
  }
}

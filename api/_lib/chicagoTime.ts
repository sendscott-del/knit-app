/**
 * Chicago-local date/time helpers for the sheets pipeline. Vercel functions
 * run in UTC; building dates with new Date()/toISOString() shifted everything
 * 5–6 hours: the Log-an-Outing date dropdown showed tomorrow's date from
 * ~6pm Chicago onward, and outing timestamps landed at the wrong local hour.
 */

const CHICAGO = 'America/Chicago'

/** Today's date in Chicago as YYYY-MM-DD. */
export function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CHICAGO }).format(new Date())
}

/** The N most recent Chicago dates (today first), as YYYY-MM-DD. */
export function chicagoLastNDays(n: number): string[] {
  const out: string[] = []
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: CHICAGO })
  for (let i = 0; i < n; i++) {
    out.push(fmt.format(new Date(Date.now() - i * 86400000)))
  }
  return out
}

/** Offset (ms) between the given UTC instant and its Chicago wall-clock time. */
function chicagoOffsetMs(instantMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instantMs)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  )
  return asUtc - instantMs
}

/**
 * UTC ISO timestamp for the given Chicago wall-clock time. Two-pass offset
 * lookup handles DST transition days.
 */
export function chicagoTimeToUtcIso(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
): string {
  const desired = Date.UTC(year, monthIndex, day, hour)
  let ts = desired - chicagoOffsetMs(desired)
  ts = desired - chicagoOffsetMs(ts)
  return new Date(ts).toISOString()
}

import { INFLOW_DAYS } from './forecastConstants'
import { clampDay } from './mytDate'

// UTC-midnight epoch for an MYT calendar date string (date-only arithmetic, no TZ drift).
function isoToUtcMidnight(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
function utcMidnightToIso(ms: number): string {
  const dt = new Date(ms)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function daysBetweenISO(aISO: string, bISO: string): number {
  return Math.round((isoToUtcMidnight(bISO) - isoToUtcMidnight(aISO)) / 86_400_000)
}

export function nextInflowDate(fromISO: string): string {
  const [y, m] = fromISO.split('-').map(Number)
  const candidates: string[] = []
  // this month's anchors + next month's anchors (covers end-of-month roll)
  for (const day of INFLOW_DAYS) {
    const clampedDay = clampDay(y, m, day)
    candidates.push(`${y}-${String(m).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`)
    const ny = m === 12 ? y + 1 : y
    const nm = m === 12 ? 1 : m + 1
    const nextMonthDay = clampDay(ny, nm, day)
    candidates.push(`${ny}-${String(nm).padStart(2, '0')}-${String(nextMonthDay).padStart(2, '0')}`)
  }
  const fromMs = isoToUtcMidnight(fromISO)
  const future = candidates
    .map(isoToUtcMidnight)
    .filter((ms) => ms > fromMs) // strictly after today
    .sort((a, b) => a - b)
  return utcMidnightToIso(future[0])
}

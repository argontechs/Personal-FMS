// server/api/trends.get.ts
// GET /api/trends — READ-ONLY history feed for the Trends view. Session-gated (401 unauth).
// Returns:
//   - series:        daily snapshot rows for the last `days` days (default 180), ascending.
//   - spendByCategory: expense totals grouped by category for the last `months` months.
//   - todayISO, windowDays, windowMonths: echoed back for the UI.
// NEVER mutates — purely derives from the snapshots + transactions tables.
import { defineEventHandler, getQuery } from 'h3'
import { requireSession } from '../utils/requireSession'
import { db } from '../db'
import { snapshotSeries, spendByCategory, spendSinceISO } from '../utils/trendsReads'
import { todayMYT } from '../utils/mytDate'

// Default lookback windows. Bounded so a hostile query string cannot ask for an absurd range.
const DEFAULT_DAYS = 180
const DEFAULT_MONTHS = 4

function sinceDaysISO(todayISO: string, days: number): string {
  const [y, m, d] = todayISO.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - (days - 1)))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export default defineEventHandler((event) => {
  requireSession(event) // §14 #22: every server/api/** handler is session-gated → 401 unauth

  const q = getQuery(event)
  const todayISO = typeof q.today === 'string' ? q.today : todayMYT()

  const days = Math.min(3650, Math.max(2, Number(q.days) || DEFAULT_DAYS))
  const months = Math.min(36, Math.max(1, Number(q.months) || DEFAULT_MONTHS))

  const series = snapshotSeries(db, sinceDaysISO(todayISO, days))
  const categories = spendByCategory(db, spendSinceISO(todayISO, months))

  return {
    todayISO,
    windowDays: days,
    windowMonths: months,
    series,
    spendByCategory: categories,
  }
})

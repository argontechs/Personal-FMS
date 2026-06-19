// server/api/debts/index.get.ts
// GET /api/debts — returns ALL open debts ordered by priority_rank ASC (nulls last).
// Session-gated (requireSession → 401 unauth).
// Does NOT touch the card-only debt.get.ts used by the dashboard.
import { defineEventHandler } from 'h3'
import { sql } from 'drizzle-orm'
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db'
import { debts } from '../../db/schema'

export default defineEventHandler((event) => {
  requireSession(event)

  // SQLite: NULLS are treated as LAST naturally in ascending order for IS NULL check.
  // We use CASE to push nulls to the bottom explicitly.
  const rows = db
    .select({
      id: debts.id,
      name: debts.name,
      type: debts.type,
      balance_cents: debts.balance_cents,
      rate_type: debts.rate_type,
      apr_bps: debts.apr_bps,
      flat_rate_bps: debts.flat_rate_bps,
      min_payment_cents: debts.min_payment_cents,
      due_day: debts.due_day,
      priority_rank: debts.priority_rank,
      payoff_baseline_cents: debts.payoff_baseline_cents,
    })
    .from(debts)
    .orderBy(sql`CASE WHEN ${debts.priority_rank} IS NULL THEN 1 ELSE 0 END, ${debts.priority_rank} ASC`)
    .all()

  return rows
})

// server/api/debt-plan.get.ts
// GET /api/debt-plan — READ-ONLY cross-debt AVALANCHE payoff projection.
// Session-gated (requireSession → 401 unauth). Mutates NOTHING.
//
// The monthly extra thrown at debt is DERIVED from the forecast surplus-to-debt, mirroring
// debt.get.ts §14 D3: surplusAfterInterestCents − the monthly EF allocation (3×SAVINGS_TARGET_PER_CYCLE
// while the RM1,000 starter buffer is unfunded, else 0), clamped >= 0.
import { defineEventHandler, getQuery } from 'h3'
import { eq, sql } from 'drizzle-orm'
import { requireSession } from '../utils/requireSession'
import { db } from '../db'
import { debts } from '../db/schema'
import { computeMonthlyRollup } from '../utils/monthlyRollup'
import { readEFBalance } from '../utils/debtReads'
import { projectDebtPlan, addMonthsYM, type DebtPlanInput } from '../utils/debtPlan'
import { todayMYT } from '../utils/mytDate'
import { EF_STARTER_TARGET, SAVINGS_TARGET_PER_CYCLE } from '../utils/forecastConstants'

export default defineEventHandler((event) => {
  requireSession(event) // §14 #22: every server/api/** handler is session-gated → 401 unauth

  const q = getQuery(event)
  const todayISO = typeof q.today === 'string' ? q.today : todayMYT()

  // All open debts, avalanche-ordered: explicit priority_rank ASC (nulls last) as the override,
  // then highest apr_bps first, then id — mirroring projectDebtPlan's prepayable comparator.
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
      scheduled_payment_cents: debts.scheduled_payment_cents,
      priority_rank: debts.priority_rank,
      never_prepay: debts.never_prepay,
      remaining_installments_json: debts.remaining_installments_json,
    })
    .from(debts)
    .where(eq(debts.is_closed, false))
    .orderBy(
      sql`CASE WHEN ${debts.priority_rank} IS NULL THEN 1 ELSE 0 END, ${debts.priority_rank} ASC, ${debts.apr_bps} DESC, ${debts.id} ASC`,
    )
    .all()

  // §14 D3 monthly-extra source: surplus-after-interest MINUS the EF allocation while building the
  // RM1,000 starter buffer (0 once funded). Clamped >= 0 so we never feed a negative extra.
  const { surplusAfterInterestCents } = computeMonthlyRollup(db, todayISO.slice(0, 7))
  const efBalanceCents = readEFBalance(db)
  const efMonthlyAllocationCents = efBalanceCents < EF_STARTER_TARGET ? 3 * SAVINGS_TARGET_PER_CYCLE : 0
  const monthlyExtraCents = Math.max(0, surplusAfterInterestCents - efMonthlyAllocationCents)

  const planInput: DebtPlanInput[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    balance_cents: r.balance_cents,
    rate_type: r.rate_type,
    apr_bps: r.apr_bps,
    flat_rate_bps: r.flat_rate_bps,
    min_payment_cents: r.min_payment_cents,
    scheduled_payment_cents: r.scheduled_payment_cents,
    priority_rank: r.priority_rank,
    type: r.type,
    never_prepay: r.never_prepay,
    remaining_installments_json: r.remaining_installments_json,
  }))

  const plan = projectDebtPlan(planInput, monthlyExtraCents, todayISO)

  const startYM = todayISO.slice(0, 7)
  const debtFreeDate =
    plan.neverClears || plan.debtFreeMonths === null ? null : addMonthsYM(startYM, plan.debtFreeMonths)

  return {
    debtFreeDate, // 'YYYY-MM' or null
    totalInterestCents: plan.totalInterestCents,
    monthlyExtraCents, // the assumption used (>=0)
    neverClears: plan.neverClears,
    shortfallCents: plan.shortfallCents,
    perDebt: plan.perDebt.map((p) => ({
      id: p.id,
      name: p.name,
      monthsToPayoff: p.monthsToPayoff,
      payoffDate: p.monthsToPayoff > 0 ? addMonthsYM(startYM, p.monthsToPayoff) : null,
    })),
  }
})

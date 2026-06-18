// server/utils/goalReads.ts
// §7 / §14 #3, #13, #16: EF balance from ledger (two-leg); Kill-Card from frozen baseline.
import { eq, sql } from 'drizzle-orm'
import { transactions, goals, debts } from '../db/schema'

type DB = any

// §14 #13: EF is a real savings account; balance derives from BOTH legs of the ledger.
// Mirrors recomputeBalances non-card logic:
//   balance = SUM(amount_cents WHERE account_id=EF) + SUM(-amount_cents WHERE counter_account_id=EF)
// Transfers write a positive leg with account_id=EF; the paired bank leg has counter_account_id=EF
// with a negative amount (so -amount is positive). Both add to the EF balance correctly.
export function efBalanceCents(db: DB, efAccountId: number): number {
  const primary = db
    .select({ s: sql<number>`COALESCE(SUM(${transactions.amount_cents}), 0)` })
    .from(transactions)
    .where(eq(transactions.account_id, efAccountId))
    .get()
  const counter = db
    .select({ s: sql<number>`COALESCE(SUM(-${transactions.amount_cents}), 0)` })
    .from(transactions)
    .where(eq(transactions.counter_account_id, efAccountId))
    .get()
  return Number(primary?.s ?? 0) + Number(counter?.s ?? 0)
}

// Read the two seeded goals and their linked account/debt facts.
export function readGoals(db: DB): {
  ef: { accountId: number; targetCents: number }
  killCard: { baselineCents: number; currentCents: number }
} {
  const efGoal = db.select().from(goals).where(eq(goals.type, 'savings')).get()
  const cardGoal = db.select().from(goals).where(eq(goals.type, 'debt_payoff')).get()
  const cardDebt = db.select().from(debts).where(eq(debts.id, cardGoal.debt_id)).get()
  return {
    ef: { accountId: efGoal.account_id, targetCents: efGoal.target_amount_cents },
    killCard: {
      baselineCents: cardDebt.payoff_baseline_cents ?? 0,
      currentCents: cardDebt.balance_cents,
    },
  }
}

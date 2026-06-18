// server/utils/deltaCash.ts
// §14 D2 — surplus-leak Δcash insight.
// Computes the net change in liquid cash (cash/bank/ewallet accounts) for a given month.
// "Liquid" matches cashNowCents: excludes 'card' (debt) and 'savings' (EF buffer).
import { and, inArray, like, sql } from 'drizzle-orm'
import { accounts, transactions } from '../db/schema'

type DB = any

/**
 * Sum of amount_cents for transactions where the source account is a liquid account
 * (type IN ('cash', 'bank', 'ewallet')) and date is in the given month prefix ('YYYY-MM').
 *
 * A positive result means net cash inflow this month; negative means net outflow.
 * Used by the dashboard "surplus-leak" insight: if rawSurplus is positive but
 * deltaCashThisMonth is negative (or much lower), cash didn't land in savings.
 */
export function deltaCashThisMonth(db: DB, monthPrefix: string): number {
  // Resolve all liquid account ids.
  const liquidAccounts = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.type, ['cash', 'bank', 'ewallet']))
    .all() as { id: number }[]

  if (!liquidAccounts.length) return 0

  const liquidIds = liquidAccounts.map((a) => a.id)

  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${transactions.amount_cents}), 0)` })
    .from(transactions)
    .where(
      and(
        inArray(transactions.account_id, liquidIds),
        like(transactions.date, `${monthPrefix}-%`),
      ),
    )
    .get()

  return Number(row?.total ?? 0)
}

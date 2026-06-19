// server/utils/trendsReads.ts
// Read-only aggregations for GET /api/trends.
//   - snapshotSeries: the daily snapshot rows (ascending by date), optionally windowed.
//   - spendByCategory: expense totals grouped by category for the last N months.
// Pure reads — never mutate. `db` typed loose so tests can inject an in-memory instance.
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { snapshots, transactions } from '../db/schema'

type DB = any

export interface SnapshotPoint {
  date: string
  netWorthCents: number
  totalDebtCents: number
  cardBalanceCents: number
  efBalanceCents: number
  liquidCents: number
}

export interface CategorySpend {
  category: string
  amountCents: number
}

/**
 * Snapshot rows on/after `sinceISO` (inclusive), ascending by date.
 * When `sinceISO` is omitted, returns the entire series.
 */
export function snapshotSeries(db: DB, sinceISO?: string): SnapshotPoint[] {
  const base = db.select().from(snapshots)
  const rows = (sinceISO
    ? base.where(gte(snapshots.date, sinceISO))
    : base
  ).orderBy(asc(snapshots.date)).all()

  return rows.map((r: any) => ({
    date: r.date,
    netWorthCents: Number(r.net_worth_cents),
    totalDebtCents: Number(r.total_debt_cents),
    cardBalanceCents: Number(r.card_balance_cents),
    efBalanceCents: Number(r.ef_balance_cents),
    liquidCents: Number(r.liquid_cents),
  }))
}

/**
 * Compute the first day of the month that is `monthsBack` months before `todayISO`.
 * e.g. spendSinceISO('2026-06-19', 3) → '2026-04-01' (Apr, May, Jun = the last 3 months).
 */
export function spendSinceISO(todayISO: string, monthsBack: number): string {
  const [y, m] = todayISO.split('-').map(Number)
  // m is 1..12; go back (monthsBack - 1) full months from the current month start.
  let year = y
  let month = m - (monthsBack - 1)
  while (month < 1) {
    month += 12
    year -= 1
  }
  return `${year}-${String(month).padStart(2, '0')}-01`
}

/**
 * Expense totals grouped by category since `sinceISO` (inclusive), descending by amount.
 * Uses ABS(amount_cents) (expense rows store negative sen). EXCLUDES non-discretionary
 * ledger categories that are not "spending": income, savings, interest, adjustment, debt.
 * Those are tracked elsewhere (debt service / interest accrual / EF transfers) and would
 * drown out the everyday-spend story the bar chart is meant to tell.
 */
const NON_SPEND_CATEGORIES = ['income', 'savings', 'interest', 'adjustment', 'debt'] as const

export function spendByCategory(db: DB, sinceISO: string): CategorySpend[] {
  const rows = db
    .select({
      category: transactions.category,
      total: sql<number>`COALESCE(SUM(ABS(${transactions.amount_cents})), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.direction, 'expense'),
        gte(transactions.date, sinceISO),
      ),
    )
    .groupBy(transactions.category)
    .all()

  return rows
    .map((r: any) => ({ category: String(r.category), amountCents: Number(r.total) }))
    .filter((r: CategorySpend) =>
      r.amountCents > 0 && !(NON_SPEND_CATEGORIES as readonly string[]).includes(r.category),
    )
    .sort((a: CategorySpend, b: CategorySpend) => b.amountCents - a.amountCents)
}

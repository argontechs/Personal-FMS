// server/utils/forecastReads.ts
// Ledger reads that feed computeSafeToSpend with real DB-derived inputs.
// §4: v1 flat projection (no trailing window / statistical model).
// §14 #11: always read next_due_date — never re-derive from due_day.
// §14 #20: spent_today keyed off client MYT date, not server time.
import { and, eq, gt, lt, inArray, sql } from 'drizzle-orm'
import { accounts, recurringItems, transactions } from '../db/schema'
import { SAVINGS_TARGET_PER_CYCLE } from './forecastConstants'

// Drizzle-over-better-sqlite3 instance (server/db/index.ts). Typed as `any`
// so tests can inject an in-memory instance without a cast.
type DB = any

/**
 * Sum of balance_cents for LIQUID accounts only: type IN ('cash', 'bank', 'ewallet').
 * Excludes 'card' (debt obligation) and 'savings' (EF buffer — not spendable cash).
 */
export function cashNowCents(db: DB): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${accounts.balance_cents}), 0)` })
    .from(accounts)
    .where(inArray(accounts.type, ['cash', 'bank', 'ewallet']))
    .get()
  return Number(row?.total ?? 0)
}

/**
 * Sum of recurring expense items due strictly between todayISO and nextInflowISO.
 * Filters: direction='expense', is_active=true, next_due_date > today AND < nextInflow.
 * Excludes: income items (direction='income'), inactive items, and anything with a
 * next_due_date on/before today or on/after the next inflow date.
 */
export function committedOutflowsBeforeCents(
  db: DB,
  todayISO: string,
  nextInflowISO: string,
): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${recurringItems.amount_cents}), 0)` })
    .from(recurringItems)
    .where(
      and(
        eq(recurringItems.direction, 'expense'),
        eq(recurringItems.is_active, true),
        gt(recurringItems.next_due_date, todayISO),
        lt(recurringItems.next_due_date, nextInflowISO),
      ),
    )
    .get()
  return Number(row?.total ?? 0)
}

/**
 * Flat daily variable-spend projection (§4 — v1, no statistical/trailing window).
 * Returns floor(monthlyBudgetCents / daysInMonth).
 */
export function projectedVariableSpendCents(
  monthlyBudgetCents: number,
  daysInMonth: number,
): number {
  return Math.floor(monthlyBudgetCents / daysInMonth)
}

// Discretionary (variable) categories that count toward spent_today.
const DISCRETIONARY_CATEGORIES = ['food', 'transport', 'other'] as const

/**
 * Sum of |amount_cents| for expense transactions on todayISO in variable categories
 * (food, transport, other). Uses ABS() to handle negative amount_cents values.
 * Keyed off the client MYT date field — not server timestamp (§14 #20).
 */
export function spentTodayVariableCents(db: DB, todayISO: string): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(ABS(${transactions.amount_cents})), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.date, todayISO),
        eq(transactions.direction, 'expense'),
        inArray(transactions.category, DISCRETIONARY_CATEGORIES as unknown as string[]),
      ),
    )
    .get()
  return Number(row?.total ?? 0)
}

/**
 * Remaining savings obligation for the current cycle.
 * = SAVINGS_TARGET_PER_CYCLE (16667 sen) − EF transfers already made this cycle, clamped ≥ 0.
 *
 * "EF inbound leg" = transactions where:
 *   - category = 'savings'
 *   - amount_cents > 0  (positive leg = money arriving at the EF account)
 *   - date >= cycleStartISO AND date < nextInflowISO
 *
 * Using the positive amount_cents leg (the credit to the EF account) rather than
 * counter_account_id because the in-memory DDL in tests does not have the EF account
 * pre-seeded with a known ID. In production the debit leg from the source account
 * will have a negative amount_cents; only the credit leg (positive) is counted here.
 */
export function savingsTargetRemainingCents(
  db: DB,
  cycleStartISO: string,
  nextInflowISO: string,
): number {
  const row = db
    .select({ moved: sql<number>`COALESCE(SUM(${transactions.amount_cents}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.category, 'savings'),
        gt(transactions.amount_cents, 0),
        sql`${transactions.date} >= ${cycleStartISO}`,
        lt(transactions.date, nextInflowISO),
      ),
    )
    .get()
  const moved = Number(row?.moved ?? 0)
  return Math.max(0, SAVINGS_TARGET_PER_CYCLE - moved)
}

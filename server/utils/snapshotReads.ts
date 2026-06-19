// server/utils/snapshotReads.ts
// Canonical "as of now" metric reads for the trends/snapshots feature.
// REUSES the same definitions the rest of the app uses so a snapshot is just
// today's dashboard frozen in time:
//   - liquid       = SUM(balance_cents) of non-card asset accounts (cash/bank/ewallet/savings)
//                    — mirrors accounts.vue liquidCents + forecastReads.cashNowCents (+ savings).
//   - holdings     = SUM(current_value_cents) of all holdings (accounts.vue holdingsCents).
//   - total_debt   = SUM(balance_cents) of all debts (accounts.vue totalDebtsCents).
//   - card_balance = revolving-card debt balance (debtReads.readCard).
//   - ef_balance   = savings-account balance (debtReads.readEFBalance).
//   - net_worth    = liquid + holdings − total_debt (accounts.vue netCents).
//
// Pure reads — never mutate. `db` is typed loose so tests can inject an in-memory instance.
import { inArray, sql } from 'drizzle-orm'
import { accounts, debts, holdings } from '../db/schema'
import { readCard, readEFBalance } from './debtReads'

type DB = any

export interface SnapshotMetrics {
  netWorthCents: number
  totalDebtCents: number
  cardBalanceCents: number
  efBalanceCents: number
  liquidCents: number
}

/**
 * Sum of balance_cents for the non-card asset accounts: cash, bank, ewallet, savings.
 * Matches accounts.vue's `liquidCents` (assetAccounts excludes card). NOTE: this is a
 * SUPERSET of forecastReads.cashNowCents — it additionally includes the savings (EF) account,
 * because the EF balance IS part of net worth even though it is ring-fenced from safe-to-spend.
 */
export function liquidAccountsCents(db: DB): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${accounts.balance_cents}), 0)` })
    .from(accounts)
    .where(inArray(accounts.type, ['cash', 'bank', 'ewallet', 'savings']))
    .get()
  return Number(row?.total ?? 0)
}

/** Sum of current_value_cents across all holdings (investments + insurance + savings products). */
export function holdingsValueCents(db: DB): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${holdings.current_value_cents}), 0)` })
    .from(holdings)
    .get()
  return Number(row?.total ?? 0)
}

/** Sum of balance_cents across all debts (the card debt is included here, never as an asset). */
export function totalDebtCents(db: DB): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${debts.balance_cents}), 0)` })
    .from(debts)
    .get()
  return Number(row?.total ?? 0)
}

/**
 * Compute today's canonical metrics. net_worth = liquid + holdings − total_debt.
 * card_balance reads the revolving-card debt; ef_balance reads the savings account.
 * Both are null-safe (return 0 when the row is absent) so a partially-seeded DB never throws.
 */
export function computeSnapshotMetrics(db: DB): SnapshotMetrics {
  const liquidCents = liquidAccountsCents(db)
  const holdingsCents = holdingsValueCents(db)
  const totalDebt = totalDebtCents(db)

  // Card balance: the single revolving debt (readCard throws if absent, so guard).
  let cardBalanceCents = 0
  try {
    const { debt } = readCard(db)
    cardBalanceCents = Number(debt?.balance_cents ?? 0)
  } catch {
    cardBalanceCents = 0
  }

  return {
    netWorthCents: liquidCents + holdingsCents - totalDebt,
    totalDebtCents: totalDebt,
    cardBalanceCents,
    efBalanceCents: readEFBalance(db),
    liquidCents,
  }
}

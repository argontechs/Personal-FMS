// server/utils/dailySnapshot.ts
// Pure logic for the `daily-snapshot` scheduled task. Lives here (not in the task file)
// so it is directly testable against an in-memory DB without the Nitro runtime.
//
// Behaviour:
//   - Computes today's canonical metrics (server/utils/snapshotReads.ts).
//   - UPSERTS exactly one row keyed on the MYT date — running twice in a day overwrites
//     the same row (idempotent), never inserting a duplicate (date is UNIQUE).
//   - First-run safety: nothing special is needed — the UPSERT writes today's row even on
//     an empty table, so the user is never staring at an empty Trends view after day one.
import { db as defaultDb } from '../db/index'
import { snapshots } from '../db/schema'
import { computeSnapshotMetrics } from './snapshotReads'
import { todayMYT, nowEpoch } from './mytDate'

type DB = any

export interface SnapshotResult {
  date: string
  netWorthCents: number
  totalDebtCents: number
  cardBalanceCents: number
  efBalanceCents: number
  liquidCents: number
}

/**
 * Compute + UPSERT today's snapshot. Idempotent per date (UNIQUE on snapshots.date).
 * @param asOf optional MYT 'YYYY-MM-DD' override (tests / backfill); defaults to todayMYT().
 */
export function runDailySnapshot(asOf?: string, db: DB = defaultDb): SnapshotResult {
  const date = asOf ?? todayMYT()
  const created = nowEpoch()
  const m = computeSnapshotMetrics(db)

  // Drizzle onConflictDoUpdate → SQLite UPSERT on the UNIQUE(date) index.
  // Re-running for the same date overwrites the metrics in place (idempotent).
  db.insert(snapshots)
    .values({
      date,
      net_worth_cents: m.netWorthCents,
      total_debt_cents: m.totalDebtCents,
      card_balance_cents: m.cardBalanceCents,
      ef_balance_cents: m.efBalanceCents,
      liquid_cents: m.liquidCents,
      created_at: created,
    })
    .onConflictDoUpdate({
      target: snapshots.date,
      set: {
        net_worth_cents: m.netWorthCents,
        total_debt_cents: m.totalDebtCents,
        card_balance_cents: m.cardBalanceCents,
        ef_balance_cents: m.efBalanceCents,
        liquid_cents: m.liquidCents,
        created_at: created,
      },
    })
    .run()

  return {
    date,
    netWorthCents: m.netWorthCents,
    totalDebtCents: m.totalDebtCents,
    cardBalanceCents: m.cardBalanceCents,
    efBalanceCents: m.efBalanceCents,
    liquidCents: m.liquidCents,
  }
}

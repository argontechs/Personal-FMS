// server/utils/efTransfer.ts
// Two-leg atomic EF transfer via the single ledger authority (postTransaction, Phase 1).
// Passing counter_account_id makes postTransaction write ONE row + TWO balance updates in a
// single db.transaction: debit account_id (from/cash) and credit counter_account_id (EF savings).
import { postTransaction } from './post'

export type EfTransferInput = {
  from_account_id: number
  to_account_id: number
  amount_cents: number
  goal_id?: number
  note?: string
  uuid: string
  date: string
}

// Two-leg transfer via the single ledger authority. postTransaction (Phase 1) wraps the
// insert + both account balance updates in ONE synchronous db.transaction; passing
// counter_account_id makes it a transfer that decrements `account_id` and increments
// `counter_account_id`. Idempotent on transactions.uuid UNIQUE: a duplicate UUID raises
// a SQLite UNIQUE constraint error which we catch and resolve to the existing row.
import { db } from '../db'
import { transactions } from '../db/schema'
import { eq } from 'drizzle-orm'

export function postEfTransfer(input: EfTransferInput): { id: number } {
  try {
    return postTransaction({
      uuid: input.uuid,
      date: input.date,
      amount_cents: -Math.abs(input.amount_cents), // negative on the source leg
      direction: 'transfer',
      category: 'savings',
      account_id: input.from_account_id,
      counter_account_id: input.to_account_id,
      goal_id: input.goal_id,
      note: input.note ?? 'EF transfer (payday prompt)',
      source: 'manual',
    })
  } catch (err: any) {
    // Idempotency: SQLite UNIQUE constraint on uuid → already posted, return the existing row id.
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.message?.includes('UNIQUE constraint failed')) {
      const existing = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.uuid, input.uuid)).get()
      if (existing) return { id: existing.id as number }
    }
    throw err
  }
}

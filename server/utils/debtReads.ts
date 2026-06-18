// server/utils/debtReads.ts
import { eq } from 'drizzle-orm'
import { accounts, debts } from '../db/schema'

type DB = any

// The card is modelled twice (§3): a debts row (APR/payoff) + an accounts row (limit/utilisation), linked.
export function readCard(db: DB): {
  debt: { balance_cents: number; apr_bps: number; bt_status: 'none' | 'applied' | 'active' | 'declined'; payoff_baseline_cents: number | null }
  account: { credit_limit_cents: number | null }
} {
  const debt = db.select().from(debts).where(eq(debts.type, 'revolving')).get()
  const account = db.select().from(accounts).where(eq(accounts.debt_id, debt.id)).get()
  return { debt, account }
}

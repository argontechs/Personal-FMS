// server/utils/__tests__/monthlyRollup.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { transactions } from '../../db/schema'
import { computeMonthlyRollup } from '../monthlyRollup'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE,
      date TEXT NOT NULL, amount_cents INTEGER NOT NULL, direction TEXT NOT NULL, category TEXT NOT NULL,
      account_id INTEGER NOT NULL, counter_account_id INTEGER, debt_id INTEGER, goal_id INTEGER,
      note TEXT, source TEXT NOT NULL, recurring_item_id INTEGER, is_estimate INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL);
  `)
  return drizzle(sqlite)
}
let db: ReturnType<typeof makeDb>
beforeEach(() => { db = makeDb() })

describe('computeMonthlyRollup', () => {
  beforeEach(() => {
    db.insert(transactions).values([
      // income
      { uuid: 'i1', date: '2026-07-03', amount_cents: 581950, direction: 'income', category: 'income', account_id: 1, source: 'auto', created_at: 1 },
      { uuid: 'i2', date: '2026-07-01', amount_cents: 60000, direction: 'income', category: 'income', account_id: 1, source: 'auto', created_at: 1 },
      // living (food/transport/bills/other)
      { uuid: 'l1', date: '2026-07-05', amount_cents: -100000, direction: 'expense', category: 'food', account_id: 1, source: 'manual', created_at: 1 },
      { uuid: 'l2', date: '2026-07-06', amount_cents: -45000, direction: 'expense', category: 'transport', account_id: 1, source: 'manual', created_at: 1 },
      { uuid: 'l3', date: '2026-07-16', amount_cents: -37860, direction: 'expense', category: 'bills', account_id: 1, source: 'auto', created_at: 1 },
      { uuid: 'l4', date: '2026-07-09', amount_cents: -1000, direction: 'expense', category: 'other', account_id: 1, source: 'manual', created_at: 1 },
      // debt service (category 'debt')
      { uuid: 'd1', date: '2026-07-22', amount_cents: -90400, direction: 'expense', category: 'debt', debt_id: 4, account_id: 1, source: 'auto', created_at: 1 },
      // card interest — carrying cost, must be excluded from living AND debt_svc (§14 #9)
      { uuid: 'int1', date: '2026-07-15', amount_cents: -11101, direction: 'expense', category: 'interest', debt_id: 1, account_id: 2, source: 'auto', created_at: 1 },
      // a June row that must NOT leak into July
      { uuid: 'june', date: '2026-06-30', amount_cents: -99999, direction: 'expense', category: 'food', account_id: 1, source: 'manual', created_at: 1 },
    ]).run()
  })

  it('income = Σ income transactions in the month', () => {
    expect(computeMonthlyRollup(db, '2026-07').incomeCents).toBe(641950)
  })

  it('living excludes interest and debt', () => {
    // 100000 + 45000 + 37860 + 1000 = 183860
    expect(computeMonthlyRollup(db, '2026-07').livingCents).toBe(183860)
  })

  it('debt_service is category=debt only (ledger authority, §14 #5)', () => {
    expect(computeMonthlyRollup(db, '2026-07').debtServiceCents).toBe(90400)
  })

  it('interest is a separate carrying-cost line (§14 #9)', () => {
    expect(computeMonthlyRollup(db, '2026-07').interestCents).toBe(11101)
  })

  it('raw surplus = income − living − debt_svc; after-interest subtracts the carrying cost', () => {
    const r = computeMonthlyRollup(db, '2026-07')
    expect(r.rawSurplusCents).toBe(641950 - 183860 - 90400) // 367690
    expect(r.surplusAfterInterestCents).toBe(367690 - 11101) // 356589
  })

  it('does not leak rows from an adjacent month', () => {
    // June food row (-99999) must not appear in July living
    expect(computeMonthlyRollup(db, '2026-07').livingCents).toBe(183860)
  })

  it('income counts only category=income, excludes adjustment rows', () => {
    // Insert seed month with real income + opening-balance adjustment
    const seedDb = makeDb()
    seedDb.insert(transactions).values([
      // real income
      { uuid: 'salary1', date: '2026-06-05', amount_cents: 581950, direction: 'income', category: 'income', account_id: 1, source: 'auto', created_at: 1 },
      // opening-balance adjustment (direction=income but category=adjustment)
      { uuid: 'adjust1', date: '2026-06-01', amount_cents: 75000, direction: 'income', category: 'adjustment', account_id: 1, source: 'manual', created_at: 1 },
    ]).run()
    const result = computeMonthlyRollup(seedDb, '2026-06')
    // Must count only the 581950 salary, NOT the 75000 adjustment
    expect(result.incomeCents).toBe(581950)
  })
})

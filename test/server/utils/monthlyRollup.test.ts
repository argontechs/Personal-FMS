// test/server/utils/monthlyRollup.test.ts
// Validates that the LIVING set in computeMonthlyRollup covers all 7 spend categories.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { db, sqlite } from '../../../server/db/index'
import { accounts, transactions } from '../../../server/db/schema'
import { runMigrations } from '../../../server/db/migrate'
import { computeMonthlyRollup } from '../../../server/utils/monthlyRollup'

beforeAll(() => { runMigrations(sqlite) })

beforeEach(() => {
  db.delete(transactions).run()
  db.delete(accounts).run()
})

function freshAccount() {
  const now = Date.now()
  const [row] = db.insert(accounts).values({
    name: 'Bank', type: 'bank' as any, balance_cents: 500000, created_at: now, updated_at: now,
  }).returning().all()
  return row.id as number
}

function insertExpense(accountId: number, category: string, amountCents: number, date = '2026-06-15') {
  db.insert(transactions).values({
    uuid: `tx-${Math.random()}`,
    date,
    amount_cents: -Math.abs(amountCents),
    direction: 'expense' as any,
    category: category as any,
    account_id: accountId,
    source: 'manual' as any,
    created_at: Date.now(),
  }).run()
}

function insertIncome(accountId: number, amountCents: number, date = '2026-06-01') {
  db.insert(transactions).values({
    uuid: `tx-${Math.random()}`,
    date,
    amount_cents: amountCents,
    direction: 'income' as any,
    category: 'income' as any,
    account_id: accountId,
    source: 'auto' as any,
    created_at: Date.now(),
  }).run()
}

describe('computeMonthlyRollup — living categories', () => {
  it('counts food, transport, bills, other as living (pre-existing)', () => {
    const acc = freshAccount()
    insertIncome(acc, 500000)
    insertExpense(acc, 'food', 3000)
    insertExpense(acc, 'transport', 2000)
    insertExpense(acc, 'bills', 10000)
    insertExpense(acc, 'other', 1500)
    const result = computeMonthlyRollup(db, '2026-06')
    expect(result.livingCents).toBe(16500)
  })

  it('counts fuel as living cost', () => {
    const acc = freshAccount()
    insertIncome(acc, 500000)
    insertExpense(acc, 'fuel', 8000)
    const result = computeMonthlyRollup(db, '2026-06')
    expect(result.livingCents).toBe(8000)
  })

  it('counts groceries as living cost', () => {
    const acc = freshAccount()
    insertIncome(acc, 500000)
    insertExpense(acc, 'groceries', 15000)
    const result = computeMonthlyRollup(db, '2026-06')
    expect(result.livingCents).toBe(15000)
  })

  it('counts shopping as living cost', () => {
    const acc = freshAccount()
    insertIncome(acc, 500000)
    insertExpense(acc, 'shopping', 5000)
    const result = computeMonthlyRollup(db, '2026-06')
    expect(result.livingCents).toBe(5000)
  })

  it('counts all 7 spend categories in living when mixed', () => {
    const acc = freshAccount()
    insertIncome(acc, 1000000)
    insertExpense(acc, 'food', 1000)
    insertExpense(acc, 'transport', 1000)
    insertExpense(acc, 'fuel', 1000)
    insertExpense(acc, 'groceries', 1000)
    insertExpense(acc, 'shopping', 1000)
    insertExpense(acc, 'bills', 1000)
    insertExpense(acc, 'other', 1000)
    const result = computeMonthlyRollup(db, '2026-06')
    expect(result.livingCents).toBe(7000)
  })

  it('does NOT count debt or interest as living', () => {
    const acc = freshAccount()
    insertIncome(acc, 500000)
    insertExpense(acc, 'debt', 50000)
    insertExpense(acc, 'interest', 5000)
    const result = computeMonthlyRollup(db, '2026-06')
    expect(result.livingCents).toBe(0)
    expect(result.debtServiceCents).toBe(50000)
    expect(result.interestCents).toBe(5000)
  })
})

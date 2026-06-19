// server/utils/__tests__/forecastReads.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { accounts, recurringItems, transactions } from '../../db/schema'
import {
  cashNowCents,
  committedOutflowsBeforeCents,
  projectedVariableSpendCents,
  spentTodayVariableCents,
  savingsTargetRemainingCents,
} from '../forecastReads'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  // minimal DDL mirroring schema.ts columns exercised here
  sqlite.exec(`
    CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      type TEXT NOT NULL, balance_cents INTEGER NOT NULL DEFAULT 0, credit_limit_cents INTEGER,
      available_credit_cents INTEGER, debt_id INTEGER, currency TEXT NOT NULL DEFAULT 'MYR',
      is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE recurring_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      direction TEXT NOT NULL, amount_cents INTEGER NOT NULL, is_variable INTEGER NOT NULL DEFAULT 0,
      cadence TEXT NOT NULL DEFAULT 'monthly', day_of_month INTEGER, weekday INTEGER,
      category TEXT NOT NULL, funding_account_id INTEGER, debt_id INTEGER,
      auto_post INTEGER NOT NULL DEFAULT 1, start_date TEXT NOT NULL, end_date TEXT,
      remaining_occurrences INTEGER, last_posted_date TEXT, next_due_date TEXT,
      remaining_installments_json TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE,
      date TEXT NOT NULL, amount_cents INTEGER NOT NULL, direction TEXT NOT NULL, category TEXT NOT NULL,
      account_id INTEGER NOT NULL, counter_account_id INTEGER, debt_id INTEGER, goal_id INTEGER,
      note TEXT, source TEXT NOT NULL, recurring_item_id INTEGER, is_estimate INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL);
  `)
  return drizzle(sqlite)
}

let db: ReturnType<typeof makeDb>
beforeEach(() => {
  db = makeDb()
})

describe('cashNowCents', () => {
  it('sums cash + bank + ewallet, excludes card and savings', () => {
    db.insert(accounts).values([
      { name: 'Bank', type: 'bank', balance_cents: 75000, created_at: 1, updated_at: 1 },
      { name: 'Cash', type: 'cash', balance_cents: 25000, created_at: 1, updated_at: 1 },
      { name: 'TNG', type: 'ewallet', balance_cents: 5000, created_at: 1, updated_at: 1 },
      { name: 'Card', type: 'card', balance_cents: -740076, created_at: 1, updated_at: 1 },
      { name: 'EF', type: 'savings', balance_cents: 100000, created_at: 1, updated_at: 1 },
    ]).run()
    // Only bank(75000) + cash(25000) + ewallet(5000) = 105000; card and EF excluded
    expect(cashNowCents(db)).toBe(105000)
  })

  it('returns 0 when no liquid accounts exist', () => {
    db.insert(accounts).values([
      { name: 'Card', type: 'card', balance_cents: -50000, created_at: 1, updated_at: 1 },
      { name: 'EF', type: 'savings', balance_cents: 100000, created_at: 1, updated_at: 1 },
    ]).run()
    expect(cashNowCents(db)).toBe(0)
  })
})

describe('committedOutflowsBeforeCents', () => {
  it('sums active expense items due strictly between today and next inflow', () => {
    db.insert(recurringItems).values([
      { name: 'Subs', direction: 'expense', amount_cents: 8200, category: 'bills',
        start_date: '2026-06-01', next_due_date: '2026-06-20', is_active: true, created_at: 1, updated_at: 1 },
      { name: 'Salary', direction: 'income', amount_cents: 581950, category: 'income',
        start_date: '2026-06-01', next_due_date: '2026-06-21', is_active: true, created_at: 1, updated_at: 1 },
      { name: 'Digi(after)', direction: 'expense', amount_cents: 37860, category: 'bills',
        start_date: '2026-06-01', next_due_date: '2026-06-30', is_active: true, created_at: 1, updated_at: 1 },
      { name: 'Paused', direction: 'expense', amount_cents: 35000, category: 'bills',
        start_date: '2026-06-01', next_due_date: '2026-06-20', is_active: false, created_at: 1, updated_at: 1 },
    ]).run()
    // window (2026-06-18, 2026-06-23): only Subs (20th) qualifies
    // income excluded; Digi 30th out of window; paused excluded
    expect(committedOutflowsBeforeCents(db, '2026-06-18', '2026-06-23')).toBe(8200)
  })

  it('excludes items on exactly the boundary dates (strictly between)', () => {
    db.insert(recurringItems).values([
      { name: 'OnToday', direction: 'expense', amount_cents: 5000, category: 'bills',
        start_date: '2026-06-01', next_due_date: '2026-06-18', is_active: true, created_at: 1, updated_at: 1 },
      { name: 'OnNextInflow', direction: 'expense', amount_cents: 3000, category: 'bills',
        start_date: '2026-06-01', next_due_date: '2026-06-23', is_active: true, created_at: 1, updated_at: 1 },
    ]).run()
    // Both boundary dates excluded (strictly between)
    expect(committedOutflowsBeforeCents(db, '2026-06-18', '2026-06-23')).toBe(0)
  })

  it('returns 0 when no qualifying items', () => {
    expect(committedOutflowsBeforeCents(db, '2026-06-18', '2026-06-23')).toBe(0)
  })

  // v2: reminder-only (auto_post=false) items are NOT auto-deducted, but the money is still
  // committed — they MUST count as expected outflows so Safe-to-Spend stays honest.
  it('counts reminder-only (auto_post=false) active expense items as committed outflows', () => {
    db.insert(recurringItems).values([
      { name: 'AutoBill', direction: 'expense', amount_cents: 8200, category: 'bills',
        auto_post: true, start_date: '2026-06-01', next_due_date: '2026-06-20', is_active: true, created_at: 1, updated_at: 1 },
      { name: 'ReminderBill', direction: 'expense', amount_cents: 12000, category: 'bills',
        auto_post: false, start_date: '2026-06-01', next_due_date: '2026-06-21', is_active: true, created_at: 1, updated_at: 1 },
    ]).run()
    // Both in window (2026-06-18, 2026-06-23): 8200 + 12000 = 20200 regardless of auto_post.
    expect(committedOutflowsBeforeCents(db, '2026-06-18', '2026-06-23')).toBe(20200)
  })
})

describe('projectedVariableSpendCents', () => {
  it('is a flat monthly budget ÷ days in month', () => {
    // food RM1,000 = 100000 sen over 30 days = 3333 sen/day (floored)
    expect(projectedVariableSpendCents(100000, 30)).toBe(3333)
  })

  it('floors the result (no rounding up)', () => {
    // 10000 / 31 = 322.58... → 322
    expect(projectedVariableSpendCents(10000, 31)).toBe(322)
  })
})

describe('spentTodayVariableCents', () => {
  it('sums discretionary expense logged on the client MYT date', () => {
    db.insert(transactions).values([
      { uuid: 'a', date: '2026-06-18', amount_cents: -1500, direction: 'expense', category: 'food',
        account_id: 1, source: 'manual', created_at: 1 },
      { uuid: 'b', date: '2026-06-18', amount_cents: -800, direction: 'expense', category: 'transport',
        account_id: 1, source: 'manual', created_at: 1 },
      { uuid: 'c', date: '2026-06-18', amount_cents: -27000, direction: 'expense', category: 'debt',
        account_id: 1, source: 'auto', created_at: 1 }, // not discretionary
      { uuid: 'd', date: '2026-06-17', amount_cents: -900, direction: 'expense', category: 'food',
        account_id: 1, source: 'manual', created_at: 1 }, // yesterday — excluded
    ]).run()
    // food(1500) + transport(800) = 2300; debt and yesterday excluded
    expect(spentTodayVariableCents(db, '2026-06-18')).toBe(2300)
  })

  it('includes the "other" category as discretionary', () => {
    db.insert(transactions).values([
      { uuid: 'e', date: '2026-06-18', amount_cents: -500, direction: 'expense', category: 'other',
        account_id: 1, source: 'manual', created_at: 1 },
    ]).run()
    expect(spentTodayVariableCents(db, '2026-06-18')).toBe(500)
  })

  it('returns 0 on a day with no variable spend', () => {
    expect(spentTodayVariableCents(db, '2026-06-18')).toBe(0)
  })
})

describe('savingsTargetRemainingCents', () => {
  // SAVINGS_TARGET_PER_CYCLE = 16667 sen (RM166.67 per cycle)
  //
  // Real EF transfer is a single-row two-leg entry (A3 convention):
  //   account_id = bank, counter_account_id = EF, amount_cents = -X, category = 'savings'
  // postTransaction then:
  //   bank.balance += -X  (bank loses X)
  //   EF.balance   -= -X  (EF gains X, via counter-leg: balance - amount_cents)
  //
  // savingsTargetRemainingCents resolves the EF account (type='savings') then sums:
  //   primary  = SUM(amount_cents WHERE account_id = efId AND date ∈ window)
  //   counter  = SUM(-amount_cents WHERE counter_account_id = efId AND date ∈ window)
  //   moved    = primary + counter

  // Helper: seed a bank account (id auto) and the EF savings account, return their ids.
  function seedAccounts() {
    db.insert(accounts).values([
      { name: 'Bank', type: 'bank', balance_cents: 200000, created_at: 1, updated_at: 1 },
      { name: 'Emergency Fund', type: 'savings', balance_cents: 0, created_at: 1, updated_at: 1 },
    ]).run()
    const bankRow = db.select({ id: accounts.id }).from(accounts).where(eq(accounts.type, 'bank')).get()!
    const efRow   = db.select({ id: accounts.id }).from(accounts).where(eq(accounts.type, 'savings')).get()!
    return { bankId: bankRow.id, efId: efRow.id }
  }

  it('is the per-cycle target minus EF transfers already made, clamped at 0', () => {
    const { bankId, efId } = seedAccounts()
    // Real two-leg EF transfer: bank→EF, amount_cents=-5000 (bank loses 5000, EF gains 5000)
    db.insert(transactions).values([
      { uuid: 'ef1', date: '2026-06-18', amount_cents: -5000, direction: 'transfer', category: 'savings',
        account_id: bankId, counter_account_id: efId, source: 'manual', created_at: 1 },
    ]).run()
    // counter leg: SUM(-amount_cents WHERE counter_account_id=efId) = -(-5000) = 5000
    // target 16667 − 5000 = 11667
    expect(savingsTargetRemainingCents(db, '2026-06-03', '2026-06-23')).toBe(11667)
  })

  it('clamps to 0 when the cycle target is already met or exceeded', () => {
    const { bankId, efId } = seedAccounts()
    // Transfer 20000 > 16667 — remaining clamps to 0
    db.insert(transactions).values([
      { uuid: 'ef2', date: '2026-06-18', amount_cents: -20000, direction: 'transfer', category: 'savings',
        account_id: bankId, counter_account_id: efId, source: 'manual', created_at: 1 },
    ]).run()
    // counter leg: -(-20000) = 20000 > 16667 → max(0, 16667-20000) = 0
    expect(savingsTargetRemainingCents(db, '2026-06-03', '2026-06-23')).toBe(0)
  })

  it('excludes EF transfers with date outside the cycle window (before cycleStart)', () => {
    const { bankId, efId } = seedAccounts()
    // Date 2026-06-02 is before cycleStart 2026-06-03 — must NOT be counted
    db.insert(transactions).values([
      { uuid: 'ef3', date: '2026-06-02', amount_cents: -5000, direction: 'transfer', category: 'savings',
        account_id: bankId, counter_account_id: efId, source: 'manual', created_at: 1 },
    ]).run()
    // Nothing in window → full target remains
    expect(savingsTargetRemainingCents(db, '2026-06-03', '2026-06-23')).toBe(16667)
  })

  it('returns full target when no savings transfers have been made this cycle', () => {
    seedAccounts()
    expect(savingsTargetRemainingCents(db, '2026-06-03', '2026-06-23')).toBe(16667)
  })

  it('returns full target when no EF (savings) account exists', () => {
    // No accounts seeded at all
    expect(savingsTargetRemainingCents(db, '2026-06-03', '2026-06-23')).toBe(16667)
  })
})

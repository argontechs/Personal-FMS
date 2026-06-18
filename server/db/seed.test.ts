// server/db/seed.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb } from './index'
import { runMigrations } from './migrate'
import { seedDatabase } from './seed'
import { accounts, debts, recurringItems, goals } from './schema'
import { recomputeBalances } from '../utils/post'

describe('seedDatabase — real 2026-06-18 data', () => {
  let handle: ReturnType<typeof createDb>
  beforeAll(() => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
    seedDatabase(handle.db)
  })
  afterAll(() => handle.sqlite.close())

  it('seeds 4 accounts incl. an EF savings account opening at RM0', () => {
    const rows = handle.db.select().from(accounts).all()
    expect(rows).toHaveLength(4)
    const ef = rows.find((a) => a.type === 'savings')!
    expect(ef.balance_cents).toBe(0)
    const card = rows.find((a) => a.type === 'card')!
    // available_credit_cents is DERIVED, never seeded
    expect(card.available_credit_cents).toBeNull()
    // confirmed real statement limit (avail 58664 + balance 740076 = 798740)
    expect(card.credit_limit_cents).toBe(798740)
    // Card account balance is stored as NEGATIVE (outstanding debt)
    // Opening-balance ledger row posts amount_cents=740076, so recomputed card.balance = -740076
    expect(card.balance_cents).toBe(-740076)
  })

  it('seeds the card debt with payoff_baseline frozen to the opening balance', () => {
    const card = handle.db.select().from(debts).where(eq(debts.type, 'revolving')).get()!
    expect(card.balance_cents).toBe(740076)
    expect(card.payoff_baseline_cents).toBe(740076)
    expect(card.apr_bps).toBe(1800)
    expect(card.statement_day).toBe(15)
    expect(card.due_day).toBe(5)
    expect(card.priority_rank).toBe(1)
  })

  it('seeds 7 debts incl. never_prepay on car + PTPTN', () => {
    const rows = handle.db.select().from(debts).all()
    expect(rows).toHaveLength(7)
    const car = rows.find((d) => d.name === 'Car Loan')!
    expect(car.balance_cents).toBe(7348467)
    expect(car.flat_rate_bps).toBe(244)
    expect(car.never_prepay).toBe(true)
    const ptptn = rows.find((d) => d.name.includes('PTPTN'))!
    expect(ptptn.balance_cents).toBe(3284362)
    expect(ptptn.apr_bps).toBe(100)
    expect(ptptn.never_prepay).toBe(true)
  })

  it('seeds SPayLater with the exact declining installments array', () => {
    const sp = handle.db.select().from(debts).where(eq(debts.name, 'ShopeePayLater')).get()!
    expect(JSON.parse(sp.remaining_installments_json!)).toEqual(
      [151950, 83682, 63165, 57307, 35528, 14651, 14651, 14651],
    )
    expect(sp.due_day).toBe(10)
  })

  // B3 correction: SPayLater recurring template is seeded → 17 templates total (not 16)
  it('seeds 17 recurring templates with the ILP PAUSED (auto_post false, not bank-flipped)', () => {
    const rows = handle.db.select().from(recurringItems).all()
    expect(rows).toHaveLength(17)
    const ilp = rows.find((r) => r.name.includes('ILP'))!
    expect(ilp.auto_post).toBe(false)
    expect(ilp.is_active).toBe(false)
    const salary = rows.find((r) => r.name === 'Net Salary')!
    expect(salary.amount_cents).toBe(581950)
    expect(salary.day_of_month).toBe(3)
    expect(salary.direction).toBe('income')
  })

  it('seeds the SPayLater recurring template with correct json and debt link (B3)', () => {
    const spTpl = handle.db.select().from(recurringItems).where(eq(recurringItems.name, 'ShopeePayLater')).get()!
    expect(spTpl).toBeTruthy()
    expect(spTpl.direction).toBe('expense')
    expect(spTpl.amount_cents).toBe(151950) // first installment
    expect(spTpl.day_of_month).toBe(10)
    expect(JSON.parse(spTpl.remaining_installments_json!)).toEqual(
      [151950, 83682, 63165, 57307, 35528, 14651, 14651, 14651],
    )
    expect(spTpl.debt_id).toBeTruthy()
  })

  it('seeds finite-occurrence loans with correct counts', () => {
    const rows = handle.db.select().from(recurringItems).all()
    expect(rows.find((r) => r.name === 'SLoan 1')!.remaining_occurrences).toBe(8)
    expect(rows.find((r) => r.name === 'SLoan 2')!.remaining_occurrences).toBe(3)
    expect(rows.find((r) => r.name === 'Ryt PayLater')!.remaining_occurrences).toBe(4)
  })

  it('sets next_due_date on every active template (single when-due field)', () => {
    const rows = handle.db.select().from(recurringItems).all()
    for (const r of rows.filter((x) => x.is_active)) {
      expect(r.next_due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('seeds 2 goals: EF (RM1,000 starter) + Kill Credit Card', () => {
    const rows = handle.db.select().from(goals).all()
    expect(rows).toHaveLength(2)
    const ef = rows.find((g) => g.type === 'savings')!
    expect(ef.target_amount_cents).toBe(100000) // RM1,000 starter (migrate to 1500000 once funded)
    const kill = rows.find((g) => g.type === 'debt_payoff')!
    expect(kill.debt_id).toBeTruthy()
  })

  it('is idempotent — second call does not duplicate rows', () => {
    seedDatabase(handle.db)
    expect(handle.db.select().from(accounts).all()).toHaveLength(4)
    expect(handle.db.select().from(debts).all()).toHaveLength(7)
    expect(handle.db.select().from(recurringItems).all()).toHaveLength(17)
    expect(handle.db.select().from(goals).all()).toHaveLength(2)
  })

  // ---------------------------------------------------------------------------
  // Parity test: recomputeBalances() must reproduce the exact opening values.
  // This proves the wipeout bug is gone — a PATCH/DELETE that calls
  // recomputeBalances() will not silently zero out the seeded balances.
  // ---------------------------------------------------------------------------
  it('recomputeBalances() after seed reproduces all opening balances (parity proof)', () => {
    // Corrupt every balance to 0, then rebuild from ledger.
    // If the opening-balance rows were posted correctly, recompute must restore them.
    handle.db.update(accounts).set({ balance_cents: 0 }).run()
    handle.db.update(debts).set({ balance_cents: 0 }).run()

    recomputeBalances(handle.db)

    const accs = handle.db.select().from(accounts).all()
    const dbs = handle.db.select().from(debts).all()

    // --- Accounts ---
    const bank = accs.find((a) => a.name === 'Bank Current')!
    expect(bank.balance_cents).toBe(75000) // RM750.00

    const tng = accs.find((a) => a.name === 'TNG eWallet')!
    expect(tng.balance_cents).toBe(25000) // RM250.00

    const ef = accs.find((a) => a.type === 'savings')!
    expect(ef.balance_cents).toBe(0) // EF opens at RM0

    // Card account: stored as negative (outstanding debt)
    const card = accs.find((a) => a.type === 'card')!
    expect(card.balance_cents).toBe(-740076) // -RM7,400.76

    // --- Debts ---
    const cardDebt = dbs.find((d) => d.type === 'revolving')!
    expect(cardDebt.balance_cents).toBe(740076)

    const carDebt = dbs.find((d) => d.name === 'Car Loan')!
    expect(carDebt.balance_cents).toBe(7348467)

    const ptptn = dbs.find((d) => d.name === 'PTPTN')!
    expect(ptptn.balance_cents).toBe(3284362)

    const sl1 = dbs.find((d) => d.name === 'SLoan 1')!
    expect(sl1.balance_cents).toBe(141944)

    const sl2 = dbs.find((d) => d.name === 'SLoan 2')!
    expect(sl2.balance_cents).toBe(27249)

    const sp = dbs.find((d) => d.name === 'ShopeePayLater')!
    expect(sp.balance_cents).toBe(435585)

    const ryt = dbs.find((d) => d.name === 'Ryt PayLater')!
    expect(ryt.balance_cents).toBe(85660)

    // Card account and card debt are mutually consistent:
    // card.balance = -(card debt balance)
    expect(card.balance_cents).toBe(-cardDebt.balance_cents)
  })
})

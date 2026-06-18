// test/server/utils/killCardFlip.test.ts
// DATABASE_URL=':memory:' set in vitest.config.ts so the module-level db singleton is in-memory.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { db, sqlite } from '../../../server/db/index'
import { accounts, recurringItems, transactions } from '../../../server/db/schema'
import { flipCardFundedToBank } from '../../../server/utils/killCardFlip'
import { runMigrations } from '../../../server/db/migrate'

// Ensure tables exist before any test runs.
beforeAll(() => {
  runMigrations(sqlite)
})

let cardId: number
let bankId: number

describe('flipCardFundedToBank', () => {
  beforeEach(() => {
    db.delete(transactions).run()
    db.delete(recurringItems).run()
    db.delete(accounts).run()
    const now = Date.now()
    const [card] = db
      .insert(accounts)
      .values({ name: 'Credit Card', type: 'card' as any, balance_cents: -740076, created_at: now, updated_at: now })
      .returning()
      .all()
    const [bank] = db
      .insert(accounts)
      .values({ name: 'Bank', type: 'bank' as any, balance_cents: 75000, created_at: now, updated_at: now })
      .returning()
      .all()
    cardId = card.id as number
    bankId = bank.id as number
    const base = {
      direction: 'expense' as any,
      cadence: 'monthly' as any,
      auto_post: true,
      is_active: true,
      start_date: '2026-06-01',
      created_at: now,
      updated_at: now,
    }
    db.insert(recurringItems)
      .values([
        { name: 'Digi', amount_cents: 37860, day_of_month: 16, category: 'bills', funding_account_id: cardId, ...base },
        { name: 'Gym', amount_cents: 19900, day_of_month: 1, category: 'bills', funding_account_id: cardId, ...base },
        { name: 'GE ILP (Great Wealth Enhancer)', amount_cents: 35000, day_of_month: 17, category: 'bills', funding_account_id: cardId, ...base },
        // Already bank-funded — must remain untouched.
        { name: 'Electricity', amount_cents: 15000, day_of_month: 16, category: 'bills', funding_account_id: bankId, ...base },
      ])
      .run()
  })

  it('flips card-funded living templates to bank but pauses the ILP', () => {
    const res = flipCardFundedToBank(cardId, bankId)
    expect(res.flipped).toBe(2) // Digi + Gym
    expect(res.paused).toBe(1)  // ILP

    const all = db.select().from(recurringItems).all()
    const digi = all.find((r) => r.name === 'Digi')!
    const gym = all.find((r) => r.name === 'Gym')!
    const ilp = all.find((r) => r.name.includes('ILP'))!
    const elec = all.find((r) => r.name === 'Electricity')!

    // Card-funded active templates flipped to bank.
    expect(digi.funding_account_id).toBe(bankId)
    expect(gym.funding_account_id).toBe(bankId)

    // ILP: paused, NOT flipped — still points at the card account, but inactive.
    expect(ilp.is_active).toBe(false)
    expect(ilp.auto_post).toBe(false)
    expect(ilp.funding_account_id).toBe(cardId)

    // Electricity was bank-funded already — unchanged.
    expect(elec.funding_account_id).toBe(bankId)
    expect(elec.is_active).toBe(true)
  })

  it('does not flip templates that are already bank-funded', () => {
    flipCardFundedToBank(cardId, bankId)
    const all = db.select().from(recurringItems).all()
    const elec = all.find((r) => r.name === 'Electricity')!
    // Funding unchanged, still active.
    expect(elec.funding_account_id).toBe(bankId)
    expect(elec.is_active).toBe(true)
  })

  it('does not flip already-paused templates (is_active=false)', () => {
    const now = Date.now()
    // Insert an extra already-paused card-funded template (not ILP).
    db.insert(recurringItems).values({
      name: 'Paused Subscription',
      amount_cents: 5000,
      day_of_month: 10,
      category: 'bills',
      funding_account_id: cardId,
      direction: 'expense' as any,
      cadence: 'monthly' as any,
      auto_post: false,
      is_active: false,
      start_date: '2026-06-01',
      created_at: now,
      updated_at: now,
    }).run()

    const res = flipCardFundedToBank(cardId, bankId)
    // Paused Subscription is not active, so it should NOT be counted in flipped.
    expect(res.flipped).toBe(2)
    expect(res.paused).toBe(1)

    const all = db.select().from(recurringItems).all()
    const paused = all.find((r) => r.name === 'Paused Subscription')!
    // Remains on card funding, still paused.
    expect(paused.funding_account_id).toBe(cardId)
    expect(paused.is_active).toBe(false)
  })

  it('does not write any transactions or modify balances', () => {
    flipCardFundedToBank(cardId, bankId)
    // No transactions table entries should exist.
    const txns = db.select().from(transactions).all()
    expect(txns.length).toBe(0)

    // Account balances untouched.
    const accts = db.select().from(accounts).all()
    const card = accts.find((a) => a.id === cardId)!
    const bank = accts.find((a) => a.id === bankId)!
    expect(card.balance_cents).toBe(-740076)
    expect(bank.balance_cents).toBe(75000)
  })

  it('is idempotent — a second call flips 0 more templates', () => {
    flipCardFundedToBank(cardId, bankId)
    const second = flipCardFundedToBank(cardId, bankId)
    // After first call, no active card-funded templates remain (ILP is paused, others flipped).
    expect(second.flipped).toBe(0)
    expect(second.paused).toBe(0)
  })
})

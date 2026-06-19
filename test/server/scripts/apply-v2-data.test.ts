// test/server/scripts/apply-v2-data.test.ts
// Verifies the one-time v2 data-fix is correct AND idempotent on an existing (v1-state) DB.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { holdings, recurringItems, accounts } from '../../../server/db/schema'
import { applyV2Data } from '../../../scripts/apply-v2-data'

const TEST_DB = './data/apply-v2-test.sqlite'

let handle: ReturnType<typeof createDb>
let bankId: number
const ts = 1_750_000_000_000

function seedOldState() {
  // Two accounts: Main Bank (the splits' funding target) + a card.
  bankId = handle.db.insert(accounts).values({ name: 'Main Bank', type: 'bank', balance_cents: 75000, sort_order: 0, created_at: ts, updated_at: ts }).returning({ id: accounts.id }).get().id
  const cardId = handle.db.insert(accounts).values({ name: 'Credit Card', type: 'card', balance_cents: 0, sort_order: 1, created_at: ts, updated_at: ts }).returning({ id: accounts.id }).get().id

  const mk = (o: any) => handle.db.insert(recurringItems).values({
    name: o.name, direction: 'expense', amount_cents: o.amount_cents, is_variable: false,
    cadence: 'monthly', day_of_month: o.day, category: 'bills', funding_account_id: o.funding,
    debt_id: null, auto_post: true, is_active: o.is_active ?? true, start_date: '2026-06-01',
    end_date: null, remaining_occurrences: null, remaining_installments_json: null,
    next_due_date: o.is_active === false ? null : '2026-06-30', created_at: ts, updated_at: ts,
  }).run()

  // v1 (pre-correction) state:
  mk({ name: 'Subscriptions', amount_cents: 8200, day: 5,  funding: cardId })          // single bundle, on card
  mk({ name: 'GE ILP',        amount_cents: 35000, day: 17, funding: cardId, is_active: false }) // paused
  mk({ name: 'Unifi',         amount_cents: 15000, day: 19, funding: cardId })          // wrong day
  // holdings table intentionally left EMPTY
}

beforeAll(() => {
  for (const ext of ['', '-shm', '-wal']) { const p = `${TEST_DB}${ext}`; if (existsSync(p)) rmSync(p) }
  handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  seedOldState()
})

describe('apply-v2-data — corrects an existing v1-state DB', () => {
  it('applies all four corrections', () => {
    const log = applyV2Data(handle.db)
    expect(log.join(' ')).toMatch(/seeded 7 holdings/)

    // 1. holdings seeded
    expect(handle.db.select().from(holdings).all().length).toBe(7)
    expect(handle.db.select().from(holdings).where(eq(holdings.name, 'AIA Assurance Account')).get()!.current_value_cents).toBe(6352297)

    // 2. GE ILP active + has a next_due_date
    const ilp = handle.db.select().from(recurringItems).where(eq(recurringItems.name, 'GE ILP')).get()!
    expect(ilp.is_active).toBe(true)
    expect(ilp.next_due_date).toBeTruthy()

    // 3. Unifi day 10
    expect(handle.db.select().from(recurringItems).where(eq(recurringItems.name, 'Unifi')).get()!.day_of_month).toBe(10)

    // 4. Subscriptions split → 3 bank-funded items, no bundle left
    expect(handle.db.select().from(recurringItems).where(eq(recurringItems.name, 'Subscriptions')).get()).toBeUndefined()
    const netflix = handle.db.select().from(recurringItems).where(eq(recurringItems.name, 'Netflix')).get()!
    expect(netflix.amount_cents).toBe(5000)
    expect(netflix.day_of_month).toBe(8)
    expect(netflix.funding_account_id).toBe(bankId)   // moved off card → bank
    expect(handle.db.select().from(recurringItems).where(eq(recurringItems.name, 'Spotify')).get()!.day_of_month).toBe(2)
    expect(handle.db.select().from(recurringItems).where(eq(recurringItems.name, 'YouTube Premium')).get()!.amount_cents).toBe(1200)
  })

  it('is idempotent — a second run changes nothing', () => {
    const log = applyV2Data(handle.db)
    expect(log.join(' ')).toMatch(/holdings: already present/)
    expect(handle.db.select().from(holdings).all().length).toBe(7)             // no dupes
    const subs = handle.db.select().from(recurringItems).all().filter(r => ['Netflix', 'Spotify', 'YouTube Premium'].includes(r.name))
    expect(subs.length).toBe(3)                                                 // no dupes
    expect(handle.db.select().from(recurringItems).where(eq(recurringItems.name, 'Unifi')).get()!.day_of_month).toBe(10)
  })
})

// test/server/utils/savingsTarget.test.ts
// Unit tests for currentCycleSavingsRemainingSen (§14.8 single-figure rule).
// DATABASE_URL=':memory:' set in vitest.config.ts so the module-level db singleton is in-memory.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { db, sqlite } from '../../../server/db/index'
import { goals, accounts } from '../../../server/db/schema'
import { runMigrations } from '../../../server/db/migrate'
import { currentCycleSavingsRemainingSen } from '../../../server/utils/savingsTarget'

beforeAll(() => {
  runMigrations(sqlite)
})

beforeEach(() => { db.delete(goals).run(); db.delete(accounts).run() })

describe('currentCycleSavingsRemainingSen', () => {
  it('returns a positive per-cycle target while the EF goal is in the buffer phase (active, < RM1,000)', () => {
    const now = Date.now()
    const ef = db.insert(accounts).values({
      name: 'Emergency Fund', type: 'savings' as any, balance_cents: 0, created_at: now, updated_at: now,
    }).returning({ id: accounts.id }).get()
    db.insert(goals).values({
      name: 'Emergency Fund', type: 'savings', target_amount_cents: 100000,
      account_id: ef.id as number, status: 'active', created_at: now, updated_at: now,
    }).run()
    // RM500/mo split across 3 inflows ≈ 16667 sen per cycle
    expect(currentCycleSavingsRemainingSen('2026-06-23')).toBe(16667)
  })

  it('returns 0 once the buffer goal is achieved (Attack phase routes surplus to the card, not EF)', () => {
    const now = Date.now()
    const ef = db.insert(accounts).values({
      name: 'Emergency Fund', type: 'savings' as any, balance_cents: 100000, created_at: now, updated_at: now,
    }).returning({ id: accounts.id }).get()
    db.insert(goals).values({
      name: 'Emergency Fund', type: 'savings', target_amount_cents: 100000,
      account_id: ef.id as number, status: 'achieved', created_at: now, updated_at: now,
    }).run()
    expect(currentCycleSavingsRemainingSen('2026-06-23')).toBe(0)
  })
})

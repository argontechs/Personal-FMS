// test/server/api/streaks-api.test.ts
// E2E integration tests for GET /api/streaks.
// Spins up the real Nitro server against a dedicated file-based SQLite DB.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { bootstrapUser } from '../../../scripts/seed-user'
import { seedDatabase } from '../../../server/db/seed'
import { transactions, accounts, goals, debts } from '../../../server/db/schema'
import { eq } from 'drizzle-orm'

const TEST_DB = './data/streaks-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD =
  process.env.NUXT_SESSION_PASSWORD || 'streaks-test-password-32chars!!'

// ---------------------------------------------------------------------------
// Setup: fresh DB, migrate, full seed (so goals/accounts/debts exist), add user
// ---------------------------------------------------------------------------

let handle: ReturnType<typeof createDb>
let sessionCookie: string

beforeAll(async () => {
  for (const ext of ['', '-shm', '-wal']) {
    const p = `${TEST_DB}${ext}`
    if (existsSync(p)) rmSync(p)
  }
  handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  seedDatabase(handle.db)       // creates accounts, goals, debts (idempotent)
  await bootstrapUser(handle.db, 'streaksowner', 'streaks-pass-123')
  handle.sqlite.close()
})

await setup({
  server: true,
  browser: false,
  env: {
    DATABASE_URL: `file:${TEST_DB}`,
    NUXT_SESSION_PASSWORD: process.env.NUXT_SESSION_PASSWORD,
  },
  nuxtConfig: { modules: [] },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getSessionCookie(): Promise<string> {
  if (sessionCookie) return sessionCookie
  const res = await nitroFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'streaksowner', password: 'streaks-pass-123' }),
  })
  const setCookieHeader = res.headers.get('set-cookie') ?? ''
  sessionCookie = setCookieHeader.split(';')[0]
  return sessionCookie
}

async function authFetch(path: string, opts: Record<string, unknown> = {}): Promise<any> {
  const cookie = await getSessionCookie()
  return $fetch(path, { ...opts, headers: { ...((opts.headers as any) ?? {}), cookie } })
}

// ---------------------------------------------------------------------------
// Auth gating
// ---------------------------------------------------------------------------

describe('streaks API — auth gating', () => {
  it('GET /api/streaks → 401 without session', async () => {
    await expect($fetch('/api/streaks')).rejects.toMatchObject({ statusCode: 401 })
  })
})

// ---------------------------------------------------------------------------
// Fresh DB — no transactions
// ---------------------------------------------------------------------------

describe('streaks API — no transactions', () => {
  it('returns streak=0 and all milestones not achieved', async () => {
    const data = await authFetch('/api/streaks')

    expect(data.currentStreak).toBe(0)
    expect(data.longestStreak).toBe(0)
    expect(data.loggedToday).toBe(false)
    expect(data.lastLoggedDate).toBeNull()

    // All milestones not achieved (EF is empty after seed, CC has balance)
    expect(Array.isArray(data.milestones)).toBe(true)
    expect(data.milestones).toHaveLength(6)

    const firstLog = data.milestones.find((m: any) => m.key === 'first-log')
    expect(firstLog?.achieved).toBe(false)
    expect(firstLog?.progress).toBe(0)

    const streak7 = data.milestones.find((m: any) => m.key === 'streak-7')
    expect(streak7?.achieved).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 1 user-facing transaction → first-log milestone achieved
// ---------------------------------------------------------------------------

describe('streaks API — first-log milestone', () => {
  it('after posting 1 spend transaction, first-log.achieved === true', async () => {
    // Find the cash account id (seeded by seedDatabase)
    const accts = await authFetch('/api/accounts')
    const cashAcct = (accts as any[]).find((a: any) => a.type === 'cash')
    const cashId = cashAcct?.id ?? 1

    // Post a user-facing spend transaction
    await authFetch('/api/transactions', {
      method: 'POST',
      body: {
        uuid: 'streak-seed-1',
        date: '2026-06-01',
        amount_cents: -1000,
        direction: 'expense',
        category: 'food',
        account_id: cashId,
        source: 'manual',
      },
    })

    const data = await authFetch('/api/streaks')
    const firstLog = data.milestones.find((m: any) => m.key === 'first-log')
    expect(firstLog?.achieved).toBe(true)
    expect(firstLog?.progress).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// EF balance ≥ RM1,000 → ef-1000 milestone achieved
// ---------------------------------------------------------------------------

describe('streaks API — ef-1000 milestone', () => {
  it('ef-1000.achieved === true when EF balance ≥ 100000 sen', async () => {
    // Transfer RM1,000 to EF via the transfers API
    const accts = await authFetch('/api/accounts')
    const cashAcct = (accts as any[]).find((a: any) => a.type === 'cash')
    const efAcct = (accts as any[]).find((a: any) => a.type === 'savings')
    expect(efAcct).toBeDefined()

    await authFetch('/api/transfers', {
      method: 'POST',
      body: {
        uuid: 'streak-ef-transfer-1',
        date: '2026-06-01',
        amount_cents: 100000,        // RM1,000 in sen
        from_account_id: cashAcct?.id ?? 1,
        to_account_id: efAcct?.id,
        note: 'EF seed for test',
        source: 'manual',
      },
    })

    const data = await authFetch('/api/streaks')
    const ef1000 = data.milestones.find((m: any) => m.key === 'ef-1000')
    expect(ef1000?.achieved).toBe(true)
    expect(ef1000?.progress).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// card-paid milestone tracks the CREDIT-CARD debt specifically — not the sum
// of every debt (regression: it must flip true when the card hits 0 even while
// the car loan / PTPTN / student loans are still outstanding).
// ---------------------------------------------------------------------------

describe('streaks API — card-paid milestone', () => {
  it('achieved when the card balance reaches 0, even while other debts remain', async () => {
    // Zero ONLY the credit-card debt (the one linked to the debt_payoff goal).
    const h = createDb(TEST_DB)
    const cardGoal = h.db.select().from(goals).where(eq(goals.type, 'debt_payoff')).get() as any
    h.db.update(debts).set({ balance_cents: 0 }).where(eq(debts.id, cardGoal.debt_id)).run()
    const otherOutstanding = (h.db.select().from(debts).all() as any[]).filter(
      (d) => d.id !== cardGoal.debt_id && d.balance_cents > 0
    )
    h.sqlite.close()

    // Guard: the scenario is only meaningful if other debts are still non-zero.
    expect(otherOutstanding.length).toBeGreaterThan(0)

    const data = await authFetch('/api/streaks')
    const cardPaid = data.milestones.find((m: any) => m.key === 'card-paid')
    expect(cardPaid?.achieved).toBe(true)
    expect(cardPaid?.progress).toBe(1)
  })
})

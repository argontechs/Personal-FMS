// test/server/api/correct-cash.test.ts
// E2E integration tests for the correct-cash endpoint.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { bootstrapUser } from '../../../scripts/seed-user'
import { accounts, transactions } from '../../../server/db/schema'
import { recomputeBalances } from '../../../server/utils/post'

const TEST_DB = './data/correct-cash-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD = process.env.NUXT_SESSION_PASSWORD || 'correct-cash-test-pass-32-chars!'

let bankId: number
let cashId: number
let handle: ReturnType<typeof createDb>
let sessionCookie: string

beforeAll(async () => {
  // Start from a clean slate.
  for (const ext of ['', '-shm', '-wal']) {
    const p = `${TEST_DB}${ext}`
    if (existsSync(p)) rmSync(p)
  }
  handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  await bootstrapUser(handle.db, 'cashowner', 'cash-pass-123')

  // Seed a bank account with 75000 cents (750.00)
  const now = Date.now()
  const [b] = handle.db.insert(accounts).values({
    name: 'Bank',
    type: 'bank' as any,
    balance_cents: 75000,
    created_at: now,
    updated_at: now,
  }).returning().all()
  bankId = b.id as number

  // Create a cash account for the parity test
  const [c] = handle.db.insert(accounts).values({
    name: 'Cash',
    type: 'cash' as any,
    balance_cents: 0,
    created_at: now,
    updated_at: now,
  }).returning().all()
  cashId = c.id as number
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

// Helper: log in and return the session cookie.
async function getSessionCookie(): Promise<string> {
  if (sessionCookie) return sessionCookie
  const res = await nitroFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cashowner', password: 'cash-pass-123' }),
  })
  const setCookieHeader = res.headers.get('set-cookie') ?? ''
  sessionCookie = setCookieHeader.split(';')[0]
  return sessionCookie
}

// Helper: authenticated $fetch wrapper.
async function authFetch(path: string, opts: Record<string, unknown> = {}): Promise<any> {
  const cookie = await getSessionCookie()
  return $fetch(path, { ...opts, headers: { ...((opts.headers as any) ?? {}), cookie } })
}

describe('correct-cash API', () => {
  it('POST /api/accounts/correct-cash → 401 without session', async () => {
    try {
      await $fetch('/api/accounts/correct-cash', { method: 'POST', body: { account_id: bankId, target_cents: 100000 } })
      expect.fail('should have thrown 401')
    } catch (e: any) {
      expect(e.status).toBe(401)
    }
  })

  it('writes a single adjustment row for the difference and moves balance to target', async () => {
    const res = await authFetch('/api/accounts/correct-cash', { method: 'POST', body: { account_id: bankId, target_cents: 100000 } })
    expect(res.adjustment_cents).toBe(25000) // 1000.00 − 750.00

    // Reopen DB to check the balance
    const handle = createDb(TEST_DB)
    const acc = handle.db.select().from(accounts).all().find(a => a.id === bankId)!
    expect(acc.balance_cents).toBe(100000)

    const adj = handle.db.select().from(transactions).all().find(t => t.category === 'adjustment')
    expect(adj!.source).toBe('adjustment')
    expect(adj!.amount_cents).toBe(25000)
    expect(adj!.account_id).toBe(bankId)
    handle.sqlite.close()
  })

  it('writes a negative adjustment when target is below current', async () => {
    // bank now at 100000 from previous test
    const res = await authFetch('/api/accounts/correct-cash', { method: 'POST', body: { account_id: bankId, target_cents: 80000 } })
    expect(res.adjustment_cents).toBe(-20000)

    const handle = createDb(TEST_DB)
    const acc = handle.db.select().from(accounts).all().find(a => a.id === bankId)!
    expect(acc.balance_cents).toBe(80000)
    handle.sqlite.close()
  })

  it('no-ops when already on target', async () => {
    const res = await authFetch('/api/accounts/correct-cash', { method: 'POST', body: { account_id: bankId, target_cents: 80000 } })
    expect(res.id).toBe(null)
    expect(res.adjustment_cents).toBe(0)
  })

  it('validates required fields', async () => {
    try {
      await authFetch('/api/accounts/correct-cash', { method: 'POST', body: { account_id: bankId } })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it('returns 404 for non-existent account', async () => {
    try {
      await authFetch('/api/accounts/correct-cash', { method: 'POST', body: { account_id: 99999, target_cents: 100000 } })
      expect.fail('should have thrown 404')
    } catch (e: any) {
      expect(e.status).toBe(404)
    }
  })

  it('recomputeBalances verifies parity after adjustment', async () => {
    // Use cashId (which starts at 0) to test parity on a clean account
    // Correct to a specific target
    const newTarget = 50000
    const res = await authFetch('/api/accounts/correct-cash', { method: 'POST', body: { account_id: cashId, target_cents: newTarget } })
    expect(res.adjustment_cents).toBe(newTarget)

    const handle2 = createDb(TEST_DB)
    const accAfter = handle2.db.select().from(accounts).all().find(a => a.id === cashId)!
    expect(accAfter.balance_cents).toBe(newTarget)

    // Recompute and verify the balance remains correct (ledger parity)
    recomputeBalances(handle2.db)
    const accRecomputed = handle2.db.select().from(accounts).all().find(a => a.id === cashId)!
    expect(accRecomputed.balance_cents).toBe(newTarget)
    handle2.sqlite.close()
  })
})

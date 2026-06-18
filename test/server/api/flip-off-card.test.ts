// test/server/api/flip-off-card.test.ts
// E2E integration tests for the flip-off-card endpoint.
// Spins up the real Nitro server against a dedicated file-based SQLite DB.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { bootstrapUser } from '../../../scripts/seed-user'
import { accounts, recurringItems } from '../../../server/db/schema'

const TEST_DB = './data/flip-off-card-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD = process.env.NUXT_SESSION_PASSWORD || 'flip-off-card-test-pass-32chars!'

let cardId: number
let bankId: number
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
  await bootstrapUser(handle.db, 'flipowner', 'flip-pass-123')

  const now = Date.now()
  const [c] = handle.db
    .insert(accounts)
    .values({ name: 'Credit Card', type: 'card' as any, balance_cents: -740076, created_at: now, updated_at: now })
    .returning()
    .all()
  const [bk] = handle.db
    .insert(accounts)
    .values({ name: 'Bank', type: 'bank' as any, balance_cents: 75000, created_at: now, updated_at: now })
    .returning()
    .all()
  cardId = c.id as number
  bankId = bk.id as number

  // Seed: Unifi (card-funded, active), Digi (card-funded, active), ILP (card-funded, active)
  const base = {
    direction: 'expense' as any,
    cadence: 'monthly' as any,
    auto_post: true,
    is_active: true,
    start_date: '2026-06-01',
    created_at: now,
    updated_at: now,
  }
  handle.db
    .insert(recurringItems)
    .values([
      { name: 'Unifi', amount_cents: 15000, day_of_month: 19, category: 'bills', funding_account_id: cardId, ...base },
      { name: 'Digi', amount_cents: 37860, day_of_month: 16, category: 'bills', funding_account_id: cardId, ...base },
      { name: 'GE ILP (Great Wealth Enhancer)', amount_cents: 35000, day_of_month: 17, category: 'bills', funding_account_id: cardId, ...base },
    ])
    .run()
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
    body: JSON.stringify({ username: 'flipowner', password: 'flip-pass-123' }),
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

describe('flip-off-card API', () => {
  it('POST /api/recurring/flip-off-card → 401 without session', async () => {
    try {
      await $fetch('/api/recurring/flip-off-card', {
        method: 'POST',
        body: { card_account_id: cardId, bank_account_id: bankId },
      })
      expect.fail('should have thrown 401')
    } catch (e: any) {
      expect(e.status).toBe(401)
    }
  })

  it('flips card-funded templates and pauses ILP — returns correct counts', async () => {
    const res = await authFetch('/api/recurring/flip-off-card', {
      method: 'POST',
      body: { card_account_id: cardId, bank_account_id: bankId },
    })
    expect(res.flipped).toBe(2)  // Unifi + Digi
    expect(res.paused).toBe(1)   // ILP

    // Verify by reopening the DB.
    const h = createDb(TEST_DB)
    const all = h.db.select().from(recurringItems).all()

    const unifi = all.find((r) => r.name === 'Unifi')!
    const digi = all.find((r) => r.name === 'Digi')!
    const ilp = all.find((r) => r.name.includes('ILP'))!

    expect(unifi.funding_account_id).toBe(bankId)
    expect(digi.funding_account_id).toBe(bankId)

    expect(ilp.is_active).toBe(false)
    expect(ilp.auto_post).toBe(false)
    expect(ilp.funding_account_id).toBe(cardId) // NOT flipped

    // Verify no transaction rows were written (pure metadata change).
    const { transactions } = await import('../../../server/db/schema')
    const txns = h.db.select().from(transactions).all()
    expect(txns.length).toBe(0)

    h.sqlite.close()
  })

  it('returns 400 when card_account_id is missing', async () => {
    try {
      await authFetch('/api/recurring/flip-off-card', {
        method: 'POST',
        body: { bank_account_id: bankId },
      })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it('returns 400 when bank_account_id is missing', async () => {
    try {
      await authFetch('/api/recurring/flip-off-card', {
        method: 'POST',
        body: { card_account_id: cardId },
      })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it('is idempotent — second call after first flip returns 0/0', async () => {
    // First flip already happened in previous test; a second call finds nothing left to flip.
    const res = await authFetch('/api/recurring/flip-off-card', {
      method: 'POST',
      body: { card_account_id: cardId, bank_account_id: bankId },
    })
    expect(res.flipped).toBe(0)
    expect(res.paused).toBe(0)
  })
})

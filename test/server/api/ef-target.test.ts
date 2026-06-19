// test/server/api/ef-target.test.ts
// E2E integration tests for the PATCH /api/goals/ef-target endpoint.
// Spins up the real Nitro server against a dedicated file-based SQLite DB.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { bootstrapUser } from '../../../scripts/seed-user'
import { accounts, goals, debts } from '../../../server/db/schema'

const TEST_DB = './data/ef-target-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD = process.env.NUXT_SESSION_PASSWORD || 'ef-target-test-pass-32-chars!!!'

let handle: ReturnType<typeof createDb>
let sessionCookie: string

beforeAll(async () => {
  for (const ext of ['', '-shm', '-wal']) {
    const p = `${TEST_DB}${ext}`
    if (existsSync(p)) rmSync(p)
  }
  handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  await bootstrapUser(handle.db, 'efowner', 'ef-pass-123')

  const now = Date.now()

  // Create the EF savings account
  const [efAcc] = handle.db.insert(accounts).values({
    name: 'Emergency Fund',
    type: 'savings' as any,
    balance_cents: 50000,
    created_at: now,
    updated_at: now,
  }).returning().all()

  // Create the EF goal (type='savings')
  handle.db.insert(goals).values({
    name: 'Emergency Fund',
    type: 'savings' as any,
    target_amount_cents: 100000,
    account_id: efAcc.id as number,
    status: 'active' as any,
    created_at: now,
    updated_at: now,
  }).run()

  // Create a credit card account + debt for debt_payoff goal (readGoals requires both)
  const [cardAcc] = handle.db.insert(accounts).values({
    name: 'Credit Card',
    type: 'card' as any,
    balance_cents: -100000,
    created_at: now,
    updated_at: now,
  }).returning().all()

  const [cardDebt] = handle.db.insert(debts).values({
    name: 'Credit Card',
    type: 'revolving' as any,
    balance_cents: 100000,
    rate_type: 'apr' as any,
    apr_bps: 1800,
    bt_status: 'none' as any,
    created_at: now,
    updated_at: now,
  }).returning().all()

  handle.db.insert(goals).values({
    name: 'Kill Card',
    type: 'debt_payoff' as any,
    target_amount_cents: 0,
    debt_id: cardDebt.id as number,
    status: 'active' as any,
    created_at: now,
    updated_at: now,
  }).run()

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

async function getSessionCookie(): Promise<string> {
  if (sessionCookie) return sessionCookie
  const res = await nitroFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'efowner', password: 'ef-pass-123' }),
  })
  const setCookieHeader = res.headers.get('set-cookie') ?? ''
  sessionCookie = setCookieHeader.split(';')[0]
  return sessionCookie
}

async function authFetch(path: string, opts: Record<string, unknown> = {}): Promise<any> {
  const cookie = await getSessionCookie()
  return $fetch(path, { ...opts, headers: { ...((opts.headers as any) ?? {}), cookie } })
}

describe('PATCH /api/goals/ef-target', () => {
  it('returns 401 without session', async () => {
    try {
      await $fetch('/api/goals/ef-target', { method: 'PATCH', body: { targetAmountCents: 100000 } })
      expect.fail('should have thrown 401')
    } catch (e: any) {
      expect(e.status).toBe(401)
    }
  })

  it('sets target_amount_cents to a positive integer', async () => {
    const res = await authFetch('/api/goals/ef-target', { method: 'PATCH', body: { targetAmountCents: 150000 } })
    expect(res.target_amount_cents).toBe(150000)
    expect(res.type).toBe('savings')
  })

  it('RM 1,000 preset — sets target to 100000 cents', async () => {
    const res = await authFetch('/api/goals/ef-target', { method: 'PATCH', body: { targetAmountCents: 100000 } })
    expect(res.target_amount_cents).toBe(100000)
  })

  it('RM 15,000 preset — sets target to 1500000 cents', async () => {
    const res = await authFetch('/api/goals/ef-target', { method: 'PATCH', body: { targetAmountCents: 1500000 } })
    expect(res.target_amount_cents).toBe(1500000)
  })

  it('rejects zero with 400', async () => {
    try {
      await authFetch('/api/goals/ef-target', { method: 'PATCH', body: { targetAmountCents: 0 } })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it('rejects negative value with 400', async () => {
    try {
      await authFetch('/api/goals/ef-target', { method: 'PATCH', body: { targetAmountCents: -5000 } })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it('rejects non-integer (float) with 400', async () => {
    try {
      await authFetch('/api/goals/ef-target', { method: 'PATCH', body: { targetAmountCents: 100.5 } })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it('rejects missing body with 400', async () => {
    try {
      await authFetch('/api/goals/ef-target', { method: 'PATCH', body: {} })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })
})

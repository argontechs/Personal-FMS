// test/server/api/debts.test.ts
// E2E integration tests for GET /api/debts — the all-debts list endpoint.
// Spins up the real Nitro server against a dedicated file-based SQLite DB.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { bootstrapUser } from '../../../scripts/seed-user'
import { debts } from '../../../server/db/schema'

const TEST_DB = './data/debts-list-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD =
  process.env.NUXT_SESSION_PASSWORD || 'debts-test-password-32-chars!!'

let handle: ReturnType<typeof createDb>
let sessionCookie: string

// ── Seed ──────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  for (const ext of ['', '-shm', '-wal']) {
    const p = `${TEST_DB}${ext}`
    if (existsSync(p)) rmSync(p)
  }
  handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  await bootstrapUser(handle.db, 'debtowner', 'debt-pass-123')

  const now = Date.now()

  // Seed 3 debts with distinct priority_ranks so we can assert sort order.
  handle.db.insert(debts).values([
    {
      name: 'Personal Loan A',
      type: 'flat_loan',
      balance_cents: 300000,
      rate_type: 'flat',
      flat_rate_bps: 244, // 2.44%
      min_payment_cents: 15000,
      due_day: 15,
      priority_rank: 3,
      payoff_baseline_cents: 400000,
      created_at: now,
      updated_at: now,
    },
    {
      name: 'Credit Card',
      type: 'revolving',
      balance_cents: 740076,
      rate_type: 'apr',
      apr_bps: 1800, // 18%
      min_payment_cents: 5000,
      due_day: 25,
      priority_rank: 1,
      payoff_baseline_cents: 800000,
      created_at: now,
      updated_at: now,
    },
    {
      name: 'Car Loan',
      type: 'installment',
      balance_cents: 2500000,
      rate_type: 'flat',
      flat_rate_bps: 175, // 1.75%
      min_payment_cents: 55000,
      due_day: 10,
      priority_rank: 2,
      payoff_baseline_cents: null,
      created_at: now,
      updated_at: now,
    },
  ]).run()

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

// ── Helpers ────────────────────────────────────────────────────────────────────
async function getSessionCookie(): Promise<string> {
  if (sessionCookie) return sessionCookie
  const res = await nitroFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'debtowner', password: 'debt-pass-123' }),
  })
  const setCookieHeader = res.headers.get('set-cookie') ?? ''
  sessionCookie = setCookieHeader.split(';')[0]
  return sessionCookie
}

async function authFetch(path: string, opts: Record<string, unknown> = {}): Promise<any> {
  const cookie = await getSessionCookie()
  return $fetch(path, { ...opts, headers: { ...((opts.headers as any) ?? {}), cookie } })
}

// ── Auth gating ────────────────────────────────────────────────────────────────
describe('GET /api/debts — auth gating', () => {
  it('returns 401 without a session cookie', async () => {
    await expect($fetch('/api/debts')).rejects.toMatchObject({ statusCode: 401 })
  })
})

// ── Happy path ─────────────────────────────────────────────────────────────────
describe('GET /api/debts — returns all debts in priority order', () => {
  it('returns an array', async () => {
    const rows = await authFetch('/api/debts')
    expect(Array.isArray(rows)).toBe(true)
  })

  it('returns all 3 seeded debts', async () => {
    const rows = await authFetch('/api/debts')
    expect(rows.length).toBe(3)
  })

  it('rows are ordered by priority_rank ascending (Credit Card first = rank 1)', async () => {
    const rows = await authFetch('/api/debts')
    expect(rows[0].name).toBe('Credit Card')
    expect(rows[1].name).toBe('Car Loan')
    expect(rows[2].name).toBe('Personal Loan A')
  })

  it('each row has the required fields', async () => {
    const rows = await authFetch('/api/debts')
    for (const row of rows) {
      expect(typeof row.id).toBe('number')
      expect(typeof row.name).toBe('string')
      expect(typeof row.type).toBe('string')
      expect(typeof row.balance_cents).toBe('number')
      expect('rate_type' in row).toBe(true)
      expect('priority_rank' in row).toBe(true)
      expect('payoff_baseline_cents' in row).toBe(true)
    }
  })

  it('credit card row has 18% APR (apr_bps=1800)', async () => {
    const rows = await authFetch('/api/debts')
    const card = rows.find((r: any) => r.type === 'revolving')
    expect(card).toBeDefined()
    expect(card.apr_bps).toBe(1800)
  })

  it('car loan has null payoff_baseline_cents (progress bar hidden)', async () => {
    const rows = await authFetch('/api/debts')
    const car = rows.find((r: any) => r.name === 'Car Loan')
    expect(car.payoff_baseline_cents).toBeNull()
  })
})

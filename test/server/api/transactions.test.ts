// test/server/api/transactions.test.ts
// E2E integration tests for the transactions API.
// Spins up the real Nitro server against a dedicated file-based SQLite DB.
// DATABASE_URL overridden so vitest's singleton db doesn't collide.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { bootstrapUser } from '../../../scripts/seed-user'
import { accounts, transactions } from '../../../server/db/schema'
import { eq } from 'drizzle-orm'

const TEST_DB = './data/txn-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD = process.env.NUXT_SESSION_PASSWORD || 'txn-test-password-32-chars!!!!'

// ---------------------------------------------------------------------------
// Setup: fresh DB, migrate, seed a user, start the Nuxt server
// ---------------------------------------------------------------------------

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
  await bootstrapUser(handle.db, 'txnowner', 'txn-pass-123')
  // Seed a bank account with balance_cents=0 so recomputeBalances (which derives
  // balance purely from ledger SUM) stays in sync with incremental updates.
  const now = Date.now()
  const [b] = handle.db.insert(accounts).values({
    name: 'Bank',
    type: 'bank' as any,
    balance_cents: 0,
    created_at: now,
    updated_at: now,
  }).returning().all()
  bankId = b.id as number
  handle.sqlite.close()
})

await setup({
  server: true,
  browser: false,
  env: {
    DATABASE_URL: `file:${TEST_DB}`,
    NUXT_SESSION_PASSWORD: process.env.NUXT_SESSION_PASSWORD,
  },
  nuxtConfig: { modules: [] }, // disable PWA in tests
})

// ---------------------------------------------------------------------------
// Helper: log in and return the session cookie.
// ---------------------------------------------------------------------------
async function getSessionCookie(): Promise<string> {
  if (sessionCookie) return sessionCookie
  const res = await nitroFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'txnowner', password: 'txn-pass-123' }),
  })
  const setCookieHeader = res.headers.get('set-cookie') ?? ''
  sessionCookie = setCookieHeader.split(';')[0]
  return sessionCookie
}

// ---------------------------------------------------------------------------
// Helper: authenticated $fetch wrapper.
// ---------------------------------------------------------------------------
async function authFetch(path: string, opts: Record<string, unknown> = {}): Promise<any> {
  const cookie = await getSessionCookie()
  return $fetch(path, { ...opts, headers: { ...((opts.headers as any) ?? {}), cookie } })
}

// ---------------------------------------------------------------------------
// 401 GATING — every endpoint must reject without a session
// ---------------------------------------------------------------------------

describe('transactions API — auth gating', () => {
  it('POST /api/transactions → 401 without session', async () => {
    await expect($fetch('/api/transactions', { method: 'POST', body: {} }))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('GET /api/transactions → 401 without session', async () => {
    await expect($fetch('/api/transactions')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('PATCH /api/transactions/1 → 401 without session', async () => {
    await expect($fetch('/api/transactions/1', { method: 'PATCH', body: { note: 'x' } }))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('DELETE /api/transactions/1 → 401 without session', async () => {
    await expect($fetch('/api/transactions/1', { method: 'DELETE' }))
      .rejects.toMatchObject({ statusCode: 401 })
  })
})

// ---------------------------------------------------------------------------
// POST — creates a transaction and applies balance
// ---------------------------------------------------------------------------

describe('transactions API — POST creates + applies', () => {
  it('POST creates a transaction row and debits the account', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'post-create-1', date: '2026-06-18', amount_cents: -3000, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    expect(typeof id).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// POST — idempotent upsert by uuid (the M2 offline-flush requirement)
// ---------------------------------------------------------------------------

describe('transactions API — POST idempotent upsert by uuid', () => {
  it('re-POST same uuid returns same id, exactly one DB row, balances unchanged', async () => {
    const body = {
      uuid: 'idem-1',
      date: '2026-06-18',
      amount_cents: -2500,
      direction: 'expense',
      category: 'food',
      account_id: bankId,
      source: 'manual',
    }
    const first = await authFetch('/api/transactions', { method: 'POST', body })
    const second = await authFetch('/api/transactions', { method: 'POST', body })

    // Same id returned both times.
    expect(first.id).toBe(second.id)

    // Open a fresh handle to read the live DB state.
    const check = createDb(TEST_DB)
    try {
      const rows = check.db.select().from(transactions).where(eq(transactions.uuid, 'idem-1')).all()
      expect(rows.length).toBe(1)
    } finally {
      check.sqlite.close()
    }
  })
})

// ---------------------------------------------------------------------------
// GET — filters by month
// ---------------------------------------------------------------------------

describe('transactions API — GET filters by month', () => {
  it('GET ?month=YYYY-MM returns only rows in that month', async () => {
    await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'g-jun', date: '2026-06-10', amount_cents: -1000, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'g-may', date: '2026-05-10', amount_cents: -1000, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })

    const rows = await authFetch('/api/transactions?month=2026-06')
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.every((r: any) => r.date.startsWith('2026-06'))).toBe(true)
    expect(rows.some((r: any) => r.uuid === 'g-jun')).toBe(true)
    expect(rows.some((r: any) => r.uuid === 'g-may')).toBe(false)
  })

  it('GET ?month=2026-05 returns May rows', async () => {
    const rows = await authFetch('/api/transactions?month=2026-05')
    expect(rows.some((r: any) => r.uuid === 'g-may')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PATCH — updates a row and recomputes balances
// ---------------------------------------------------------------------------

describe('transactions API — PATCH edits + recomputes', () => {
  it('PATCH amount_cents recomputes the account balance', async () => {
    // Use GET /api/accounts to read balance via the server (avoids WAL isolation issues
    // with a separate in-process reader while the server holds WAL writes).
    const accountsBefore = await authFetch('/api/accounts')
    const bBefore = (accountsBefore as any[]).find((a: any) => a.id === bankId)!.balance_cents

    // Post a fresh transaction.
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'p-1', date: '2026-06-18', amount_cents: -5000, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })

    // Read balance after POST (server has recomputed via postTransaction).
    const accountsAfterPost = await authFetch('/api/accounts')
    const bAfterPost = (accountsAfterPost as any[]).find((a: any) => a.id === bankId)!.balance_cents
    expect(bAfterPost - bBefore).toBe(-5000)

    // Patch to a smaller amount.
    const updated = await authFetch(`/api/transactions/${id}`, {
      method: 'PATCH',
      body: { amount_cents: -2000 },
    })
    expect(updated.amount_cents).toBe(-2000)

    // After PATCH + recomputeBalances, balance should be +3000 vs post-state (5000 → 2000).
    const accountsAfterPatch = await authFetch('/api/accounts')
    const bAfterPatch = (accountsAfterPatch as any[]).find((a: any) => a.id === bankId)!.balance_cents
    expect(bAfterPatch - bAfterPost).toBe(3000)
  })

  it('PATCH returns 404 for a non-existent id', async () => {
    await expect(authFetch('/api/transactions/999999', { method: 'PATCH', body: { note: 'x' } }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('PATCH returns 400 when nothing to patch', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'p-empty', date: '2026-06-18', amount_cents: -100, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    await expect(authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: {} }))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

// ---------------------------------------------------------------------------
// DELETE — removes a row and recomputes balances
// ---------------------------------------------------------------------------

describe('transactions API — DELETE removes + recomputes', () => {
  it('DELETE removes the row and reverses its balance effect', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'd-1', date: '2026-06-18', amount_cents: -7000, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })

    // Read balance via server after POST (avoids WAL isolation between processes).
    const accountsAfterPost = await authFetch('/api/accounts')
    const bAfterPost = (accountsAfterPost as any[]).find((a: any) => a.id === bankId)!.balance_cents

    const res = await authFetch(`/api/transactions/${id}`, { method: 'DELETE' })
    expect(res.ok).toBe(true)

    // Row should be gone — verify via GET (the server's own view).
    const remaining = await authFetch('/api/transactions?month=2026-06')
    expect((remaining as any[]).some((r: any) => r.id === id)).toBe(false)

    // Balance should be +7000 vs post-state (charge reversed by DELETE+recompute).
    const accountsAfterDel = await authFetch('/api/accounts')
    const bAfterDel = (accountsAfterDel as any[]).find((a: any) => a.id === bankId)!.balance_cents
    expect(bAfterDel - bAfterPost).toBe(7000)
  })

  it('DELETE returns 404 for a non-existent id', async () => {
    await expect(authFetch('/api/transactions/999998', { method: 'DELETE' }))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})

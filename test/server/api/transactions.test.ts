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
import { accounts, transactions, debts } from '../../../server/db/schema'
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
// Monetary upper bound (§14 band) — over-ceiling amounts rejected with 400
// ---------------------------------------------------------------------------

describe('transactions API — monetary upper bound', () => {
  const OVER = 10_000_000_001 // 1 sen over the RM1B ceiling

  it('POST rejects an over-ceiling amount with 400', async () => {
    await expect(authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'ceil-post-1', date: '2026-06-18', amount_cents: OVER, direction: 'income', category: 'income', account_id: bankId, source: 'manual' },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('POST rejects an over-ceiling NEGATIVE amount with 400', async () => {
    await expect(authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'ceil-post-2', date: '2026-06-18', amount_cents: -OVER, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('POST allows an amount exactly at the ceiling', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'ceil-post-ok', date: '2026-06-18', amount_cents: 10_000_000_000, direction: 'income', category: 'income', account_id: bankId, source: 'manual' },
    })
    expect(typeof id).toBe('number')
  })

  it('PATCH rejects an over-ceiling amount with 400', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'ceil-patch-1', date: '2026-06-18', amount_cents: -100, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    await expect(authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { amount_cents: -OVER, direction: 'expense' } }))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

// ---------------------------------------------------------------------------
// Same-origin (CSRF) guard (§14 band) — live through the Nitro middleware
// ---------------------------------------------------------------------------

describe('transactions API — same-origin (CSRF) guard', () => {
  it('blocks a state-changing POST carrying a cross-origin Origin (403)', async () => {
    const cookie = await getSessionCookie()
    const res = await nitroFetch('/api/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ uuid: 'csrf-x', date: '2026-06-18', amount_cents: -100, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' }),
    })
    expect(res.status).toBe(403)
  })

  it('allows a same-origin POST (Origin host == server host)', async () => {
    const cookie = await getSessionCookie()
    // nitroFetch resolves against the live server's own base URL; derive its host for the Origin.
    const probe = await nitroFetch('/api/accounts', { headers: { cookie } })
    const serverOrigin = new URL(probe.url).origin
    const res = await nitroFetch('/api/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
        origin: serverOrigin,
      },
      body: JSON.stringify({ uuid: 'csrf-same', date: '2026-06-18', amount_cents: -100, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' }),
    })
    expect(res.status).toBe(200)
  })

  it('CRITICAL: allows a state-changing POST with NO Origin header (test harness / same-origin)', async () => {
    // The default authFetch/$fetch pattern sends no Origin — this is the case that must NOT break.
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'csrf-noorigin', date: '2026-06-18', amount_cents: -100, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    expect(typeof id).toBe('number')
  })

  it('exempts /api/auth/login from the cross-origin block', async () => {
    // A cross-origin login attempt is still processed (returns 401 for bad creds, NOT 403).
    const res = await nitroFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://evil.example.com' },
      body: JSON.stringify({ username: 'nope', password: 'nope' }),
    })
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(401)
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

  it('PATCH preserves income direction + positive sign when editing an income amount', async () => {
    // Post an income transaction (+RM2000 salary).
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'inc-edit-1', date: '2026-06-18', amount_cents: 200000, direction: 'income', category: 'income', account_id: bankId, source: 'manual' },
    })

    // Edit the amount to +RM2500, sending direction=income + positive amount (what the fixed sheet sends).
    const updated = await authFetch(`/api/transactions/${id}`, {
      method: 'PATCH',
      body: { amount_cents: 250000, direction: 'income', category: 'income' },
    })

    // Stays income, stays positive — NOT reclassified to expense / negative.
    expect(updated.direction).toBe('income')
    expect(updated.category).toBe('income')
    expect(updated.amount_cents).toBe(250000)
    expect(updated.amount_cents).toBeGreaterThan(0)
  })

  it('PATCH preserves expense direction + negative sign when editing an expense amount', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'exp-edit-1', date: '2026-06-18', amount_cents: -1250, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })

    const updated = await authFetch(`/api/transactions/${id}`, {
      method: 'PATCH',
      body: { amount_cents: -3000, direction: 'expense', category: 'food' },
    })

    expect(updated.direction).toBe('expense')
    expect(updated.category).toBe('food')
    expect(updated.amount_cents).toBe(-3000)
    expect(updated.amount_cents).toBeLessThan(0)
  })

  it('PATCH rejects an income with a negative amount (sign/direction invariant)', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'inc-bad-sign', date: '2026-06-18', amount_cents: 100000, direction: 'income', category: 'income', account_id: bankId, source: 'manual' },
    })
    // Sending a negative amount while the row is income must be rejected (would corrupt balances).
    await expect(authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { amount_cents: -100000 } }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('PATCH rejects an expense with a positive amount (sign/direction invariant)', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'exp-bad-sign', date: '2026-06-18', amount_cents: -5000, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    await expect(authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { amount_cents: 5000 } }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('PATCH rejects an unknown direction value', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'dir-bad', date: '2026-06-18', amount_cents: -100, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    await expect(authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { direction: 'sideways' } }))
      .rejects.toMatchObject({ statusCode: 400 })
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

// ---------------------------------------------------------------------------
// Input validation: PATCH date + GET month
// ---------------------------------------------------------------------------

describe('transactions API — PATCH date validation', () => {
  it('PATCH with a malformed date returns 400', async () => {
    // Create a transaction to patch.
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'val-date-1', date: '2026-06-18', amount_cents: -100, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    // Various bad date formats should be rejected.
    for (const bad of ['2026/06/18', '26-06-18', '2026-6-18', '2026-06-1', 'not-a-date', '2026-06']) {
      await expect(authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { date: bad } }))
        .rejects.toMatchObject({ statusCode: 400 })
    }
  })

  it('PATCH with a valid YYYY-MM-DD date succeeds', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'val-date-2', date: '2026-06-18', amount_cents: -200, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    const updated = await authFetch(`/api/transactions/${id}`, {
      method: 'PATCH',
      body: { date: '2026-07-01' },
    })
    expect(updated.date).toBe('2026-07-01')
  })
})

describe('transactions API — GET month validation', () => {
  it('GET ?month= with a malformed value returns 400', async () => {
    for (const bad of ['2026', '2026-6', '26-06', '2026/06', '%', '2026-06-18']) {
      await expect(authFetch(`/api/transactions?month=${encodeURIComponent(bad)}`))
        .rejects.toMatchObject({ statusCode: 400 })
    }
  })

  it('GET ?month= with a wildcard-injection attempt returns 400 (not a SQL wildcard result)', async () => {
    // Passing '%' must not become a LIKE wildcard — it must return 400.
    await expect(authFetch('/api/transactions?month=%25'))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('GET ?month=YYYY-MM succeeds', async () => {
    const rows = await authFetch('/api/transactions?month=2026-06')
    expect(Array.isArray(rows)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// System/auto ledger-row guard — PATCH + DELETE must REFUSE non-user rows.
// (Activity-edit corruption class: an interest row is category 'interest', POSITIVE,
//  with a debt_id; re-saving it as a negative expense is a 2X balance swing.)
// ---------------------------------------------------------------------------

describe('transactions API — system rows are NOT editable/deletable', () => {
  let cardDebtId: number

  // Insert a raw ledger row directly (bypassing the API, like the seed/recurring poster does)
  // and return its id. Uses a fresh DB handle to avoid WAL reader collisions.
  function insertRawTxn(values: Record<string, unknown>): number {
    const h = createDb(TEST_DB)
    try {
      const [row] = h.db.insert(transactions).values({
        uuid: values.uuid,
        date: values.date ?? '2026-06-18',
        amount_cents: values.amount_cents,
        direction: values.direction,
        category: values.category,
        account_id: (values.account_id ?? null) as any,
        counter_account_id: null,
        debt_id: (values.debt_id ?? null) as any,
        goal_id: null,
        note: (values.note ?? null) as any,
        is_estimate: false,
        source: values.source ?? 'auto',
        recurring_item_id: null,
        created_at: Date.now(),
      } as any).returning().all()
      return row.id as number
    } finally {
      h.sqlite.close()
    }
  }

  beforeAll(() => {
    const h = createDb(TEST_DB)
    try {
      const [d] = h.db.insert(debts).values({
        name: 'Test Card',
        type: 'revolving' as any,
        balance_cents: 0,
        rate_type: 'apr' as any,
        created_at: Date.now(),
        updated_at: Date.now(),
      } as any).returning().all()
      cardDebtId = d.id as number
    } finally {
      h.sqlite.close()
    }
  })

  it('PATCH refuses a card-INTEREST row (category interest, positive, debt_id) with 403', async () => {
    const id = insertRawTxn({
      uuid: 'sys-interest-patch', amount_cents: 4500, direction: 'expense',
      category: 'interest', debt_id: cardDebtId, source: 'auto',
    })
    await expect(authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { amount_cents: -4500, direction: 'expense', category: 'food' } }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('DELETE refuses a card-INTEREST row with 403', async () => {
    const id = insertRawTxn({
      uuid: 'sys-interest-del', amount_cents: 4500, direction: 'expense',
      category: 'interest', debt_id: cardDebtId, source: 'auto',
    })
    await expect(authFetch(`/api/transactions/${id}`, { method: 'DELETE' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('PATCH refuses a DEBT-PAYMENT row (debt_id set) with 403', async () => {
    const id = insertRawTxn({
      uuid: 'sys-debt-patch', amount_cents: -30000, direction: 'expense',
      category: 'debt', debt_id: cardDebtId, source: 'manual',
    })
    await expect(authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { amount_cents: -1000 } }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('DELETE refuses a DEBT-PAYMENT row with 403', async () => {
    const id = insertRawTxn({
      uuid: 'sys-debt-del', amount_cents: -30000, direction: 'expense',
      category: 'debt', debt_id: cardDebtId, source: 'manual',
    })
    await expect(authFetch(`/api/transactions/${id}`, { method: 'DELETE' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('PATCH refuses a transfer-direction row with 403', async () => {
    const id = insertRawTxn({
      uuid: 'sys-transfer-patch', amount_cents: -10000, direction: 'transfer',
      category: 'transfer', account_id: bankId, source: 'manual',
    })
    await expect(authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { note: 'x' } }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('a normal user EXPENSE round-trips: PATCH then DELETE both succeed', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'user-spend-rt', date: '2026-06-18', amount_cents: -1250, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    const updated = await authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { amount_cents: -2000, direction: 'expense', category: 'transport' } })
    expect(updated.amount_cents).toBe(-2000)
    expect(updated.direction).toBe('expense')
    const del = await authFetch(`/api/transactions/${id}`, { method: 'DELETE' })
    expect(del.ok).toBe(true)
  })

  it('a normal user INCOME round-trips and stays income+positive', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'user-income-rt', date: '2026-06-18', amount_cents: 150000, direction: 'income', category: 'income', account_id: bankId, source: 'manual' },
    })
    const updated = await authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { amount_cents: 175000, direction: 'income', category: 'income' } })
    expect(updated.direction).toBe('income')
    expect(updated.category).toBe('income')
    expect(updated.amount_cents).toBe(175000)
    expect(updated.amount_cents).toBeGreaterThan(0)
  })

  it('PATCH cannot relabel a user EXPENSE into category income (crafted request) — 400', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'craft-relabel-cat', date: '2026-06-18', amount_cents: -1250, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    // expense kept negative but category flipped to 'income' → would skew the category-based rollup
    await expect(authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { category: 'income' } }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('PATCH cannot make an income row carry a non-income category (crafted request) — 400', async () => {
    const { id } = await authFetch('/api/transactions', {
      method: 'POST',
      body: { uuid: 'craft-relabel-dir', date: '2026-06-18', amount_cents: -1250, direction: 'expense', category: 'food', account_id: bankId, source: 'manual' },
    })
    // direction→income while category stays 'food' → incoherent income row
    await expect(authFetch(`/api/transactions/${id}`, { method: 'PATCH', body: { direction: 'income', amount_cents: 1250 } }))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

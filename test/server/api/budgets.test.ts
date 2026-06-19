// test/server/api/budgets.test.ts
// E2E integration tests for the budgets API.
// Spins up the real Nitro server against a dedicated file-based SQLite DB.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { bootstrapUser } from '../../../scripts/seed-user'
import { accounts } from '../../../server/db/schema'

const TEST_DB = './data/budgets-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD = process.env.NUXT_SESSION_PASSWORD || 'budgets-test-password-32-chars!!'

let bankId: number
let handle: ReturnType<typeof createDb>
let sessionCookie: string

beforeAll(async () => {
  for (const ext of ['', '-shm', '-wal']) {
    const p = `${TEST_DB}${ext}`
    if (existsSync(p)) rmSync(p)
  }
  handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  await bootstrapUser(handle.db, 'budgetowner', 'budget-pass-123')
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
  nuxtConfig: { modules: [] },
})

async function getSessionCookie(): Promise<string> {
  if (sessionCookie) return sessionCookie
  const res = await nitroFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'budgetowner', password: 'budget-pass-123' }),
  })
  const setCookieHeader = res.headers.get('set-cookie') ?? ''
  sessionCookie = setCookieHeader.split(';')[0]
  return sessionCookie
}

async function authFetch(path: string, opts: Record<string, unknown> = {}): Promise<any> {
  const cookie = await getSessionCookie()
  return $fetch(path, { ...opts, headers: { ...((opts.headers as any) ?? {}), cookie } })
}

// ── Auth gating ────────────────────────────────────────────────────────────

describe('budgets API — auth gating', () => {
  it('GET /api/budgets → 401 without session', async () => {
    await expect($fetch('/api/budgets')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('PUT /api/budgets → 401 without session', async () => {
    await expect($fetch('/api/budgets', { method: 'PUT', body: { category: 'food', limit_cents: 10000 } }))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('DELETE /api/budgets/food → 401 without session', async () => {
    await expect($fetch('/api/budgets/food', { method: 'DELETE' }))
      .rejects.toMatchObject({ statusCode: 401 })
  })
})

// ── GET returns 7 rows, all null/0 on empty DB ─────────────────────────────

describe('budgets API — GET empty state', () => {
  it('returns array of 8 rows (all spend categories incl. car), all limit_cents: null, all spent_cents: 0', async () => {
    const rows = await authFetch('/api/budgets')
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBe(8)
    for (const r of rows) {
      expect(r.limit_cents).toBeNull()
      expect(r.spent_cents).toBe(0)
    }
    // 'car' category must appear as a budget row
    expect(rows.some((r: any) => r.category === 'car')).toBe(true)
  })
})

// ── PUT upsert ─────────────────────────────────────────────────────────────

describe('budgets API — PUT upsert', () => {
  it('PUT food 50000 → returns upserted row; GET shows food has limit_cents: 50000', async () => {
    const row = await authFetch('/api/budgets', {
      method: 'PUT',
      body: { category: 'food', limit_cents: 50000 },
    })
    expect(row.category).toBe('food')
    expect(row.limit_cents).toBe(50000)

    const rows = await authFetch('/api/budgets')
    const food = rows.find((r: any) => r.category === 'food')
    expect(food.limit_cents).toBe(50000)
  })

  it('PUT again for same category updates the limit (upsert)', async () => {
    await authFetch('/api/budgets', {
      method: 'PUT',
      body: { category: 'food', limit_cents: 75000 },
    })
    const rows = await authFetch('/api/budgets')
    const food = rows.find((r: any) => r.category === 'food')
    expect(food.limit_cents).toBe(75000)
  })
})

// ── spent_cents reflects actual transactions ───────────────────────────────

describe('budgets API — GET spent_cents', () => {
  it('reflects food expense transactions in current month', async () => {
    // Insert a food expense via the transactions API.
    // Use MYT (UTC+8) to match the production GET endpoint which uses todayMYT().slice(0,7).
    const mytDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()) // returns YYYY-MM-DD
    const [mytYear, mytMonth] = mytDate.split('-')
    const date = `${mytYear}-${mytMonth}-15`
    await authFetch('/api/transactions', {
      method: 'POST',
      body: {
        uuid: 'budget-spent-1',
        date,
        amount_cents: -12000,
        direction: 'expense',
        category: 'food',
        account_id: bankId,
        source: 'manual',
      },
    })
    const rows = await authFetch('/api/budgets')
    const food = rows.find((r: any) => r.category === 'food')
    expect(food.spent_cents).toBe(12000)
  })
})

// ── DELETE ─────────────────────────────────────────────────────────────────

describe('budgets API — DELETE', () => {
  it('DELETE /api/budgets/food → { ok: true }; GET shows food limit_cents: null', async () => {
    const res = await authFetch('/api/budgets/food', { method: 'DELETE' })
    expect(res.ok).toBe(true)

    const rows = await authFetch('/api/budgets')
    const food = rows.find((r: any) => r.category === 'food')
    expect(food.limit_cents).toBeNull()
  })

  it('DELETE is idempotent — deleting non-existent returns { ok: true }', async () => {
    const res = await authFetch('/api/budgets/transport', { method: 'DELETE' })
    expect(res.ok).toBe(true)
  })
})

// ── Validation ─────────────────────────────────────────────────────────────

describe('budgets API — validation', () => {
  it('PUT with unknown category → 400', async () => {
    await expect(authFetch('/api/budgets', {
      method: 'PUT',
      body: { category: 'invalid', limit_cents: 10000 },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('PUT with limit_cents: 0 → 400', async () => {
    await expect(authFetch('/api/budgets', {
      method: 'PUT',
      body: { category: 'food', limit_cents: 0 },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('PUT with limit_cents: -1 → 400', async () => {
    await expect(authFetch('/api/budgets', {
      method: 'PUT',
      body: { category: 'food', limit_cents: -1 },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('DELETE with invalid category → 400', async () => {
    await expect(authFetch('/api/budgets/notacategory', { method: 'DELETE' }))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

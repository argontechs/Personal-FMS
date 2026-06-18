// test/server/api/recurring.test.ts
// E2E integration tests for the recurring templates CRUD API.
// Spins up the real Nitro server against a dedicated file-based SQLite DB.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { bootstrapUser } from '../../../scripts/seed-user'
import { recurringItems } from '../../../server/db/schema'

const TEST_DB = './data/recurring-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD = process.env.NUXT_SESSION_PASSWORD || 'rec-test-password-32-chars!!!!'

// ---------------------------------------------------------------------------
// Setup: fresh DB, migrate, seed a user, start the Nuxt server
// ---------------------------------------------------------------------------

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
  await bootstrapUser(handle.db, 'recowner', 'rec-pass-123')
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
    body: JSON.stringify({ username: 'recowner', password: 'rec-pass-123' }),
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

describe('recurring API — auth gating', () => {
  it('POST /api/recurring → 401 without session', async () => {
    await expect($fetch('/api/recurring', { method: 'POST', body: {} }))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('GET /api/recurring → 401 without session', async () => {
    await expect($fetch('/api/recurring')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('PATCH /api/recurring/1 → 401 without session', async () => {
    await expect($fetch('/api/recurring/1', { method: 'PATCH', body: { name: 'x' } }))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('DELETE /api/recurring/1 → 401 without session', async () => {
    await expect($fetch('/api/recurring/1', { method: 'DELETE' }))
      .rejects.toMatchObject({ statusCode: 401 })
  })
})

// ---------------------------------------------------------------------------
// POST — creates a template and computes next_due_date from day_of_month
// ---------------------------------------------------------------------------

describe('recurring API — POST creates template', () => {
  it('POST creates a template and computes next_due_date from day_of_month', async () => {
    const row = await authFetch('/api/recurring', {
      method: 'POST',
      body: {
        name: 'Unifi',
        direction: 'expense',
        amount_cents: 15000,
        cadence: 'monthly',
        day_of_month: 19,
        category: 'bills',
        auto_post: true,
        start_date: '2026-06-01',
      },
    })
    expect(row.id).toBeTypeOf('number')
    // next_due_date must end in -19 (computed from day_of_month)
    expect(row.next_due_date).toMatch(/^\d{4}-\d{2}-19$/)
  })

  it('POST returns 400 if name is missing', async () => {
    await expect(authFetch('/api/recurring', {
      method: 'POST',
      body: { direction: 'expense', amount_cents: 100, start_date: '2026-06-01' },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('POST returns 400 if amount_cents is not an integer', async () => {
    await expect(authFetch('/api/recurring', {
      method: 'POST',
      body: { name: 'Bad', direction: 'expense', amount_cents: 'not-a-number', start_date: '2026-06-01' },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('POST stores and round-trips remaining_installments_json', async () => {
    const installments = JSON.stringify([{ due: '2026-07-01', amount_cents: 5000 }, { due: '2026-08-01', amount_cents: 5000 }])
    const row = await authFetch('/api/recurring', {
      method: 'POST',
      body: {
        name: 'SPayLater',
        direction: 'expense',
        amount_cents: 5000,
        cadence: 'monthly',
        day_of_month: 1,
        category: 'bills',
        start_date: '2026-06-01',
        remaining_installments_json: installments,
      },
    })
    expect(row.id).toBeTypeOf('number')
    expect(row.remaining_installments_json).toBe(installments)
  })
})

// ---------------------------------------------------------------------------
// GET — returns active templates ordered by next_due_date
// ---------------------------------------------------------------------------

describe('recurring API — GET returns active templates', () => {
  it('GET returns active templates ordered by next_due_date', async () => {
    await authFetch('/api/recurring', {
      method: 'POST',
      body: { name: 'Subs', direction: 'expense', amount_cents: 8200, day_of_month: 5, category: 'bills', start_date: '2026-06-01' },
    })
    const rows = await authFetch('/api/recurring')
    expect(Array.isArray(rows)).toBe(true)
    const dates = rows.map((r: any) => r.next_due_date).filter(Boolean)
    const sorted = [...dates].sort()
    expect(dates).toEqual(sorted)
    expect(rows.every((r: any) => r.is_active)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PATCH — edits and recomputes next_due_date when day_of_month changes
// ---------------------------------------------------------------------------

describe('recurring API — PATCH edits template', () => {
  it('PATCH day_of_month recomputes next_due_date', async () => {
    const created = await authFetch('/api/recurring', {
      method: 'POST',
      body: { name: 'Digi', direction: 'expense', amount_cents: 37860, day_of_month: 16, category: 'bills', start_date: '2026-06-01' },
    })
    const updated = await authFetch(`/api/recurring/${created.id}`, {
      method: 'PATCH',
      body: { day_of_month: 20 },
    })
    expect(updated.day_of_month).toBe(20)
    expect(updated.next_due_date).toMatch(/^\d{4}-\d{2}-20$/)
  })

  it('PATCH name without day_of_month does NOT change next_due_date', async () => {
    const created = await authFetch('/api/recurring', {
      method: 'POST',
      body: { name: 'Netflix', direction: 'expense', amount_cents: 5500, day_of_month: 10, category: 'bills', start_date: '2026-06-01' },
    })
    const originalNextDue = created.next_due_date
    const updated = await authFetch(`/api/recurring/${created.id}`, {
      method: 'PATCH',
      body: { name: 'Netflix Premium' },
    })
    expect(updated.name).toBe('Netflix Premium')
    expect(updated.next_due_date).toBe(originalNextDue)
  })

  it('PATCH returns 404 for non-existent id', async () => {
    await expect(authFetch('/api/recurring/999999', { method: 'PATCH', body: { name: 'x' } }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('PATCH round-trips remaining_installments_json', async () => {
    const created = await authFetch('/api/recurring', {
      method: 'POST',
      body: { name: 'Installment', direction: 'expense', amount_cents: 3000, day_of_month: 15, category: 'debt', start_date: '2026-06-01' },
    })
    const newJson = JSON.stringify([{ due: '2026-09-15', amount_cents: 3000 }])
    const updated = await authFetch(`/api/recurring/${created.id}`, {
      method: 'PATCH',
      body: { remaining_installments_json: newJson },
    })
    expect(updated.remaining_installments_json).toBe(newJson)
  })
})

// ---------------------------------------------------------------------------
// DELETE — soft-deletes (is_active=false)
// ---------------------------------------------------------------------------

describe('recurring API — DELETE soft-deletes', () => {
  it('DELETE soft-deletes (is_active=false), GET no longer returns it', async () => {
    const created = await authFetch('/api/recurring', {
      method: 'POST',
      body: { name: 'Gym', direction: 'expense', amount_cents: 19900, day_of_month: 1, category: 'bills', start_date: '2026-06-01' },
    })
    const res = await authFetch(`/api/recurring/${created.id}`, { method: 'DELETE' })
    expect(res.ok).toBe(true)
    const rows = await authFetch('/api/recurring')
    expect((rows as any[]).some((r: any) => r.id === created.id)).toBe(false)
  })
})

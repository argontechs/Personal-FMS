// test/server/api/holdings.test.ts
// E2E integration tests for the holdings API.
// Spins up the real Nitro server against a dedicated file-based SQLite DB.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { bootstrapUser } from '../../../scripts/seed-user'
import { seedDatabase } from '../../../server/db/seed'

const TEST_DB = './data/holdings-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD = process.env.NUXT_SESSION_PASSWORD || 'holdings-test-password-32chars!!'

let sessionCookie: string

beforeAll(async () => {
  for (const ext of ['', '-shm', '-wal']) {
    const p = `${TEST_DB}${ext}`
    if (existsSync(p)) rmSync(p)
  }
  const handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  await bootstrapUser(handle.db, 'holdingsowner', 'holdings-pass-123')
  seedDatabase(handle.db)
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
    body: JSON.stringify({ username: 'holdingsowner', password: 'holdings-pass-123' }),
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

describe('holdings API — auth gating', () => {
  it('GET /api/holdings → 401 without session', async () => {
    await expect($fetch('/api/holdings')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('POST /api/holdings → 401 without session', async () => {
    await expect($fetch('/api/holdings', {
      method: 'POST',
      body: { name: 'Test', institution: 'X', kind: 'savings', current_value_cents: 1000 },
    })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('PATCH /api/holdings/1 → 401 without session', async () => {
    await expect($fetch('/api/holdings/1', {
      method: 'PATCH',
      body: { current_value_cents: 5000 },
    })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('DELETE /api/holdings/1 → 401 without session', async () => {
    await expect($fetch('/api/holdings/1', { method: 'DELETE' }))
      .rejects.toMatchObject({ statusCode: 401 })
  })
})

// ── GET all 7 seeded holdings ──────────────────────────────────────────────

describe('holdings API — GET seeded data', () => {
  it('returns all 7 seeded holdings', async () => {
    const rows = await authFetch('/api/holdings')
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBe(7)
  })

  it('returns holdings ordered by current_value_cents DESC', async () => {
    const rows = await authFetch('/api/holdings')
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i].current_value_cents).toBeGreaterThanOrEqual(rows[i + 1].current_value_cents)
    }
  })

  it('seed total equals 14,364,997 sen', async () => {
    const rows = await authFetch('/api/holdings')
    const total = rows.reduce((sum: number, r: any) => sum + r.current_value_cents, 0)
    expect(total).toBe(14_364_997)
  })

  it('contains AIA Assurance Account with correct value', async () => {
    const rows = await authFetch('/api/holdings')
    const row = rows.find((r: any) => r.name === 'AIA Assurance Account')
    expect(row).toBeDefined()
    expect(row.current_value_cents).toBe(6_352_297)
    expect(row.institution).toBe('AIA')
    expect(row.kind).toBe('investment')
    expect(row.liquid).toBe(1)
  })

  it('contains GE Critical Illness (insurance, illiquid)', async () => {
    const rows = await authFetch('/api/holdings')
    const row = rows.find((r: any) => r.name === 'GE Critical Illness')
    expect(row).toBeDefined()
    expect(row.institution).toBe('Great Eastern')
    expect(row.kind).toBe('insurance')
    expect(row.liquid).toBe(0)
    expect(row.current_value_cents).toBe(142_626)
  })
})

// ── POST validation ────────────────────────────────────────────────────────

describe('holdings API — POST validation', () => {
  it('rejects empty name', async () => {
    await expect(authFetch('/api/holdings', {
      method: 'POST',
      body: { name: '', institution: 'Bank', kind: 'savings', current_value_cents: 1000 },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects invalid kind', async () => {
    await expect(authFetch('/api/holdings', {
      method: 'POST',
      body: { name: 'Test', institution: 'Bank', kind: 'crypto', current_value_cents: 1000 },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects zero current_value_cents', async () => {
    await expect(authFetch('/api/holdings', {
      method: 'POST',
      body: { name: 'Test', institution: 'Bank', kind: 'savings', current_value_cents: 0 },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects negative current_value_cents', async () => {
    await expect(authFetch('/api/holdings', {
      method: 'POST',
      body: { name: 'Test', institution: 'Bank', kind: 'savings', current_value_cents: -500 },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects missing name field', async () => {
    await expect(authFetch('/api/holdings', {
      method: 'POST',
      body: { institution: 'Bank', kind: 'savings', current_value_cents: 1000 },
    })).rejects.toMatchObject({ statusCode: 400 })
  })
})

// ── POST create ────────────────────────────────────────────────────────────

describe('holdings API — POST create', () => {
  it('creates a new holding and returns it', async () => {
    const row = await authFetch('/api/holdings', {
      method: 'POST',
      body: {
        name: 'Test EPF',
        institution: 'KWSP',
        kind: 'savings',
        current_value_cents: 999_900,
        liquid: 0,
        note: 'EPF account',
      },
    })
    expect(row.id).toBeDefined()
    expect(row.name).toBe('Test EPF')
    expect(row.institution).toBe('KWSP')
    expect(row.kind).toBe('savings')
    expect(row.current_value_cents).toBe(999_900)
    expect(row.liquid).toBe(0)
    expect(row.note).toBe('EPF account')
  })

  it('GET after POST returns 8 holdings (7 seeded + 1 created)', async () => {
    const rows = await authFetch('/api/holdings')
    expect(rows.length).toBe(8)
  })
})

// ── PATCH update ───────────────────────────────────────────────────────────

describe('holdings API — PATCH update', () => {
  it('updates current_value_cents and bumps updated_at', async () => {
    // Find ASN Sara 1 (smallest value, sort_order 1)
    const rows = await authFetch('/api/holdings')
    const asnSara = rows.find((r: any) => r.name === 'ASN Sara 1')
    expect(asnSara).toBeDefined()

    const originalUpdatedAt = asnSara.updated_at
    // Small sleep to ensure updated_at differs
    await new Promise(r => setTimeout(r, 5))

    const updated = await authFetch(`/api/holdings/${asnSara.id}`, {
      method: 'PATCH',
      body: { current_value_cents: 3000 },
    })
    expect(updated.current_value_cents).toBe(3000)
    expect(updated.updated_at).toBeGreaterThan(originalUpdatedAt)
  })

  it('returns 404 for non-existent id', async () => {
    await expect(authFetch('/api/holdings/999999', {
      method: 'PATCH',
      body: { current_value_cents: 1000 },
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects invalid kind in PATCH', async () => {
    const rows = await authFetch('/api/holdings')
    const id = rows[0].id
    await expect(authFetch(`/api/holdings/${id}`, {
      method: 'PATCH',
      body: { kind: 'bonds' },
    })).rejects.toMatchObject({ statusCode: 400 })
  })
})

// ── DELETE ─────────────────────────────────────────────────────────────────

describe('holdings API — DELETE', () => {
  it('deletes a holding and returns { ok: true }', async () => {
    // Create a throwaway holding first
    const created = await authFetch('/api/holdings', {
      method: 'POST',
      body: { name: 'To Delete', institution: 'X', kind: 'insurance', current_value_cents: 100 },
    })
    expect(created.id).toBeDefined()

    const res = await authFetch(`/api/holdings/${created.id}`, { method: 'DELETE' })
    expect(res.ok).toBe(true)

    // Verify it's gone
    const rows = await authFetch('/api/holdings')
    expect(rows.find((r: any) => r.id === created.id)).toBeUndefined()
  })

  it('returns 404 when deleting non-existent id', async () => {
    await expect(authFetch('/api/holdings/999999', { method: 'DELETE' }))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})

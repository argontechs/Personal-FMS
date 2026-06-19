// test/server/api/money-moves.test.ts
// E2E integration tests for the money-moves API (§11/§15 advisory levers).
// Spins up the real Nitro server against a dedicated file-based SQLite DB.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { bootstrapUser } from '../../../scripts/seed-user'
import { seedDatabase } from '../../../server/db/seed'
import { debts } from '../../../server/db/schema'

const TEST_DB = './data/money-moves-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD = process.env.NUXT_SESSION_PASSWORD || 'moneymoves-test-password-32chars!'

let sessionCookie: string

beforeAll(async () => {
  for (const ext of ['', '-shm', '-wal']) {
    const p = `${TEST_DB}${ext}`
    if (existsSync(p)) rmSync(p)
  }
  const handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  await bootstrapUser(handle.db, 'movesowner', 'moves-pass-123')
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
    body: JSON.stringify({ username: 'movesowner', password: 'moves-pass-123' }),
  })
  const setCookieHeader = res.headers.get('set-cookie') ?? ''
  sessionCookie = setCookieHeader.split(';')[0]
  return sessionCookie
}

async function authFetch(path: string, opts: Record<string, unknown> = {}): Promise<any> {
  const cookie = await getSessionCookie()
  return $fetch(path, { ...opts, headers: { ...((opts.headers as any) ?? {}), cookie } })
}

// ── Auth gating ──────────────────────────────────────────────────────────────
describe('money-moves API — auth gating', () => {
  it('GET /api/money-moves → 401 without session', async () => {
    await expect($fetch('/api/money-moves')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('PATCH /api/money-moves/:key → 401 without session', async () => {
    await expect($fetch('/api/money-moves/pause-ge-ilp', {
      method: 'PATCH',
      body: { status: 'done' },
    })).rejects.toMatchObject({ statusCode: 401 })
  })
})

// ── GET derivation (card balance > 0, qualifying liquid holding present) ──────
describe('money-moves API — GET derivation', () => {
  it('derives both moves with status todo by default', async () => {
    const moves = await authFetch('/api/money-moves')
    expect(Array.isArray(moves)).toBe(true)
    const keys = moves.map((m: any) => m.key).sort()
    expect(keys).toEqual(['clear-card-with-aia', 'pause-ge-ilp'])
    for (const m of moves) expect(m.status).toBe('todo')
  })

  it("clear-card-with-aia suggested amount equals the card balance (740,076 sen)", async () => {
    const moves = await authFetch('/api/money-moves')
    const aia = moves.find((m: any) => m.key === 'clear-card-with-aia')
    expect(aia).toBeDefined()
    expect(aia.suggestedAmountCents).toBe(740076)
    expect(aia.explanation).toContain('AIA Assurance Account')
    expect(aia.explanation).toContain('guaranteed ~18% return')
    expect(aia.explanation).toContain('RM7,400.76')
  })

  it('pause-ge-ilp is a confirm-action with the GE copy', async () => {
    const moves = await authFetch('/api/money-moves')
    const ge = moves.find((m: any) => m.key === 'pause-ge-ilp')
    expect(ge).toBeDefined()
    expect(ge.kind).toBe('confirm')
    expect(ge.suggestedAmountCents).toBeNull()
    expect(ge.explanation).toContain('Great Eastern ILP')
    expect(ge.explanation).toContain('RM350/mo')
  })

  it('GET is read-only — repeated calls do not create state rows', async () => {
    await authFetch('/api/money-moves')
    await authFetch('/api/money-moves')
    const moves = await authFetch('/api/money-moves?all=1')
    // statuses still todo (nothing persisted by GET)
    for (const m of moves) expect(m.status).toBe('todo')
  })

  it('hides clear-card-with-aia when the card balance is 0', async () => {
    // Zero out the card balance directly, then GET should drop the AIA move.
    const handle = createDb(TEST_DB)
    handle.db.update(debts).set({ balance_cents: 0 }).where(eq(debts.type, 'revolving')).run()
    handle.sqlite.close()

    const moves = await authFetch('/api/money-moves')
    const keys = moves.map((m: any) => m.key)
    expect(keys).not.toContain('clear-card-with-aia')
    expect(keys).toContain('pause-ge-ilp') // GE confirm move still present

    // Restore the balance for the remaining tests.
    const h2 = createDb(TEST_DB)
    h2.db.update(debts).set({ balance_cents: 740076 }).where(eq(debts.type, 'revolving')).run()
    h2.sqlite.close()
  })
})

// ── PATCH persistence ─────────────────────────────────────────────────────────
describe('money-moves API — PATCH', () => {
  it('rejects an unknown move key', async () => {
    await expect(authFetch('/api/money-moves/not-a-real-move', {
      method: 'PATCH',
      body: { status: 'done' },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects an invalid status', async () => {
    await expect(authFetch('/api/money-moves/pause-ge-ilp', {
      method: 'PATCH',
      body: { status: 'banana' },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('sets status=done and GET reflects it', async () => {
    const res = await authFetch('/api/money-moves/clear-card-with-aia', {
      method: 'PATCH',
      body: { status: 'done' },
    })
    expect(res).toMatchObject({ key: 'clear-card-with-aia', status: 'done' })

    const moves = await authFetch('/api/money-moves')
    const aia = moves.find((m: any) => m.key === 'clear-card-with-aia')
    expect(aia.status).toBe('done')
  })

  it('upsert: a second PATCH overwrites the prior status (todo again)', async () => {
    await authFetch('/api/money-moves/clear-card-with-aia', { method: 'PATCH', body: { status: 'todo' } })
    const moves = await authFetch('/api/money-moves')
    const aia = moves.find((m: any) => m.key === 'clear-card-with-aia')
    expect(aia.status).toBe('todo')
  })

  it('dismissed moves are hidden by default but visible with ?all=1', async () => {
    await authFetch('/api/money-moves/pause-ge-ilp', { method: 'PATCH', body: { status: 'dismissed' } })

    const visible = await authFetch('/api/money-moves')
    expect(visible.find((m: any) => m.key === 'pause-ge-ilp')).toBeUndefined()

    const all = await authFetch('/api/money-moves?all=1')
    const ge = all.find((m: any) => m.key === 'pause-ge-ilp')
    expect(ge).toBeDefined()
    expect(ge.status).toBe('dismissed')
  })
})

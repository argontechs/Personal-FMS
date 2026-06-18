// test/server/api/push/subscribe.e2e.test.ts
// E2E integration tests for POST /api/push/subscribe and POST /api/push/unsubscribe.
// Tests: unauth → 401; valid subscription stored; upsert on same endpoint; invalid shape → 400.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../../server/db/index'
import { runMigrations } from '../../../../server/db/migrate'
import { bootstrapUser } from '../../../../scripts/seed-user'
import { pushSubscriptions } from '../../../../server/db/schema'
import { eq } from 'drizzle-orm'

const TEST_DB = './data/push-sub-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD = process.env.NUXT_SESSION_PASSWORD || 'push-sub-test-password-32-chars!'

let handle: ReturnType<typeof createDb>
let sessionCookie: string

beforeAll(async () => {
  for (const ext of ['', '-shm', '-wal']) {
    const p = `${TEST_DB}${ext}`
    if (existsSync(p)) rmSync(p)
  }
  handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  await bootstrapUser(handle.db, 'pushowner', 'push-pass-123')
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
    body: JSON.stringify({ username: 'pushowner', password: 'push-pass-123' }),
  })
  const setCookieHeader = res.headers.get('set-cookie') ?? ''
  sessionCookie = setCookieHeader.split(';')[0]
  return sessionCookie
}

async function authFetch(path: string, opts: Record<string, unknown> = {}): Promise<any> {
  const cookie = await getSessionCookie()
  return $fetch(path, { ...opts, headers: { ...((opts.headers as any) ?? {}), cookie } })
}

// ---------------------------------------------------------------------------
// Auth gating — 401 without session
// ---------------------------------------------------------------------------

describe('POST /api/push/subscribe — auth gate', () => {
  it('rejects unauthenticated subscribe with 401', async () => {
    await expect(
      $fetch('/api/push/subscribe', {
        method: 'POST',
        body: { endpoint: 'https://push/x', keys: { p256dh: 'a', auth: 'b' } },
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects unauthenticated unsubscribe with 401', async () => {
    await expect(
      $fetch('/api/push/unsubscribe', {
        method: 'POST',
        body: { endpoint: 'https://push/x' },
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})

// ---------------------------------------------------------------------------
// Valid subscribe — stores the row
// ---------------------------------------------------------------------------

describe('POST /api/push/subscribe — stores row', () => {
  it('returns an id for a valid subscription', async () => {
    const result = await authFetch('/api/push/subscribe', {
      method: 'POST',
      body: { endpoint: 'https://push/valid-1', keys: { p256dh: 'abc', auth: 'xyz' } },
    })
    expect(typeof result.id).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// Upsert — re-subscribe same endpoint updates, no duplicate row
// ---------------------------------------------------------------------------

describe('POST /api/push/subscribe — upsert on same endpoint', () => {
  it('re-subscribing same endpoint returns same id and only one row exists', async () => {
    const ep = 'https://push/upsert-1'
    const first = await authFetch('/api/push/subscribe', {
      method: 'POST',
      body: { endpoint: ep, keys: { p256dh: 'p1', auth: 'a1' } },
    })
    const second = await authFetch('/api/push/subscribe', {
      method: 'POST',
      body: { endpoint: ep, keys: { p256dh: 'p2', auth: 'a2' } },
    })

    expect(first.id).toBe(second.id)

    // Verify in DB: only one row for this endpoint.
    const check = createDb(TEST_DB)
    try {
      const rows = check.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, ep)).all()
      expect(rows.length).toBe(1)
      // The updated keys should be the latest ones.
      expect(rows[0].p256dh).toBe('p2')
      expect(rows[0].auth).toBe('a2')
    } finally {
      check.sqlite.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Invalid shape — 400
// ---------------------------------------------------------------------------

describe('POST /api/push/subscribe — invalid shape', () => {
  it('missing endpoint → 400', async () => {
    await expect(
      authFetch('/api/push/subscribe', {
        method: 'POST',
        body: { keys: { p256dh: 'a', auth: 'b' } },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('missing keys.p256dh → 400', async () => {
    await expect(
      authFetch('/api/push/subscribe', {
        method: 'POST',
        body: { endpoint: 'https://push/bad', keys: { auth: 'b' } },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('missing keys.auth → 400', async () => {
    await expect(
      authFetch('/api/push/subscribe', {
        method: 'POST',
        body: { endpoint: 'https://push/bad2', keys: { p256dh: 'a' } },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('non-URL endpoint → 400', async () => {
    await expect(
      authFetch('/api/push/subscribe', {
        method: 'POST',
        body: { endpoint: 'not-a-url', keys: { p256dh: 'a', auth: 'b' } },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

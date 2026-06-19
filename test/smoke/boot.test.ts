// test/smoke/boot.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { rmSync, existsSync } from 'node:fs'
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../server/db/index'
import { runMigrations } from '../../server/db/migrate'
import { seedDatabase } from '../../server/db/seed'
import { bootstrapUser } from '../../scripts/seed-user'

// Prepare a real test DB the booted server will open (DATABASE_URL points here).
const TEST_DB = './data/smoke.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
// NUXT_SESSION_PASSWORD must be present so the spawned Nitro server can seal/verify cookies.
process.env.NUXT_SESSION_PASSWORD = process.env.NUXT_SESSION_PASSWORD || 'smoke-test-password-32-chars!!!!'

beforeAll(async () => {
  // Always start from a clean slate — delete any file from a prior run.
  for (const ext of ['', '-shm', '-wal']) {
    const p = `${TEST_DB}${ext}`
    if (existsSync(p)) rmSync(p)
  }
  const handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  seedDatabase(handle.db)
  await bootstrapUser(handle.db, 'owner', 'smoke-pass-123')
  // Verify all 11 tables exist post-migrate+seed.
  const tables = handle.sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`)
    .all() as { name: string }[]
  expect(tables).toHaveLength(11)
  handle.sqlite.close()
})

await setup({
  server: true,
  browser: false,
  env: {
    DATABASE_URL: `file:${TEST_DB}`,
    NUXT_SESSION_PASSWORD: process.env.NUXT_SESSION_PASSWORD,
  },
  nuxtConfig: {
    // Disable the PWA module in tests — app/sw.ts is not built for the API smoke harness.
    modules: [],
  },
})

describe('boot + migrate + seed + protected route', () => {
  it('rejects the protected route without a session (401)', async () => {
    await expect($fetch('/api/accounts')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('logs in, sets a cookie, and reads the seeded accounts through the guard', async () => {
    // Use native fetch (returns a Response) so we can read set-cookie headers.
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'smoke-pass-123' }),
    })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('money_session=')
    const cookie = setCookie.split(';')[0]

    const accounts = await $fetch('/api/accounts', { headers: { cookie } })
    expect(Array.isArray(accounts)).toBe(true)
    expect(accounts).toHaveLength(7)
    expect((accounts as any[]).some((a) => a.type === 'savings')).toBe(true)
  })
})

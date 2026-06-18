import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from '../server/db/index'
import { runMigrations } from '../server/db/migrate'
import { users } from '../server/db/schema'
import { verifyPassword } from '../server/utils/password'
import { bootstrapUser } from './seed-user'

describe('bootstrapUser', () => {
  let handle: ReturnType<typeof createDb>
  beforeEach(() => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
  })
  afterEach(() => handle.sqlite.close())

  it('creates the single user with an argon2id hash', async () => {
    const { id, created } = await bootstrapUser(handle.db, 'owner', 'a-strong-pass')
    expect(created).toBe(true)
    expect(id).toBeGreaterThan(0)
    const row = handle.db.select().from(users).all()[0]
    expect(row.username).toBe('owner')
    expect(await verifyPassword(row.password_hash, 'a-strong-pass')).toBe(true)
  })

  it('refuses to create a second user (single-user app)', async () => {
    await bootstrapUser(handle.db, 'owner', 'pass1')
    const second = await bootstrapUser(handle.db, 'intruder', 'pass2')
    expect(second.created).toBe(false)
    expect(handle.db.select().from(users).all()).toHaveLength(1)
  })
})

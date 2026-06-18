// server/utils/session.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb } from '../db/index'
import { runMigrations } from '../db/migrate'
import { users } from '../db/schema'
import { createSession, resolveSession, revokeSession } from './session'

describe('session lifecycle', () => {
  let handle: ReturnType<typeof createDb>
  let userId: number
  beforeEach(() => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
    userId = handle.db.insert(users).values({
      username: 'owner', password_hash: 'x', session_epoch: 0, created_at: 0, updated_at: 0,
    }).returning({ id: users.id }).get().id
  })
  afterEach(() => handle.sqlite.close())

  it('creates an opaque session id and resolves it', () => {
    const { id } = createSession(handle.db, userId, 0)
    expect(id).toMatch(/^[a-f0-9]{64}$/)
    const s = resolveSession(handle.db, id)
    expect(s?.user_id).toBe(userId)
  })

  it('returns null for an unknown id', () => {
    expect(resolveSession(handle.db, 'nope')).toBeNull()
  })

  it('revokes a session', () => {
    const { id } = createSession(handle.db, userId, 0)
    revokeSession(handle.db, id)
    expect(resolveSession(handle.db, id)).toBeNull()
  })

  it('invalidates when the user session_epoch is bumped', () => {
    const { id } = createSession(handle.db, userId, 0)
    handle.db.update(users).set({ session_epoch: 1 }).where(eq(users.id, userId)).run()
    expect(resolveSession(handle.db, id)).toBeNull()
  })

  it('returns null for an expired session', () => {
    const { id } = createSession(handle.db, userId, 0)
    // force-expire
    handle.sqlite.prepare('UPDATE sessions SET expires_at = 1 WHERE id = ?').run(id)
    expect(resolveSession(handle.db, id)).toBeNull()
  })
})

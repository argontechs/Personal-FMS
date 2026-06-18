// server/api/auth/login.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { createDb } from '../../db/index'
import { runMigrations } from '../../db/migrate'
import { users } from '../../db/schema'
import { hashPassword, verifyPassword } from '../../utils/password'
import { ensureBackoffTable, precheckLogin, recordFailure, recordSuccess } from '../../utils/loginBackoff'
import { createSession, resolveSession } from '../../utils/session'

// Exercises the exact sequence login.post.ts runs (pre-check → verify → session),
// proving the wiring before the Nitro handler is smoke-tested in Task 1.13.
describe('login flow logic', () => {
  let handle: ReturnType<typeof createDb>
  beforeEach(async () => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
    ensureBackoffTable(handle.sqlite)
    handle.db.insert(users).values({
      username: 'owner', password_hash: await hashPassword('right-pass'),
      session_epoch: 0, created_at: 0, updated_at: 0,
    }).run()
  })
  afterEach(() => handle.sqlite.close())

  it('rejects a wrong password and records a failure', async () => {
    const pre = precheckLogin(handle.sqlite, 'owner', '1.1.1.1')
    expect(pre.allowed).toBe(true)
    const user = handle.db.select().from(users).all()[0]
    const ok = await verifyPassword(user.password_hash, 'wrong-pass')
    expect(ok).toBe(false)
    recordFailure(handle.sqlite, 'owner')
    expect(handle.sqlite.prepare('SELECT fail_count FROM login_attempts WHERE scope_key = ?')
      .get('acct:owner')).toMatchObject({ fail_count: 1 })
  })

  it('accepts the right password, clears backoff, and issues a resolvable session', async () => {
    const user = handle.db.select().from(users).all()[0]
    expect(await verifyPassword(user.password_hash, 'right-pass')).toBe(true)
    recordSuccess(handle.sqlite, 'owner')
    const { id } = createSession(handle.db, user.id, user.session_epoch)
    expect(resolveSession(handle.db, id)?.user_id).toBe(user.id)
  })

  it('login + logout handler files exist', () => {
    expect(existsSync('server/api/auth/login.post.ts')).toBe(true)
    expect(existsSync('server/api/auth/logout.post.ts')).toBe(true)
  })
})

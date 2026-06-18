// server/utils/session.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb } from '../db/index'
import { runMigrations } from '../db/migrate'
import { users } from '../db/schema'
import {
  createSession,
  resolveSession,
  revokeSession,
  sealSessionId,
  unsealSessionId,
  computeHmac,
} from './session'

// ---------------------------------------------------------------------------
// Mock useRuntimeConfig (Nitro auto-import) so we can test without a running server
// ---------------------------------------------------------------------------
vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({ sessionPassword: process.env.NUXT_SESSION_PASSWORD ?? '' }),
}))

const TEST_PASSWORD = 'test-secret-password-32-chars!!'

// ---------------------------------------------------------------------------
// HMAC sealing / unsealing (no DB needed)
// ---------------------------------------------------------------------------
describe('HMAC cookie sealing', () => {
  it('sealSessionId produces <id>.<sig> format', () => {
    const id = 'abc123'
    const sealed = sealSessionId(id, TEST_PASSWORD)
    expect(sealed).toMatch(/^abc123\.[A-Za-z0-9_-]+$/)
  })

  it('valid round-trip: seal then unseal returns original id', () => {
    const id = 'a'.repeat(64)
    const sealed = sealSessionId(id, TEST_PASSWORD)
    const recovered = unsealSessionId(sealed, TEST_PASSWORD)
    expect(recovered).toBe(id)
  })

  it('tampered id returns null', () => {
    const id = 'original-id'
    const sealed = sealSessionId(id, TEST_PASSWORD)
    // Replace the id part with a different id
    const sig = sealed.slice(sealed.lastIndexOf('.'))
    const tampered = `tampered-id${sig}`
    expect(unsealSessionId(tampered, TEST_PASSWORD)).toBeNull()
  })

  it('tampered sig returns null', () => {
    const id = 'original-id'
    const sealed = sealSessionId(id, TEST_PASSWORD)
    // Flip one character in the signature
    const dotIdx = sealed.lastIndexOf('.')
    const idPart = sealed.slice(0, dotIdx)
    const sig = sealed.slice(dotIdx + 1)
    const badSig = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')
    const tampered = `${idPart}.${badSig}`
    expect(unsealSessionId(tampered, TEST_PASSWORD)).toBeNull()
  })

  it('bare id (no dot) returns null', () => {
    expect(unsealSessionId('nodotinhere', TEST_PASSWORD)).toBeNull()
  })

  it('empty cookie value returns null', () => {
    expect(unsealSessionId('', TEST_PASSWORD)).toBeNull()
  })

  it('empty password returns null from unsealSessionId', () => {
    const sealed = sealSessionId('some-id', TEST_PASSWORD)
    expect(unsealSessionId(sealed, '')).toBeNull()
  })

  it('empty password throws from sealSessionId', () => {
    expect(() => sealSessionId('some-id', '')).toThrow(/sessionPassword is empty/)
  })

  it('different password returns null', () => {
    const id = 'my-session-id'
    const sealed = sealSessionId(id, TEST_PASSWORD)
    expect(unsealSessionId(sealed, 'wrong-password-totally-different!')).toBeNull()
  })

  it('sig length mismatch returns null', () => {
    const id = 'my-id'
    // Construct a cookie with a short sig
    const fakeSealed = `${id}.shortsig`
    expect(unsealSessionId(fakeSealed, TEST_PASSWORD)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Session lifecycle (DB-backed)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Full round-trip: seal id → store in DB → unseal → resolveSession
// ---------------------------------------------------------------------------
describe('sealed id + DB round-trip', () => {
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

  it('sealed cookie value → unseal → resolveSession succeeds', () => {
    const { id } = createSession(handle.db, userId, 0)
    const sealed = sealSessionId(id, TEST_PASSWORD)

    // Simulates what readSessionId does
    const recovered = unsealSessionId(sealed, TEST_PASSWORD)
    expect(recovered).toBe(id)

    // DB row is still authoritative
    const session = resolveSession(handle.db, recovered!)
    expect(session).not.toBeNull()
    expect(session!.user_id).toBe(userId)
  })

  it('tampered sealed value does not resolve to a session', () => {
    const { id } = createSession(handle.db, userId, 0)
    const sealed = sealSessionId(id, TEST_PASSWORD)

    // Tamper: flip last char of sig
    const badSealed = sealed.slice(0, -1) + (sealed.endsWith('A') ? 'B' : 'A')
    const recovered = unsealSessionId(badSealed, TEST_PASSWORD)
    expect(recovered).toBeNull()
  })

  it('valid seal but non-existent session id resolves to null (row authoritative)', () => {
    // Seal a random id that was never inserted
    const fakeId = 'deadbeef'.repeat(8)
    const sealed = sealSessionId(fakeId, TEST_PASSWORD)
    const recovered = unsealSessionId(sealed, TEST_PASSWORD)
    expect(recovered).toBe(fakeId)

    // Even though seal is valid, the DB has no row → null
    expect(resolveSession(handle.db, recovered!)).toBeNull()
  })
})

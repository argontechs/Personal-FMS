// server/api/auth/login.post.ts
import { eq } from 'drizzle-orm'
import { db, sqlite } from '../../db/index'
import { users } from '../../db/schema'
import { hashPassword, verifyPassword } from '../../utils/password'
import {
  ensureBackoffTable, precheckLogin, recordFailure, recordSuccess,
} from '../../utils/loginBackoff'
import { createSession, setSessionCookie } from '../../utils/session'

ensureBackoffTable(sqlite)

// Lazily-cached dummy hash for constant-time missing-user path.
// Computed once via hashPassword so argon2id runs at full cost (prevents timing enumeration).
let dummyHashPromise: Promise<string> | null = null
function getDummyHash(): Promise<string> {
  return (dummyHashPromise ??= hashPassword('invalid-placeholder'))
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: string; password?: string }>(event)
  const username = (body?.username ?? '').trim()
  const password = body?.password ?? ''
  // Per-IP backoff key MUST use the real socket peer, not X-Forwarded-For.
  // getRequestIP({ xForwardedFor: true }) trusts the client-supplied XFF header, so an attacker
  // can rotate it on every request and bypass the per-IP cap entirely. Behind the trusted proxy
  // (nginx) the socket peer is the only value the client cannot forge. We pin to it; the per-IP
  // cap is a coarse DoS guard, the per-account lock (recordFailure) is the real credential defence.
  const ip = event.node.req.socket?.remoteAddress ?? 'unknown'

  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing credentials' })
  }

  // Cheap pre-check BEFORE argon2 (prevents memory-DoS on the fork).
  const pre = precheckLogin(sqlite, username, ip)
  if (!pre.allowed) {
    setResponseHeader(event, 'Retry-After', Math.ceil(pre.retryAfterMs / 1000))
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts' })
  }

  const user = db.select().from(users).where(eq(users.username, username)).get()
  // Always run a full argon2id verify to prevent username enumeration via timing.
  // On the missing-user path, verify against the dummy hash and discard the result.
  const ok = user
    ? await verifyPassword(user.password_hash, password)
    : (await verifyPassword(await getDummyHash(), password), false)
  if (!user || !ok) {
    recordFailure(sqlite, username)
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  }

  recordSuccess(sqlite, username)
  const { id, expiresAt } = createSession(db, user.id, user.session_epoch)
  setSessionCookie(event, id, expiresAt)
  return { ok: true }
})

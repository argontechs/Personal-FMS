// server/api/auth/login.post.ts
import { eq } from 'drizzle-orm'
import { db, sqlite } from '../../db/index'
import { users } from '../../db/schema'
import { verifyPassword } from '../../utils/password'
import {
  ensureBackoffTable, precheckLogin, recordFailure, recordSuccess,
} from '../../utils/loginBackoff'
import { createSession, setSessionCookie } from '../../utils/session'

ensureBackoffTable(sqlite)

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: string; password?: string }>(event)
  const username = (body?.username ?? '').trim()
  const password = body?.password ?? ''
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'

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
  const ok = user ? await verifyPassword(user.password_hash, password) : false
  if (!user || !ok) {
    recordFailure(sqlite, username)
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  }

  recordSuccess(sqlite, username)
  const { id, expiresAt } = createSession(db, user.id, user.session_epoch)
  setSessionCookie(event, id, expiresAt)
  return { ok: true }
})

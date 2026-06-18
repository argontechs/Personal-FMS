// server/utils/session.ts
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { setCookie, deleteCookie } from 'h3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { sessions, users } from '../db/schema'
import { nowEpoch } from './mytDate'

const IS_PROD = process.env.NODE_ENV === 'production'

export const SESSION_COOKIE = 'money_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export type Session = {
  id: string
  user_id: number
  session_epoch: number
  created_at: number
  expires_at: number
  last_seen_at: number
}

type Db = BetterSQLite3Database<Record<string, unknown>>

export function createSession(db: Db, userId: number, epoch: number): { id: string; expiresAt: number } {
  const id = randomBytes(32).toString('hex')
  const now = nowEpoch()
  const expiresAt = now + SESSION_TTL_MS
  db.insert(sessions).values({
    id,
    user_id: userId,
    session_epoch: epoch,
    created_at: now,
    expires_at: expiresAt,
    last_seen_at: now,
  }).run()
  return { id, expiresAt }
}

export function resolveSession(db: Db, id: string): Session | null {
  if (!id) return null
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get()
  if (!row) return null
  const now = nowEpoch()
  if (row.expires_at <= now) return null
  // Epoch check — bulk invalidation when the user's session_epoch advances.
  const user = db.select().from(users).where(eq(users.id, row.user_id)).get()
  if (!user || user.session_epoch !== row.session_epoch) return null
  // Slide the rolling window + record activity.
  db.update(sessions)
    .set({ last_seen_at: now, expires_at: now + SESSION_TTL_MS })
    .where(eq(sessions.id, id))
    .run()
  return { ...row, last_seen_at: now, expires_at: now + SESSION_TTL_MS } as Session
}

export function revokeSession(db: Db, id: string): void {
  db.delete(sessions).where(eq(sessions.id, id)).run()
}

/**
 * Set the session cookie on the H3 response with hardened attributes (§14).
 * httpOnly + secure + sameSite=lax are ALWAYS set.
 * domain is only applied in production to avoid browser ignoring localhost cookies.
 */
export function setSessionCookie(event: H3Event, id: string, expiresAt: number): void {
  setCookie(event, SESSION_COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    ...(IS_PROD ? { domain: 'money.argontechs.dev' } : {}),
    expires: new Date(expiresAt),
  })
}

/**
 * Clear the session cookie on logout / revoke.
 */
export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    ...(IS_PROD ? { domain: 'money.argontechs.dev' } : {}),
  })
}

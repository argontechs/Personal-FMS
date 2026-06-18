// server/utils/session.ts
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { setCookie, deleteCookie, getCookie } from 'h3'
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

// ---------------------------------------------------------------------------
// HMAC cookie-sealing — exported for unit tests
// ---------------------------------------------------------------------------

/** Compute HMAC-SHA256 of `id` keyed by `password`, returned as base64url. */
export function computeHmac(id: string, password: string): string {
  return createHmac('sha256', password).update(id).digest('base64url')
}

/**
 * Produce the sealed cookie value `"<id>.<sig>"`.
 * Throws if `password` is empty.
 */
export function sealSessionId(id: string, password: string): string {
  if (!password) {
    throw new Error(
      '[session] sessionPassword is empty. ' +
      'Set NUXT_SESSION_PASSWORD in your environment (min 32 chars recommended).'
    )
  }
  return `${id}.${computeHmac(id, password)}`
}

/**
 * Verify a sealed cookie value and return the raw session id, or null.
 * Returns null on any failure: missing, malformed, tampered sig, or empty password.
 */
export function unsealSessionId(sealed: string, password: string): string | null {
  if (!password) return null
  if (!sealed) return null

  const dotIndex = sealed.lastIndexOf('.')
  if (dotIndex === -1) return null // bare id — no signature

  const id = sealed.slice(0, dotIndex)
  const sig = sealed.slice(dotIndex + 1)
  if (!id || !sig) return null

  const expected = computeHmac(id, password)
  // Guard against length mismatch before constant-time compare.
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  return id
}

// ---------------------------------------------------------------------------
// Nitro request-context helpers (useRuntimeConfig is auto-imported by Nitro)
// ---------------------------------------------------------------------------

function requireSessionPassword(): string {
  const cfg = useRuntimeConfig()
  const pw: string = (cfg as Record<string, string>).sessionPassword ?? ''
  if (!pw) {
    throw new Error(
      '[session] sessionPassword is empty. ' +
      'Set NUXT_SESSION_PASSWORD in your environment (min 32 chars recommended).'
    )
  }
  return pw
}

/**
 * Read the session cookie, verify its HMAC seal, and return the raw session id.
 * Returns null on any failure (missing, malformed, tampered, empty password).
 */
export function readSessionId(event: H3Event): string | null {
  const raw = getCookie(event, SESSION_COOKIE)
  if (!raw) return null
  let password: string
  try {
    password = requireSessionPassword()
  } catch {
    return null
  }
  return unsealSessionId(raw, password)
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Set the session cookie on the H3 response with hardened attributes (§14).
 * httpOnly + secure + sameSite=lax are ALWAYS set.
 * domain is only applied in production to avoid browser ignoring localhost cookies.
 * The cookie value is HMAC-sealed: "<id>.<base64url-sig>".
 */
export function setSessionCookie(event: H3Event, id: string, expiresAt: number): void {
  const sealed = sealSessionId(id, requireSessionPassword())
  setCookie(event, SESSION_COOKIE, sealed, {
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

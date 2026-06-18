// server/utils/loginBackoff.ts
import type BetterSqlite3 from 'better-sqlite3'
import { nowEpoch } from './mytDate'

const IP_CAP = 10
const IP_WINDOW_MS = 15 * 60 * 1000
const LOCK_AFTER = 3
const MAX_LOCK_MS = 5 * 60 * 1000

export function ensureBackoffTable(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS login_attempts (
    scope_key TEXT PRIMARY KEY,
    fail_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    ip_count INTEGER NOT NULL DEFAULT 0,
    ip_window_start INTEGER NOT NULL DEFAULT 0
  )`)
}

function row(sqlite: BetterSqlite3.Database, key: string) {
  return sqlite.prepare('SELECT * FROM login_attempts WHERE scope_key = ?').get(key) as
    | { scope_key: string; fail_count: number; locked_until: number; ip_count: number; ip_window_start: number }
    | undefined
}

export function precheckLogin(
  sqlite: BetterSqlite3.Database, account: string, ip: string,
): { allowed: boolean; retryAfterMs: number } {
  const now = nowEpoch()

  // Per-account lock check (cheap — runs before argon2).
  const acct = row(sqlite, `acct:${account}`)
  if (acct && acct.locked_until > now) {
    return { allowed: false, retryAfterMs: acct.locked_until - now }
  }

  // Per-IP rolling cap.
  const ipKey = `ip:${ip}`
  const ipRow = row(sqlite, ipKey)
  let count = ipRow?.ip_count ?? 0
  let windowStart = ipRow?.ip_window_start ?? now
  if (now - windowStart > IP_WINDOW_MS) { count = 0; windowStart = now }
  count += 1
  sqlite.prepare(
    `INSERT INTO login_attempts (scope_key, ip_count, ip_window_start) VALUES (?,?,?)
     ON CONFLICT(scope_key) DO UPDATE SET ip_count = excluded.ip_count, ip_window_start = excluded.ip_window_start`,
  ).run(ipKey, count, windowStart)
  if (count > IP_CAP) return { allowed: false, retryAfterMs: windowStart + IP_WINDOW_MS - now }

  return { allowed: true, retryAfterMs: 0 }
}

export function recordFailure(sqlite: BetterSqlite3.Database, account: string): void {
  const now = nowEpoch()
  const key = `acct:${account}`
  const acct = row(sqlite, key)
  const fails = (acct?.fail_count ?? 0) + 1
  const lockedUntil = fails >= LOCK_AFTER ? now + Math.min(2 ** fails * 1000, MAX_LOCK_MS) : 0
  sqlite.prepare(
    `INSERT INTO login_attempts (scope_key, fail_count, locked_until) VALUES (?,?,?)
     ON CONFLICT(scope_key) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until`,
  ).run(key, fails, lockedUntil)
}

export function recordSuccess(sqlite: BetterSqlite3.Database, account: string): void {
  sqlite.prepare('DELETE FROM login_attempts WHERE scope_key = ?').run(`acct:${account}`)
}

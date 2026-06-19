// server/middleware/csrf.ts
// Same-origin (CSRF) guard for state-changing API requests (§14 security band).
//
// sameSite=lax on the session cookie blocks top-level cross-site form POSTs, but it does
// NOT cover same-site subdomain attacks nor every cross-origin fetch shape. This middleware
// adds a defence-in-depth Origin/Referer check.
//
// Policy (state-changing methods POST/PATCH/PUT/DELETE on /api/**):
//   - A PRESENT Origin header whose host != the app origin  → 403.
//   - No Origin? fall back to a PRESENT Referer host        → 403 if cross-origin.
//   - A MISSING Origin AND MISSING Referer                  → ALLOWED. Server-side / same-origin
//     fetch and the test harness send no Origin; we must never block those (the whole API test
//     suite issues no-Origin requests).
//   - Same-origin (host matches)                            → ALLOWED.
//
// Exemptions: /api/internal/** (loopback watchdog — already loopback+secret gated) and
// /api/auth/login (the login POST can legitimately arrive before any same-origin context is
// established, and is independently rate-limited per-IP + per-account).

import { defineEventHandler, getMethod, getRequestHeader, createError } from 'h3'

const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

// Canonical production app origin (matches the session cookie domain in server/utils/session.ts).
const PROD_HOST = 'fms.argontechs.dev'

/**
 * Extract the lowercased host[:port] from an Origin or Referer URL string.
 *   - undefined input (header absent)            → null
 *   - present but unparseable (e.g. "null", "x") → '' (a sentinel that never matches any host,
 *                                                  so a present-but-opaque origin is treated as
 *                                                  cross-origin and blocked, not silently allowed)
 */
function hostOf(value: string | undefined): string | null {
  if (value === undefined) return null
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return ''
  }
}

/** True when `originHost` is an acceptable same-origin host for this request. */
function isAllowedHost(originHost: string, requestHost: string | null): boolean {
  if (originHost === PROD_HOST) return true
  // Same-origin: the Origin host equals the request's own Host header (covers dev localhost,
  // the 127.0.0.1:<port> test harness, and any deployment host without hard-coding it).
  if (requestHost && originHost === requestHost.toLowerCase()) return true
  return false
}

export default defineEventHandler((event) => {
  const path = event.path || ''
  if (!path.startsWith('/api/')) return

  const method = getMethod(event).toUpperCase()
  if (!STATE_CHANGING.has(method)) return

  // Exemptions.
  if (path.startsWith('/api/internal/')) return
  // Match /api/auth/login exactly (ignore any trailing query string).
  if (path === '/api/auth/login' || path.startsWith('/api/auth/login?')) return

  const requestHost = getRequestHeader(event, 'host') ?? null

  // Prefer Origin; fall back to Referer. Only a PRESENT, cross-origin value is blocked.
  const originHost = hostOf(getRequestHeader(event, 'origin'))
  if (originHost !== null) {
    if (!isAllowedHost(originHost, requestHost)) {
      throw createError({ statusCode: 403, statusMessage: 'cross-origin request blocked' })
    }
    return
  }

  const refererHost = hostOf(getRequestHeader(event, 'referer'))
  if (refererHost !== null) {
    if (!isAllowedHost(refererHost, requestHost)) {
      throw createError({ statusCode: 403, statusMessage: 'cross-origin request blocked' })
    }
    return
  }

  // No Origin and no Referer → server-side / same-origin / test harness → allow.
})

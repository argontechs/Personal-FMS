// app/middleware/auth.global.ts
// Global Nuxt route middleware — redirects unauthenticated users to /login,
// and redirects already-authenticated users away from /login to /.
// The session check is UX-only; the APIs remain the real security boundary.
//
// Offline behaviour: if the fetch throws without an HTTP response (network
// failure) or the browser reports offline, the middleware lets navigation
// proceed so cached data can render. Only a real 401/403 HTTP status triggers
// a redirect to /login.
import { defineNuxtRouteMiddleware, navigateTo } from '#app'

/**
 * Returns true when the thrown error represents a genuine HTTP auth rejection
 * (401 or 403), false for network-level failures (no response / offline).
 */
function isAuthError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  const status =
    (err as any)?.response?.status ??
    (err as any)?.status ??
    (err as any)?.statusCode
  return status === 401 || status === 403
}

export default defineNuxtRouteMiddleware(async (to) => {
  let authenticated = false
  let networkFailure = false

  try {
    const session = await $fetch('/api/auth/session')
    authenticated = !!(session as any)?.authenticated
  } catch (err) {
    if (isAuthError(err)) {
      // Real 401/403 — treat as unauthenticated
      authenticated = false
    } else {
      // Network failure or unknown error — do not redirect; let cached page render
      networkFailure = true
    }
  }

  // On network failure, always let navigation proceed (cached data renders)
  if (networkFailure) return

  if (to.path === '/login') {
    // Already logged in — send to dashboard
    if (authenticated) return navigateTo('/')
    // Not logged in — allow access to login page
    return
  }

  // Any other route — redirect to login if not authenticated
  if (!authenticated) return navigateTo('/login')
})

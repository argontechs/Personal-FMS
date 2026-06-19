// app/middleware/auth.global.ts
// Global Nuxt route middleware — redirects unauthenticated users to /login,
// and redirects already-authenticated users away from /login to /.
// The session check is UX-only; the APIs remain the real security boundary.
import { defineNuxtRouteMiddleware, navigateTo } from '#app'

export default defineNuxtRouteMiddleware(async (to) => {
  let authenticated = false
  try {
    const session = await $fetch('/api/auth/session')
    authenticated = !!(session as any)?.authenticated
  } catch {
    authenticated = false
  }

  if (to.path === '/login') {
    // Already logged in — send to dashboard
    if (authenticated) return navigateTo('/')
    // Not logged in — allow access to login page
    return
  }

  // Any other route — redirect to login if not authenticated
  if (!authenticated) return navigateTo('/login')
})

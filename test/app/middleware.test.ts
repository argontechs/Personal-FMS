// test/app/middleware.test.ts
// Tests the auth.global middleware function directly.
// The middleware is imported after mocking #app so defineNuxtRouteMiddleware
// acts as a pass-through and $fetch is stubbed on the global.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── #app mock ────────────────────────────────────────────────────────────────
// vi.mock is hoisted, so we can't reference variables declared here inside the factory.
// Use vi.fn() directly and retrieve it via the imported module reference after import.
vi.mock('#app', () => ({
  useFetch: vi.fn(async () => ({ data: { value: null }, refresh: vi.fn() })),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  // Pass-through so the default export IS the inner function
  defineNuxtRouteMiddleware: vi.fn((fn: any) => fn),
}))

// Import AFTER mocks (Vitest hoists vi.mock)
import authMiddleware from '../../app/middleware/auth.global'
import * as nuxtApp from '#app'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeRoute(path: string) {
  return { path, name: path === '/' ? 'index' : path.slice(1), params: {}, query: {}, hash: '' }
}

function makeFetchError(status: number) {
  const err: any = new Error('Unauthorized')
  err.response = { status }
  err.status = status
  err.statusCode = status
  return err
}

function makeNetworkError() {
  // Simulates a network failure: no .response, no .status, no .statusCode
  return new Error('Network request failed')
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('$fetch', vi.fn())
  // Default to online; individual tests can override via vi.stubGlobal('navigator', ...)
  vi.stubGlobal('navigator', { onLine: true })
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('auth.global middleware', () => {
  it('unauthenticated user going to "/" is redirected to /login', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(makeFetchError(401)))
    await (authMiddleware as any)(makeRoute('/'), makeRoute('/'))
    expect(nuxtApp.navigateTo).toHaveBeenCalledWith('/login')
  })

  it('authenticated user going to "/" is allowed (no redirect)', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ authenticated: true, username: 'admin' }))
    await (authMiddleware as any)(makeRoute('/'), makeRoute('/'))
    expect(nuxtApp.navigateTo).not.toHaveBeenCalled()
  })

  it('authenticated user going to /login is redirected to /', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ authenticated: true, username: 'admin' }))
    await (authMiddleware as any)(makeRoute('/login'), makeRoute('/'))
    expect(nuxtApp.navigateTo).toHaveBeenCalledWith('/')
  })

  it('unauthenticated user going to /login is allowed (no redirect)', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(makeFetchError(401)))
    await (authMiddleware as any)(makeRoute('/login'), makeRoute('/'))
    expect(nuxtApp.navigateTo).not.toHaveBeenCalled()
  })

  it('real 403 → redirects to /login', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(makeFetchError(403)))
    await (authMiddleware as any)(makeRoute('/dashboard'), makeRoute('/'))
    expect(nuxtApp.navigateTo).toHaveBeenCalledWith('/login')
  })

  it('network error (no HTTP response) → does NOT redirect, lets navigation proceed', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(makeNetworkError()))
    await (authMiddleware as any)(makeRoute('/'), makeRoute('/'))
    expect(nuxtApp.navigateTo).not.toHaveBeenCalled()
  })

  it('navigator.onLine === false → does NOT redirect, lets navigation proceed', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    // Even a 401-shaped error is ignored when offline (network layer can produce these)
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(makeFetchError(401)))
    await (authMiddleware as any)(makeRoute('/'), makeRoute('/'))
    expect(nuxtApp.navigateTo).not.toHaveBeenCalled()
  })
})

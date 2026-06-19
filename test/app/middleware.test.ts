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

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('$fetch', vi.fn())
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
})

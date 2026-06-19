// server/middleware/csrf.test.ts
// Unit tests for the same-origin (CSRF) guard middleware.
// Builds real H3 events from minimal req/res shapes and asserts the guard's accept/reject policy.
import { describe, it, expect } from 'vitest'
import { createEvent } from 'h3'
import csrf from './csrf'

// Build a real H3 event from a method/path/headers triple so getMethod/getRequestHeader/event.path
// behave exactly as they do under Nitro.
function makeEvent(opts: {
  method?: string
  path?: string
  headers?: Record<string, string>
}) {
  const req: any = {
    method: opts.method ?? 'POST',
    url: opts.path ?? '/api/transactions',
    headers: opts.headers ?? {},
    socket: {},
  }
  const res: any = { setHeader() {}, getHeader() {}, end() {}, headersSent: false }
  return createEvent(req, res)
}

// The middleware returns undefined when it allows the request, and throws a 403 H3Error when it blocks.
function run(opts: Parameters<typeof makeEvent>[0]) {
  return (csrf as any)(makeEvent(opts))
}

const APP_HOST = 'localhost:3000'

describe('csrf middleware — blocks cross-origin state-changing requests', () => {
  it('blocks a POST with a cross-origin Origin (403)', () => {
    expect(() =>
      run({ method: 'POST', path: '/api/transactions', headers: { host: APP_HOST, origin: 'https://evil.example.com' } }),
    ).toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('blocks a cross-origin Referer when Origin is absent (403)', () => {
    expect(() =>
      run({ method: 'POST', path: '/api/transactions', headers: { host: APP_HOST, referer: 'https://evil.example.com/x' } }),
    ).toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('blocks PATCH/PUT/DELETE cross-origin too', () => {
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      expect(() =>
        run({ method, path: '/api/transactions/1', headers: { host: APP_HOST, origin: 'https://evil.example.com' } }),
      ).toThrow(expect.objectContaining({ statusCode: 403 }))
    }
  })
})

describe('csrf middleware — allows same-origin and the no-Origin (test harness / server-side) case', () => {
  it('allows a same-origin POST (Origin host == request Host)', () => {
    expect(
      run({ method: 'POST', path: '/api/transactions', headers: { host: APP_HOST, origin: 'http://localhost:3000' } }),
    ).toBeUndefined()
  })

  it('allows the canonical production origin', () => {
    expect(
      run({
        method: 'POST',
        path: '/api/transactions',
        headers: { host: 'fms.argontechs.dev', origin: 'https://fms.argontechs.dev' },
      }),
    ).toBeUndefined()
  })

  it('CRITICAL: allows a request with NO Origin and NO Referer (test harness / same-origin fetch)', () => {
    expect(run({ method: 'POST', path: '/api/transactions', headers: { host: APP_HOST } })).toBeUndefined()
  })

  it('allows a same-origin Referer when Origin is absent', () => {
    expect(
      run({ method: 'POST', path: '/api/transactions', headers: { host: APP_HOST, referer: 'http://localhost:3000/log' } }),
    ).toBeUndefined()
  })
})

describe('csrf middleware — exemptions', () => {
  it('exempts /api/internal/** even with a cross-origin Origin', () => {
    expect(
      run({ method: 'POST', path: '/api/internal/run-due', headers: { host: APP_HOST, origin: 'https://evil.example.com' } }),
    ).toBeUndefined()
  })

  it('exempts /api/auth/login even with a cross-origin Origin', () => {
    expect(
      run({ method: 'POST', path: '/api/auth/login', headers: { host: APP_HOST, origin: 'https://evil.example.com' } }),
    ).toBeUndefined()
  })

  it('exempts /api/auth/login with a trailing query string', () => {
    expect(
      run({ method: 'POST', path: '/api/auth/login?x=1', headers: { host: APP_HOST, origin: 'https://evil.example.com' } }),
    ).toBeUndefined()
  })
})

describe('csrf middleware — scope', () => {
  it('ignores non-/api paths', () => {
    expect(
      run({ method: 'POST', path: '/log', headers: { host: APP_HOST, origin: 'https://evil.example.com' } }),
    ).toBeUndefined()
  })

  it('ignores safe methods (GET) even cross-origin', () => {
    expect(
      run({ method: 'GET', path: '/api/transactions', headers: { host: APP_HOST, origin: 'https://evil.example.com' } }),
    ).toBeUndefined()
  })

  it('a logout POST (not exempt) from a cross-origin is blocked', () => {
    expect(() =>
      run({ method: 'POST', path: '/api/auth/logout', headers: { host: APP_HOST, origin: 'https://evil.example.com' } }),
    ).toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('an unparseable Origin is treated as cross-origin and blocked', () => {
    expect(() =>
      run({ method: 'POST', path: '/api/transactions', headers: { host: APP_HOST, origin: 'not-a-url' } }),
    ).toThrow(expect.objectContaining({ statusCode: 403 }))
  })
})

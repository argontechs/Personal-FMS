// test/server/api/internal/run-due.test.ts
// TDD tests for the /api/internal/run-due watchdog endpoint.
// Tests unit functions from loopback.ts, plus handler behaviour via vitest mocks.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isLoopback, secretMatches } from '../../../../server/utils/loopback'

// ---------------------------------------------------------------------------
// Unit: loopback guard
// ---------------------------------------------------------------------------
describe('isLoopback', () => {
  it('accepts loopback addresses only', () => {
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('::1')).toBe(true)
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopback('203.0.113.7')).toBe(false)
    expect(isLoopback('10.0.0.1')).toBe(false)
    expect(isLoopback(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Unit: constant-time secret compare
// ---------------------------------------------------------------------------
describe('secretMatches', () => {
  it('is true only on exact match', () => {
    expect(secretMatches('s3cr3t', 's3cr3t')).toBe(true)
    expect(secretMatches('wrong', 's3cr3t')).toBe(false)
    expect(secretMatches(undefined, 's3cr3t')).toBe(false)
    expect(secretMatches('s3cr3t', '')).toBe(false) // empty expected never matches
  })

  it('rejects when lengths differ (constant-time length guard)', () => {
    expect(secretMatches('short', 'a-longer-secret-value')).toBe(false)
    expect(secretMatches('a-longer-secret-value', 'short')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Handler integration: mock dispatchRun + postRecurring, call handler directly
// ---------------------------------------------------------------------------

// Hoist mocks before any imports that read them.
vi.mock('../../../../server/utils/dispatchRun', () => ({
  runDispatch: vi.fn().mockResolvedValue({ sent: 2, skipped: 0 }),
}))
vi.mock('../../../../server/utils/postRecurring', () => ({
  runPostRecurring: vi.fn().mockReturnValue({ posted: 1, interest: 0 }),
}))
vi.mock('#imports', () => ({
  useRuntimeConfig: vi.fn(() => ({ runDueSecret: 'test-secret-abc123' })),
  defineEventHandler: (fn: Function) => fn,
  createError: ({ statusCode, statusMessage }: { statusCode: number; statusMessage: string }) => {
    const err = new Error(statusMessage) as any
    err.statusCode = statusCode
    return err
  },
  getHeader: vi.fn(),
}))

import { runDispatch } from '../../../../server/utils/dispatchRun'
import { runPostRecurring } from '../../../../server/utils/postRecurring'
import { useRuntimeConfig, getHeader } from '#imports'

// Lazy-import the handler after mocks are in place.
const loadHandler = async () => {
  const mod = await import('../../../../server/api/internal/run-due.post')
  return typeof mod.default === 'function' ? mod.default : (mod as any).default
}

function makeEvent(remoteAddress: string | undefined, secret: string | undefined) {
  // Minimal H3 event-shaped object for handler testing.
  ;(getHeader as any).mockReturnValue(secret)
  return {
    node: {
      req: {
        socket: { remoteAddress },
      },
    },
  }
}

describe('run-due handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to valid defaults.
    ;(useRuntimeConfig as any).mockReturnValue({ runDueSecret: 'test-secret-abc123' })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('rejects non-loopback IP with 403', async () => {
    const handler = await loadHandler()
    const event = makeEvent('203.0.113.7', 'test-secret-abc123')
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 })
    expect(runDispatch).not.toHaveBeenCalled()
    expect(runPostRecurring).not.toHaveBeenCalled()
  })

  it('rejects missing secret with 401', async () => {
    const handler = await loadHandler()
    const event = makeEvent('127.0.0.1', undefined)
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(runDispatch).not.toHaveBeenCalled()
  })

  it('rejects wrong secret with 401', async () => {
    const handler = await loadHandler()
    const event = makeEvent('127.0.0.1', 'wrong-secret')
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(runDispatch).not.toHaveBeenCalled()
  })

  it('rejects all when secret env is unset/empty — endpoint disabled', async () => {
    ;(useRuntimeConfig as any).mockReturnValue({ runDueSecret: '' })
    const handler = await loadHandler()
    // Even with correct secret, disabled when env is empty.
    const event = makeEvent('127.0.0.1', '')
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(runDispatch).not.toHaveBeenCalled()
  })

  it('runs both post-recurring and notify-dispatch on valid loopback + correct secret', async () => {
    const handler = await loadHandler()
    const event = makeEvent('127.0.0.1', 'test-secret-abc123')
    const result = await handler(event)
    expect(runPostRecurring).toHaveBeenCalledOnce()
    expect(runDispatch).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ postRecurring: { posted: 1, interest: 0 }, dispatch: { sent: 2, skipped: 0 } })
  })

  it('also accepts ::1 (IPv6 loopback)', async () => {
    const handler = await loadHandler()
    const event = makeEvent('::1', 'test-secret-abc123')
    const result = await handler(event)
    expect(runDispatch).toHaveBeenCalledOnce()
    expect(runPostRecurring).toHaveBeenCalledOnce()
    expect(result).toBeDefined()
  })

  it('also accepts ::ffff:127.0.0.1 (IPv4-mapped loopback)', async () => {
    const handler = await loadHandler()
    const event = makeEvent('::ffff:127.0.0.1', 'test-secret-abc123')
    const result = await handler(event)
    expect(runDispatch).toHaveBeenCalledOnce()
  })

  it('is idempotent: calling twice does not error (underlying tasks are idempotent)', async () => {
    const handler = await loadHandler()
    const event1 = makeEvent('127.0.0.1', 'test-secret-abc123')
    const event2 = makeEvent('127.0.0.1', 'test-secret-abc123')
    await handler(event1)
    await handler(event2)
    expect(runDispatch).toHaveBeenCalledTimes(2)
    expect(runPostRecurring).toHaveBeenCalledTimes(2)
  })
})

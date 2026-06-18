// server/api/__tests__/forecast.get.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock requireSession — default to authenticated; individual tests can override via vi.mocked().
const mockRequireSession = vi.fn(() => ({ id: 'sess-1', userId: 1 }))
vi.mock('../../utils/requireSession', () => ({
  requireSession: (...args: any[]) => mockRequireSession(...args),
}))

// Mock the ledger reads + db so the handler is exercised in isolation.
vi.mock('../../db', () => ({ db: {} }))
vi.mock('../../utils/forecastReads', () => ({
  cashNowCents: () => 80000,
  committedOutflowsBeforeCents: () => 20000,
  spentTodayVariableCents: () => 500,
  savingsTargetRemainingCents: () => 30000,
}))
vi.mock('../../utils/monthlyRollup', () => ({
  computeMonthlyRollup: () => ({
    incomeCents: 641950, livingCents: 183860, debtServiceCents: 90400,
    interestCents: 11101, rawSurplusCents: 367690, surplusAfterInterestCents: 356589,
  }),
}))
vi.mock('../../utils/deltaCash', () => ({
  deltaCashThisMonth: () => 12345,
}))

import handler from '../forecast.get'

function makeEvent(query: Record<string, string> = {}) {
  return { node: { req: {}, res: {} }, context: {}, _query: query } as any
}
// h3 getQuery reads from the URL; stub it via the event we pass.
vi.mock('h3', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return { ...actual, getQuery: (e: any) => e._query ?? {} }
})

describe('GET /api/forecast', () => {
  it('returns STS + rollup for the supplied MYT date', async () => {
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    // raw cycle = 80000 - 20000 - 30000 - 20000 = 10000; next inflow 23rd → 5 days
    expect(res.sts.cycleCents).toBe(10000)
    expect(res.sts.nextInflowISO).toBe('2026-06-23')
    expect(res.sts.daysToNextInflow).toBe(5)
    // daily = floor(10000/5) - 500 = 1500
    expect(res.sts.dailyCents).toBe(1500)
    expect(res.rollup.surplusAfterInterestCents).toBe(356589)
    expect(res.cashNowCents).toBe(80000)
    expect(res.todayISO).toBe('2026-06-18')
  })

  it('honors a caller-supplied savingsTargetRemaining override', async () => {
    const res = await handler(makeEvent({ today: '2026-06-18', savingsTargetRemaining: '0' }))
    // raw cycle = 80000 - 20000 - 0 - 20000 = 40000
    expect(res.sts.cycleCents).toBe(40000)
  })

  it('returns deltaCashThisMonthCents (not hardcoded 0) from deltaCash util', async () => {
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    // deltaCashThisMonth mock returns 12345 — must not be 0
    expect(res.deltaCashThisMonthCents).toBe(12345)
    expect(res.deltaCashThisMonthCents).not.toBe(0)
  })

  it('returns 401 when requireSession throws', () => {
    const { createError } = require('h3')
    mockRequireSession.mockImplementationOnce(() => {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    })
    // requireSession throws synchronously → the handler re-throws before returning a promise
    expect(() => handler(makeEvent({}))).toThrow(
      expect.objectContaining({ statusCode: 401 }),
    )
  })
})

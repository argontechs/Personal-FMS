// server/api/__tests__/trends.get.test.ts
// Unit tests for GET /api/trends: session gating + shape (snapshot series + spend-by-category).
import { describe, it, expect, vi } from 'vitest'

const mockRequireSession = vi.fn(() => ({ id: 's', userId: 1 }))
vi.mock('../../utils/requireSession', () => ({
  requireSession: (...args: any[]) => mockRequireSession(...args),
}))
vi.mock('../../db', () => ({ db: {} }))

// h3 getQuery reads from the URL; stub it to read the event we pass (_query).
vi.mock('h3', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return { ...actual, getQuery: (e: any) => e._query ?? {} }
})

// Controllable trendsReads: series + category breakdown returned verbatim.
const mockSeries = [
  { date: '2026-06-18', netWorthCents: 5800000, totalDebtCents: 870000, cardBalanceCents: 740076, efBalanceCents: 40000, liquidCents: 300000 },
  { date: '2026-06-19', netWorthCents: 5893020, totalDebtCents: 864277, cardBalanceCents: 740076, efBalanceCents: 45000, liquidCents: 305000 },
]
const mockCategories = [
  { category: 'food', amountCents: 45000 },
  { category: 'transport', amountCents: 18000 },
]
const mockSnapshotSeries = vi.fn(() => mockSeries)
const mockSpendByCategory = vi.fn(() => mockCategories)
const mockSpendSinceISO = vi.fn(() => '2026-03-01')
vi.mock('../../utils/trendsReads', () => ({
  snapshotSeries: (...args: any[]) => mockSnapshotSeries(...args),
  spendByCategory: (...args: any[]) => mockSpendByCategory(...args),
  spendSinceISO: (...args: any[]) => mockSpendSinceISO(...args),
}))

import handler from '../trends.get'

// Minimal H3 event whose query we can drive (getQuery is stubbed to read _query).
const makeEvent = (query: Record<string, string> = {}) =>
  ({ node: { req: {}, res: {} }, context: {}, _query: query } as any)

describe('GET /api/trends', () => {
  it('returns 401 when requireSession throws (gated)', async () => {
    const { createError } = await import('h3')
    mockRequireSession.mockImplementationOnce(() => {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    })
    expect(() => handler(makeEvent({ today: '2026-06-19' }))).toThrow(
      expect.objectContaining({ statusCode: 401 }),
    )
  })

  it('returns the snapshot series', () => {
    const res = handler(makeEvent({ today: '2026-06-19' }))
    expect(res.series).toHaveLength(2)
    expect(res.series[1].netWorthCents).toBe(5893020)
    expect(res.series[0].date).toBe('2026-06-18')
  })

  it('returns the spend-by-category breakdown', () => {
    const res = handler(makeEvent({ today: '2026-06-19' }))
    expect(res.spendByCategory).toHaveLength(2)
    expect(res.spendByCategory[0]).toEqual({ category: 'food', amountCents: 45000 })
  })

  it('echoes the window + today', () => {
    const res = handler(makeEvent({ today: '2026-06-19' }))
    expect(res.todayISO).toBe('2026-06-19')
    expect(res.windowDays).toBe(180)
    expect(res.windowMonths).toBe(4)
  })

  it('clamps a hostile days query into the bounded range', () => {
    const res = handler(makeEvent({ today: '2026-06-19', days: '999999' }))
    expect(res.windowDays).toBeLessThanOrEqual(3650)
  })

  it('clamps days to a minimum of 2', () => {
    const res = handler(makeEvent({ today: '2026-06-19', days: '1' }))
    expect(res.windowDays).toBeGreaterThanOrEqual(2)
  })
})

// server/api/__tests__/debt-plan.get.test.ts
import { describe, it, expect, vi } from 'vitest'

const mockRequireSession = vi.fn(() => ({ id: 's', userId: 1 }))
vi.mock('../../utils/requireSession', () => ({
  requireSession: (...args: any[]) => mockRequireSession(...args),
}))

vi.mock('h3', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return { ...actual, getQuery: (e: any) => e._query ?? {} }
})

// Controllable debt rows returned from the db chain.
let mockRows: any[] = []
vi.mock('../../db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ all: () => mockRows }),
        }),
      }),
    }),
  },
}))

// Monthly-extra source: surplus-after-interest, and EF allocation (debtReads.readEFBalance).
const mockSurplus = vi.fn(() => ({ surplusAfterInterestCents: 220000 } as any))
vi.mock('../../utils/monthlyRollup', () => ({
  computeMonthlyRollup: (...args: any[]) => mockSurplus(...args),
}))
const mockReadEFBalance = vi.fn(() => 100000) // default: EF funded → allocation 0
vi.mock('../../utils/debtReads', () => ({
  readEFBalance: (...args: any[]) => mockReadEFBalance(...args),
}))

import handler from '../debt-plan.get'
const makeEvent = (query: Record<string, string> = {}) => ({ _query: query } as any)

const SMALL_CARD = {
  id: 1, name: 'Card', type: 'revolving', balance_cents: 100000,
  rate_type: 'apr', apr_bps: 1800, flat_rate_bps: null,
  min_payment_cents: 5000, scheduled_payment_cents: null, priority_rank: 1,
}
const LOAN = {
  id: 2, name: 'Loan', type: 'installment', balance_cents: 200000,
  rate_type: 'none', apr_bps: null, flat_rate_bps: null,
  min_payment_cents: null, scheduled_payment_cents: 10000, priority_rank: 2,
}

describe('GET /api/debt-plan', () => {
  it('returns the projection shape (debtFreeDate, totalInterestCents, monthlyExtraCents, perDebt)', () => {
    mockRows = [SMALL_CARD, LOAN]
    const res = handler(makeEvent({ today: '2026-06-01' })) as any
    expect(typeof res.debtFreeDate === 'string' || res.debtFreeDate === null).toBe(true)
    expect(typeof res.totalInterestCents).toBe('number')
    expect(typeof res.monthlyExtraCents).toBe('number')
    expect(Array.isArray(res.perDebt)).toBe(true)
    expect(res.perDebt[0]).toMatchObject({ id: expect.any(Number), name: expect.any(String) })
    expect(res.perDebt[0]).toHaveProperty('payoffDate')
    expect(res.perDebt[0]).toHaveProperty('monthsToPayoff')
  })

  it('orders perDebt by avalanche payoff order (high-rate card first) and reports YYYY-MM dates', () => {
    mockRows = [LOAN, SMALL_CARD] // input order should not matter
    const res = handler(makeEvent({ today: '2026-06-01' })) as any
    expect(res.perDebt.map((p: any) => p.id)).toEqual([1, 2]) // card before loan
    expect(res.debtFreeDate).toMatch(/^\d{4}-\d{2}$/)
    expect(res.perDebt[0].payoffDate).toMatch(/^\d{4}-\d{2}$/)
    expect(res.neverClears).toBe(false)
  })

  it('derives monthlyExtraCents from forecast surplus-to-debt (EF funded → no allocation)', () => {
    mockRows = [SMALL_CARD, LOAN]
    mockReadEFBalance.mockReturnValueOnce(100000) // ≥ EF_STARTER_TARGET → allocation 0
    const res = handler(makeEvent({ today: '2026-06-01' })) as any
    expect(res.monthlyExtraCents).toBe(220000) // full surplus to debt
  })

  it('reduces monthlyExtraCents by the EF allocation while the starter buffer is unfunded', () => {
    mockRows = [SMALL_CARD, LOAN]
    mockReadEFBalance.mockReturnValueOnce(0) // < EF_STARTER_TARGET → allocation = 3×16667 = 50001
    const res = handler(makeEvent({ today: '2026-06-01' })) as any
    expect(res.monthlyExtraCents).toBe(220000 - 50001)
  })

  it('clamps monthlyExtraCents to >= 0 even when the EF allocation exceeds the surplus', () => {
    mockRows = [SMALL_CARD]
    mockSurplus.mockReturnValueOnce({ surplusAfterInterestCents: 10000 } as any)
    mockReadEFBalance.mockReturnValueOnce(0) // allocation 50001 > 10000 surplus
    const res = handler(makeEvent({ today: '2026-06-01' })) as any
    expect(res.monthlyExtraCents).toBe(0)
    expect(res.monthlyExtraCents).toBeGreaterThanOrEqual(0)
  })

  it('honest never-clears state: null date + neverClears flag + positive shortfall', () => {
    mockRows = [{ ...SMALL_CARD, balance_cents: 740076 }]
    mockSurplus.mockReturnValueOnce({ surplusAfterInterestCents: 5000 } as any) // tiny extra
    mockReadEFBalance.mockReturnValueOnce(100000) // allocation 0; extra = 5000 < interest
    const res = handler(makeEvent({ today: '2026-06-01' })) as any
    expect(res.debtFreeDate).toBeNull()
    expect(res.neverClears).toBe(true)
    expect(res.shortfallCents).toBeGreaterThan(0)
  })

  it('returns 401 when requireSession throws', async () => {
    const { createError } = await import('h3')
    mockRequireSession.mockImplementationOnce(() => {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    })
    expect(() => handler(makeEvent({}))).toThrow(
      expect.objectContaining({ statusCode: 401 }),
    )
  })
})

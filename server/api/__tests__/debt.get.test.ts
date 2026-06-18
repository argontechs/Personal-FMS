// server/api/__tests__/debt.get.test.ts
import { describe, it, expect, vi } from 'vitest'

const mockRequireSession = vi.fn(() => ({ id: 's', userId: 1 }))
vi.mock('../../utils/requireSession', () => ({
  requireSession: (...args: any[]) => mockRequireSession(...args),
}))
vi.mock('../../db', () => ({ db: {} }))
vi.mock('h3', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return { ...actual, getQuery: (e: any) => e._query ?? {} }
})

// The card debt + card account read is wrapped in a helper so we mock that helper.
const mockReadCard = vi.fn(() => ({
  debt: { balance_cents: 740076, apr_bps: 1800, bt_status: 'none' as const, payoff_baseline_cents: 740076 },
  account: { credit_limit_cents: 798740 },
}))
vi.mock('../../utils/debtReads', () => ({
  readCard: (...args: any[]) => mockReadCard(...args),
}))
vi.mock('../../utils/monthlyRollup', () => ({
  computeMonthlyRollup: () => ({ surplusAfterInterestCents: 220000 } as any),
}))

import handler from '../debt.get'
const makeEvent = (query: Record<string, string> = {}) => ({ _query: query } as any)

describe('GET /api/debt', () => {
  it('derives available credit (§14 #2) and flags utilization', async () => {
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    expect(res.cardBalanceCents).toBe(740076)
    expect(res.creditLimitCents).toBe(798740)
    // 798740 − 740076 = 58664 (RM586.64) — matches the seed avail
    expect(res.availableCreditCents).toBe(58664)
    expect(res.utilWarn).toBe(true)       // 740076/798740 ≈ 0.927 ≥ 0.90
    expect(res.utilDecline).toBe(false)   // < 1.00
  })

  it('reports ~RM111 monthly interest and a single card-free date (no BT)', async () => {
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    expect(res.monthlyInterestCents).toBe(11101)
    expect(res.cardFreeMonths).toBeGreaterThan(0)
    expect(res.cardFreeMonths).toBeLessThanOrEqual(6)
    expect(res.cardFreeISO).toMatch(/^2026-\d{2}-\d{2}$/)
  })

  it('recommends attempting the BT first (Step 0) and reports clamped progress', async () => {
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    expect(res.btRecommendation).toBe('attempt_bt')
    // baseline 740076, current 740076 → progress 0
    expect(res.payoffProgress).toBe(0)
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

  it('available_credit is NOT sourced from accounts.available_credit_cents (§14 #2)', async () => {
    // Even if the card account had a different available_credit_cents, the result must still
    // be limit − cardDebt (58664). The mock sets account.credit_limit_cents=798740 and
    // does NOT expose available_credit_cents — if the handler mistakenly reads that field it
    // would get undefined and the math would break. Assert it still returns 58664.
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    expect(res.availableCreditCents).toBe(798740 - 740076) // 58664
  })

  it('zero interest under active BT', async () => {
    mockReadCard.mockReturnValueOnce({
      debt: { balance_cents: 740076, apr_bps: 1800, bt_status: 'active', payoff_baseline_cents: 740076 },
      account: { credit_limit_cents: 798740 },
    })
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    expect(res.monthlyInterestCents).toBe(0)
    expect(res.btStatus).toBe('active')
    expect(res.btRecommendation).toBe('route_surplus_inside_promo')
  })

  it('cardFreeDate uses surplusAfterInterestCents (routed payment, not raw surplus)', async () => {
    // If it used raw surplus instead of surplusAfterInterestCents, the months figure would differ.
    // The mock returns surplusAfterInterestCents=220000. cardFreeDate with balance=740076,
    // apr=1800bps, payment=220000 should resolve within a few months.
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    // With 220000/mo and 740076 balance + 18% APR:
    //   Month 1: 740076 + floor(740076*1800/120000)=11101 → 751177 − 220000 = 531177
    //   Month 2: 531177 + floor(531177*1800/120000)=7967  → 539144 − 220000 = 319144
    //   Month 3: 319144 + floor(319144*1800/120000)=4787  → 323931 − 220000 = 103931
    //   Month 4: 103931 + floor(103931*1800/120000)=1558  → 105489 − 220000 ≤ 0 ✓
    expect(res.cardFreeMonths).toBe(4)
    expect(res.cardFreeISO).toBe('2026-10-18')
  })

  it('utilDecline true when balance equals credit limit (maxed card)', async () => {
    mockReadCard.mockReturnValueOnce({
      debt: { balance_cents: 798740, apr_bps: 1800, bt_status: 'none', payoff_baseline_cents: 798740 },
      account: { credit_limit_cents: 798740 },
    })
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    expect(res.utilization).toBe(1)
    expect(res.utilWarn).toBe(true)
    expect(res.utilDecline).toBe(true)
    expect(res.availableCreditCents).toBe(0)
  })
})

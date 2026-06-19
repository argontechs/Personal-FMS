import { describe, it, expect } from 'vitest'
import { projectDebtPlan, addMonthsYM, MAX_MONTHS } from '../debtPlan'

describe('projectDebtPlan — avalanche across all debts', () => {
  // A small 18% card + a no-interest loan, with a fixed RM200/mo extra thrown at debt.
  // Avalanche → the high-rate card is cleared first, then the loan; freed minimums snowball.
  const card = {
    id: 1, name: 'Card', balance_cents: 100000, rate_type: 'apr' as const,
    apr_bps: 1800, min_payment_cents: 5000, priority_rank: 1, type: 'revolving',
  }
  const loan = {
    id: 2, name: 'Loan', balance_cents: 200000, rate_type: 'none' as const,
    scheduled_payment_cents: 10000, priority_rank: 2, type: 'installment',
  }

  it('clears the high-rate card BEFORE the loan (avalanche order)', () => {
    const r = projectDebtPlan([card, loan], 20000, '2026-06-01')
    expect(r.neverClears).toBe(false)
    // perDebt is ordered by payoff order — card first.
    expect(r.perDebt.map((p) => p.id)).toEqual([1, 2])
    expect(r.perDebt[0].monthsToPayoff).toBe(5)  // card clears month 5
    expect(r.perDebt[1].monthsToPayoff).toBe(9)  // loan clears month 9
  })

  it('reports the overall debt-free month (the last debt to clear)', () => {
    const r = projectDebtPlan([card, loan], 20000, '2026-06-01')
    expect(r.debtFreeMonths).toBe(9)
    expect(addMonthsYM('2026-06-01', r.debtFreeMonths!)).toBe('2027-03')
  })

  it('accrues 18% revolving interest (floor(balance*apr_bps/120000)) — total interest > 0', () => {
    const r = projectDebtPlan([card, loan], 20000, '2026-06-01')
    // Only the card accrues; the no-interest loan adds nothing.
    expect(r.totalInterestCents).toBe(3919)
    expect(r.totalInterestCents).toBeGreaterThan(0)
  })

  it('debt order is unaffected by input ordering (sorts by priority_rank)', () => {
    const r = projectDebtPlan([loan, card], 20000, '2026-06-01') // loan listed first
    expect(r.perDebt.map((p) => p.id)).toEqual([1, 2]) // still card-then-loan by payoff
  })

  it('a fixed no-interest loan alone amortises on schedule with zero interest', () => {
    const payLater = {
      id: 3, name: 'PayLater', balance_cents: 30000, rate_type: 'none' as const,
      scheduled_payment_cents: 10000, priority_rank: 3, type: 'flat_loan',
    }
    const r = projectDebtPlan([payLater], 0, '2026-06-01')
    expect(r.neverClears).toBe(false)
    expect(r.debtFreeMonths).toBe(3) // RM300 at RM100/mo = 3 months
    expect(r.totalInterestCents).toBe(0)
  })
})

describe('projectDebtPlan — never-clears (payments too low)', () => {
  it('flags neverClears with a positive shortfall when payments cannot beat interest', () => {
    // RM7,400.76 card @ 18% → ~RM111/mo interest. Min RM50 + extra RM50 = RM100/mo < interest.
    const card = {
      id: 1, name: 'Card', balance_cents: 740076, rate_type: 'apr' as const,
      apr_bps: 1800, min_payment_cents: 5000, priority_rank: 1, type: 'revolving',
    }
    const r = projectDebtPlan([card], 5000, '2026-06-01')
    expect(r.neverClears).toBe(true)
    expect(r.debtFreeMonths).toBeNull()
    expect(r.shortfallCents).toBeGreaterThan(0) // "you need RMx more/mo"
  })

  it('does NOT loop to the cap when stalled (returns quickly with a shortfall)', () => {
    const card = {
      id: 1, name: 'Card', balance_cents: 740076, rate_type: 'apr' as const,
      apr_bps: 1800, min_payment_cents: 0, priority_rank: 1, type: 'revolving',
    }
    const r = projectDebtPlan([card], 0, '2026-06-01') // RM0 against interest → never
    expect(r.neverClears).toBe(true)
    // perDebt still lists the debt (with monthsToPayoff -1 = did not clear).
    expect(r.perDebt[0].monthsToPayoff).toBe(-1)
  })
})

describe('projectDebtPlan — edge cases', () => {
  it('returns a 0-month debt-free with no debts', () => {
    const r = projectDebtPlan([], 50000, '2026-06-01')
    expect(r.debtFreeMonths).toBe(0)
    expect(r.neverClears).toBe(false)
    expect(r.perDebt).toEqual([])
  })

  it('ignores already-zero balances', () => {
    const r = projectDebtPlan(
      [{ id: 1, name: 'Paid', balance_cents: 0, rate_type: 'none', scheduled_payment_cents: 1000 }],
      0, '2026-06-01',
    )
    expect(r.debtFreeMonths).toBe(0)
    expect(r.perDebt).toEqual([])
  })

  it('clamps a negative monthly extra to 0', () => {
    const payLater = {
      id: 3, name: 'PayLater', balance_cents: 30000, rate_type: 'none' as const,
      scheduled_payment_cents: 10000, priority_rank: 3,
    }
    const r = projectDebtPlan([payLater], -99999, '2026-06-01')
    expect(r.debtFreeMonths).toBe(3) // unchanged from the extra=0 case
  })
})

describe('addMonthsYM', () => {
  it('adds months across a year boundary', () => {
    expect(addMonthsYM('2026-06-01', 9)).toBe('2027-03')
    expect(addMonthsYM('2026-06-15', 0)).toBe('2026-06')
    expect(addMonthsYM('2026-12-01', 1)).toBe('2027-01')
  })
})

describe('MAX_MONTHS cap', () => {
  it('is a finite safety cap', () => {
    expect(MAX_MONTHS).toBeGreaterThan(0)
    expect(Number.isFinite(MAX_MONTHS)).toBe(true)
  })
})

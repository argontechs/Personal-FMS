import { describe, it, expect } from 'vitest'
import { projectDebtPlan, addMonthsYM, MAX_MONTHS, type DebtPlanInput } from '../debtPlan'

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

  it('clears the high-rate card BEFORE the loan (snowball → card only; loan on schedule)', () => {
    const r = projectDebtPlan([card, loan], 20000, '2026-06-01')
    expect(r.neverClears).toBe(false)
    // perDebt is ordered by payoff order — card first.
    expect(r.perDebt.map((p) => p.id)).toEqual([1, 2])
    expect(r.perDebt[0].monthsToPayoff).toBe(5)  // card clears month 5 (snowballed)
    // The loan is a no-interest installment: it amortises on its RM100/mo schedule ONLY and is
    // NEVER prepaid by the freed card payment. 200000 / 10000 = 20 months.
    expect(r.perDebt[1].monthsToPayoff).toBe(20)
  })

  it('reports the overall debt-free month (the last debt to clear)', () => {
    const r = projectDebtPlan([card, loan], 20000, '2026-06-01')
    expect(r.debtFreeMonths).toBe(20)
    expect(addMonthsYM('2026-06-01', r.debtFreeMonths!)).toBe('2028-02')
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

// ── Real seed debt shapes (server/db/seed.ts) ────────────────────────────────
// The 7 real debts at their opening balances. Only the Credit Card is a prepayable
// revolving debt (apr + never_prepay false); everything else amortises on schedule.
function seedDebts(): DebtPlanInput[] {
  return [
    { id: 1, name: 'Credit Card', type: 'revolving', balance_cents: 740076, rate_type: 'apr', apr_bps: 1800, min_payment_cents: 37004, priority_rank: 1 },
    { id: 2, name: 'Car Loan', type: 'flat_loan', balance_cents: 7348467, rate_type: 'flat', flat_rate_bps: 244, scheduled_payment_cents: 90400, never_prepay: true },
    { id: 3, name: 'PTPTN', type: 'reducing_loan', balance_cents: 3284362, rate_type: 'apr', apr_bps: 100, scheduled_payment_cents: 27000, never_prepay: true, priority_rank: null },
    { id: 4, name: 'SLoan 1', type: 'installment', balance_cents: 141944, rate_type: 'none', scheduled_payment_cents: 17743 },
    { id: 5, name: 'SLoan 2', type: 'installment', balance_cents: 27249, rate_type: 'none', scheduled_payment_cents: 9083 },
    { id: 6, name: 'ShopeePayLater', type: 'installment', balance_cents: 435585, rate_type: 'none', remaining_installments_json: JSON.stringify([151950, 83682, 63165, 57307, 35528, 14651, 14651, 14651]) },
    { id: 7, name: 'Ryt PayLater', type: 'installment', balance_cents: 85660, rate_type: 'none', scheduled_payment_cents: 21415, remaining_installments_json: JSON.stringify([21415, 21415, 21415, 21415]) },
  ]
}

describe('projectDebtPlan — REAL seed shapes (correct model)', () => {
  it('(a) snowball goes ONLY to the Credit Card; PTPTN + Car receive NO extra', () => {
    // A healthy extra (RM2,200/mo). With the snowball ALL going to the card, the card clears
    // far sooner than it would on its own min; PTPTN + Car never receive a single extra sen.
    const extra = 220000
    const withExtra = projectDebtPlan(seedDebts(), extra, '2026-06-01')
    const noExtra = projectDebtPlan(seedDebts(), 0, '2026-06-01')

    const cardWith = withExtra.perDebt.find((p) => p.id === 1)!.monthsToPayoff
    const cardNo = noExtra.perDebt.find((p) => p.id === 1)!.monthsToPayoff
    // Extra accelerates the card.
    expect(cardWith).toBeGreaterThan(0)
    expect(cardWith).toBeLessThan(cardNo)

    // never_prepay debts (PTPTN id3, Car id2) clear at the SAME month regardless of extra —
    // proof the snowball never touched them.
    const ptptnWith = withExtra.perDebt.find((p) => p.id === 3)!.monthsToPayoff
    const ptptnNo = noExtra.perDebt.find((p) => p.id === 3)!.monthsToPayoff
    const carWith = withExtra.perDebt.find((p) => p.id === 2)!.monthsToPayoff
    const carNo = noExtra.perDebt.find((p) => p.id === 2)!.monthsToPayoff
    expect(ptptnWith).toBe(ptptnNo)
    expect(carWith).toBe(carNo)
  })

  it('(b) ShopeePayLater amortises down its remaining_installments_json schedule (not frozen, not lump-paid)', () => {
    // SPayLater has NO scheduled_payment_cents — it must draw the next installment from the array.
    // Array = [151950, 83682, 63165, 57307, 35528, 14651, 14651, 14651] = 8 payments → 8 months.
    const r = projectDebtPlan(seedDebts(), 0, '2026-06-01')
    const sp = r.perDebt.find((p) => p.id === 6)!
    expect(sp.monthsToPayoff).toBe(8) // exactly 8 installments, one per month
    expect(sp.monthsToPayoff).toBeGreaterThan(0) // NOT frozen at 0/never
  })

  it('(b2) ShopeePayLater is not lump-paid at the end — early months only pay the listed installment', () => {
    // If SPayLater were lump-paid it would clear in month 1. With per-installment draw it takes 8.
    const r = projectDebtPlan(seedDebts(), 0, '2026-06-01')
    const sp = r.perDebt.find((p) => p.id === 6)!
    expect(sp.monthsToPayoff).not.toBe(1)
  })

  it('(d) debt-free date equals the LATEST payoff across all debts (the long pole on the real seed)', () => {
    const r = projectDebtPlan(seedDebts(), 220000, '2026-06-01')
    expect(r.neverClears).toBe(false)
    // The Car amortises on its OWN flat schedule, untouched by the snowball:
    //   7,348,467 sen @ RM904/mo (flat, no compounding) = ceil(7348467/90400) = 82 months.
    const car = r.perDebt.find((p) => p.id === 2)!
    expect(car.monthsToPayoff).toBe(82)
    // Debt-free = the LATEST payoff across ALL debts. On the REAL seed numbers PTPTN (RM32,843.62 @
    // 1% paying only RM270/mo → 129 months) is actually the slowest, longer than the car's 82.
    const ptptn = r.perDebt.find((p) => p.id === 3)!
    expect(ptptn.monthsToPayoff).toBe(129)
    const maxPer = Math.max(...r.perDebt.map((p) => p.monthsToPayoff))
    expect(r.debtFreeMonths).toBe(maxPer)
    expect(r.debtFreeMonths).toBe(129) // = the true long pole, not a distorted value
  })

  it('the Car amortises on its own flat schedule regardless of the snowball extra', () => {
    // The car must clear at the SAME month whether the surplus is huge or zero (never prepaid).
    const big = projectDebtPlan(seedDebts(), 500000, '2026-06-01')
    const none = projectDebtPlan(seedDebts(), 0, '2026-06-01')
    expect(big.perDebt.find((p) => p.id === 2)!.monthsToPayoff).toBe(82)
    expect(none.perDebt.find((p) => p.id === 2)!.monthsToPayoff).toBe(82)
  })

  it('PTPTN amortises on its 1% reducing schedule (never_prepay) and accrues some interest', () => {
    const r = projectDebtPlan(seedDebts(), 220000, '2026-06-01')
    const ptptn = r.perDebt.find((p) => p.id === 3)!
    expect(ptptn.monthsToPayoff).toBeGreaterThan(0)
    // PTPTN accrues a little interest (1% apr on declining balance) → total interest includes it.
    expect(r.totalInterestCents).toBeGreaterThan(0)
  })

  it('(e) never-clears still flagged when surplus cannot even cover the card', () => {
    // A min payment BELOW the monthly 18% interest on 740076 (~RM111.01) and no extra → never clears.
    const tiny = projectDebtPlan(
      [{ id: 1, name: 'Credit Card', type: 'revolving', balance_cents: 740076, rate_type: 'apr', apr_bps: 1800, min_payment_cents: 5000, priority_rank: 1 }],
      0, '2026-06-01',
    )
    expect(tiny.neverClears).toBe(true)
    expect(tiny.debtFreeMonths).toBeNull()
    expect(tiny.shortfallCents).toBeGreaterThan(0)
  })
})

describe('projectDebtPlan — avalanche-by-rate among prepayable revolving debts', () => {
  it('(c) targets the HIGHEST apr first when two prepayable revolving debts exist (apr DESC)', () => {
    // Two prepayable revolving debts, NEITHER ranked → must order by apr_bps DESC.
    const lowApr = { id: 10, name: 'LowAPR', type: 'revolving', balance_cents: 100000, rate_type: 'apr' as const, apr_bps: 900, min_payment_cents: 5000 }
    const highApr = { id: 11, name: 'HighAPR', type: 'revolving', balance_cents: 100000, rate_type: 'apr' as const, apr_bps: 2400, min_payment_cents: 5000 }
    const r = projectDebtPlan([lowApr, highApr], 30000, '2026-06-01')
    expect(r.neverClears).toBe(false)
    const highMonths = r.perDebt.find((p) => p.id === 11)!.monthsToPayoff
    const lowMonths = r.perDebt.find((p) => p.id === 10)!.monthsToPayoff
    // The higher-APR debt receives the snowball first → clears first.
    expect(highMonths).toBeLessThan(lowMonths)
  })

  it('priority_rank overrides apr DESC when BOTH debts carry a rank', () => {
    // Rank-2 debt has the HIGHER apr, but rank wins when both are ranked → rank-1 clears first.
    const ranked1 = { id: 20, name: 'Rank1', type: 'revolving', balance_cents: 100000, rate_type: 'apr' as const, apr_bps: 1000, min_payment_cents: 5000, priority_rank: 1 }
    const ranked2 = { id: 21, name: 'Rank2', type: 'revolving', balance_cents: 100000, rate_type: 'apr' as const, apr_bps: 3000, min_payment_cents: 5000, priority_rank: 2 }
    const r = projectDebtPlan([ranked2, ranked1], 30000, '2026-06-01')
    const r1 = r.perDebt.find((p) => p.id === 20)!.monthsToPayoff
    const r2 = r.perDebt.find((p) => p.id === 21)!.monthsToPayoff
    expect(r1).toBeLessThan(r2)
  })

  it('an apr debt with never_prepay is NOT a snowball target (amortises on schedule only)', () => {
    // A prepayable card + a never_prepay apr loan (PTPTN-like). The snowball must skip the loan.
    const card = { id: 30, name: 'Card', type: 'revolving', balance_cents: 100000, rate_type: 'apr' as const, apr_bps: 1800, min_payment_cents: 5000, priority_rank: 1 }
    const ptptn = { id: 31, name: 'PTPTN', type: 'reducing_loan', balance_cents: 100000, rate_type: 'apr' as const, apr_bps: 100, scheduled_payment_cents: 10000, never_prepay: true }
    const withExtra = projectDebtPlan([card, ptptn], 50000, '2026-06-01')
    const noExtra = projectDebtPlan([card, ptptn], 0, '2026-06-01')
    // PTPTN clears at the same month whether or not there is a snowball → it never received extra.
    const a = withExtra.perDebt.find((p) => p.id === 31)!.monthsToPayoff
    const b = noExtra.perDebt.find((p) => p.id === 31)!.monthsToPayoff
    expect(a).toBe(b)
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

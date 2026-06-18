// server/utils/__tests__/safeToSpend.test.ts
import { describe, it, expect } from 'vitest'
import { computeSafeToSpend } from '../safeToSpend'

describe('computeSafeToSpend', () => {
  it('STS_cycle = cash + inflows − committed − savings_target − BUFFER_FLOOR', () => {
    // cash 80000, no extra inflows, committed 20000, savings target 30000, buffer 20000
    // raw cycle = 80000 + 0 - 20000 - 30000 - 20000 = 10000
    const r = computeSafeToSpend({
      cashNowCents: 80000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 20000,
      savingsTargetRemainingCents: 30000,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-18', // next inflow 23rd → 5 days
    })
    expect(r.cycleCents).toBe(10000)
    expect(r.nextInflowISO).toBe('2026-06-23')
    expect(r.daysToNextInflow).toBe(5)
    expect(r.isNegative).toBe(false)
  })

  it('STS_daily = cycle / days − spent_today_variable, clamped at 0', () => {
    // cycle 10000 over 5 days = 2000/day; spent_today 500 → 1500
    const r = computeSafeToSpend({
      cashNowCents: 80000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 20000,
      savingsTargetRemainingCents: 30000,
      spentTodayVariableCents: 500,
      todayISO: '2026-06-18',
    })
    expect(r.dailyCents).toBe(1500)
  })

  it('STS_weekly = cycle × min(7, days)/days', () => {
    // days=5 (<7) → weekly == cycle == 10000
    const r = computeSafeToSpend({
      cashNowCents: 80000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 20000,
      savingsTargetRemainingCents: 30000,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-18',
    })
    expect(r.weeklyCents).toBe(10000)
  })

  it('weekly caps to a 7-day slice when more than 7 days remain', () => {
    // from the 23rd next inflow is the 1st → 8 days.
    // rawCycle = 80000 - 0 - 0 - BUFFER_FLOOR(20000) = 60000
    // weekly = floor(60000 * 7 / 8) = 52500
    // (brief comment said "cycle 80000" omitting BUFFER_FLOOR; formula is authoritative per §14)
    const r = computeSafeToSpend({
      cashNowCents: 80000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 0,
      savingsTargetRemainingCents: 0,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-23',
    })
    expect(r.daysToNextInflow).toBe(8)
    expect(r.weeklyCents).toBe(52500)
  })

  it('never shows a negative number: clamps to 0 and reports shortfall', () => {
    // raw cycle = 5000 + 0 - 30000 - 0 - 20000 = -45000
    const r = computeSafeToSpend({
      cashNowCents: 5000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 30000,
      savingsTargetRemainingCents: 0,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-18',
    })
    expect(r.cycleCents).toBe(0)
    expect(r.dailyCents).toBe(0)
    expect(r.weeklyCents).toBe(0)
    expect(r.isNegative).toBe(true)
    expect(r.shortfallCents).toBe(45000)
  })

  it('does not subtract a savings target it is not steering (Attack phase = 0)', () => {
    // savings target paused (0) → cycle larger than the buffer-phase case
    const r = computeSafeToSpend({
      cashNowCents: 80000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 20000,
      savingsTargetRemainingCents: 0,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-18',
    })
    expect(r.cycleCents).toBe(40000)
  })

  it('guards days_to_next_inflow with max(1, …) so daily never divides by zero', () => {
    // todayISO already an inflow day: next strictly-after is the 3rd → still ≥ 1
    const r = computeSafeToSpend({
      cashNowCents: 20000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 0,
      savingsTargetRemainingCents: 0,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-01',
    })
    expect(r.daysToNextInflow).toBeGreaterThanOrEqual(1)
  })
})

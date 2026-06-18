// test/app/useSafeToSpend.test.ts
// happy-dom vitest project — client composable tests.
import { describe, it, expect } from 'vitest'
import { useSafeToSpend } from '../../app/composables/useSafeToSpend'

// INFLOW_DAYS=[1,3,23]; today=2026-06-18 → next inflow=2026-06-23 (5 days away)
// rawCycle = 80000 + 0 - 20000 - 30000 - BUFFER_FLOOR(20000) = 10000
// dailyCents = floor(10000/5) - 0 = 2000
const baseSeed = () => ({
  cashNowCents: 80000,
  expectedInflowsBeforeNextCents: 0,
  committedOutflowsCents: 20000,
  savingsTargetRemainingCents: 30000,
  spentTodayVariableCents: 0,
  todayISO: '2026-06-18',
})

describe('useSafeToSpend', () => {
  it('computes the same STS_cycle as the server formula', () => {
    const { sts } = useSafeToSpend(baseSeed)
    expect(sts.value.cycleCents).toBe(10000)
    expect(sts.value.nextInflowISO).toBe('2026-06-23')
  })

  it('formats the hero label with the next-inflow date', () => {
    const { heroLabel } = useSafeToSpend(baseSeed)
    expect(heroLabel.value).toBe('Safe to spend until 23 Jun: RM100.00')
  })

  it('shows RM0 + shortfall in the label when committed past the buffer', () => {
    // rawCycle = 5000 + 0 - 20000 - 0 - BUFFER_FLOOR(20000) = -35000
    const seed = () => ({ ...baseSeed(), cashNowCents: 5000, savingsTargetRemainingCents: 0 })
    const { heroLabel, sts } = useSafeToSpend(seed)
    expect(sts.value.isNegative).toBe(true)
    expect(heroLabel.value).toBe('RM0 — RM350.00 short')
  })

  it('registerSpend optimistically reduces STS_daily without a server round-trip', () => {
    const { sts, registerSpend, spentTodayCents } = useSafeToSpend(baseSeed)
    const before = sts.value.dailyCents // floor(10000/5) - 0 = 2000
    expect(before).toBe(2000)
    registerSpend(500)
    expect(spentTodayCents.value).toBe(500)
    expect(sts.value.dailyCents).toBe(1500) // 2000 - 500
  })
})

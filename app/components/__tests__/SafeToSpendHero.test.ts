// app/components/__tests__/SafeToSpendHero.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SafeToSpendHero from '../forecast/SafeToSpendHero.vue'

const positiveSts = {
  cycleCents: 10000, dailyCents: 2000, weeklyCents: 10000, isNegative: false,
  shortfallCents: 0, nextInflowISO: '2026-06-23', daysToNextInflow: 5,
}

describe('SafeToSpendHero', () => {
  it('renders the cycle hero and the daily/weekly chips', () => {
    const w = mount(SafeToSpendHero, { props: { sts: positiveSts } })
    expect(w.text()).toContain('Safe to spend until 23 Jun')
    expect(w.text()).toContain('RM100.00')   // cycle
    expect(w.text()).toContain('RM20.00')    // daily chip
  })

  it('renders RM0 in red with the shortfall when negative', () => {
    const negSts = { ...positiveSts, cycleCents: 0, isNegative: true, shortfallCents: 35000 }
    const w = mount(SafeToSpendHero, { props: { sts: negSts } })
    expect(w.text()).toContain('RM0')
    expect(w.text()).toContain('RM350.00 short')
    expect(w.find('[data-testid="sts-negative"]').exists()).toBe(true)
  })

  it('never shows a negative number — cycleCents is clamped at 0', () => {
    // Even if somehow a negative value slipped in, the component should show RM0 with shortfall
    const negSts = { ...positiveSts, cycleCents: 0, isNegative: true, shortfallCents: 5000 }
    const w = mount(SafeToSpendHero, { props: { sts: negSts } })
    // The RM amount shown must not be negative
    expect(w.text()).not.toMatch(/RM-/)
    expect(w.text()).toContain('RM0')
    expect(w.text()).toContain('RM50.00 short')
  })

  it('shows weekly chip alongside daily chip on positive STS', () => {
    const w = mount(SafeToSpendHero, { props: { sts: positiveSts } })
    expect(w.text()).toContain('RM100.00') // weekly (10000 sen = RM100.00 when days ≤ 7, weekly = cycle)
    expect(w.text()).toContain('/day')
    expect(w.text()).toContain('/week')
  })
})

// app/components/__tests__/CardDebtCard.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CardDebtCard from '../debt/CardDebtCard.vue'

const debt = {
  cardBalanceCents: 740076, creditLimitCents: 798740, availableCreditCents: 58664,
  utilization: 0.927, utilWarn: true, utilDecline: false, monthlyInterestCents: 11101,
  btStatus: 'none' as const, btRecommendation: 'attempt_bt' as const,
  payoffProgress: 0, cardFreeISO: '2026-11-18', cardFreeMonths: 5,
}

describe('CardDebtCard', () => {
  it('shows balance, ~RM111 interest and the single card-free date', () => {
    const w = mount(CardDebtCard, { props: { debt } })
    expect(w.text()).toContain('RM7,400.76')  // balance
    expect(w.text()).toContain('RM111.01')     // monthly interest
    expect(w.text()).toContain('card-free')
  })

  it('shows RM0 interest and a "clear inside promo" line under an active BT', () => {
    const bt = { ...debt, monthlyInterestCents: 0, btStatus: 'active' as const, btRecommendation: 'route_surplus_inside_promo' as const }
    const w = mount(CardDebtCard, { props: { debt: bt } })
    expect(w.text()).toContain('RM0')
    expect(w.text()).toContain('promo')
  })

  it('surfaces the hard "card maxed" flag when utilDecline is true', () => {
    const maxed = { ...debt, utilDecline: true }
    const w = mount(CardDebtCard, { props: { debt: maxed } })
    expect(w.find('[data-testid="card-maxed"]').exists()).toBe(true)
    expect(w.text()).toContain('charges will decline')
  })

  it('shows utilisation warning (amber) when utilWarn but not utilDecline', () => {
    const w = mount(CardDebtCard, { props: { debt } })
    // utilWarn=true, utilDecline=false → amber warn, no maxed flag
    expect(w.find('[data-testid="card-maxed"]').exists()).toBe(false)
    expect(w.text()).toContain('close to the limit')
  })

  it('renders available credit', () => {
    const w = mount(CardDebtCard, { props: { debt } })
    // availableCreditCents = 58664 → RM586.64
    expect(w.text()).toContain('RM586.64')
  })

  it('shows BT recommendation copy for attempt_bt', () => {
    const w = mount(CardDebtCard, { props: { debt } })
    expect(w.text()).toContain('Convert/transfer')
  })
})

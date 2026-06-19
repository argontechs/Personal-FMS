// app/components/__tests__/DebtPlanPanel.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DebtPlanPanel from '../debt/DebtPlanPanel.vue'

const healthyPlan = {
  debtFreeDate: '2027-03',
  totalInterestCents: 3919,
  monthlyExtraCents: 220000,
  neverClears: false,
  shortfallCents: 0,
  perDebt: [
    { id: 1, name: 'Credit Card', monthsToPayoff: 5, payoffDate: '2026-11' },
    { id: 2, name: 'Car Loan', monthsToPayoff: 9, payoffDate: '2027-03' },
  ],
}

const neverPlan = {
  debtFreeDate: null,
  totalInterestCents: 22218,
  monthlyExtraCents: 5000,
  neverClears: true,
  shortfallCents: 1135,
  perDebt: [{ id: 1, name: 'Credit Card', monthsToPayoff: -1, payoffDate: null }],
}

describe('DebtPlanPanel — healthy plan', () => {
  it('renders the "Debt-free by <Month YYYY>" headline', () => {
    const w = mount(DebtPlanPanel, { props: { plan: healthyPlan } })
    expect(w.text()).toContain('Debt-free by')
    expect(w.find('[data-testid="debt-free-date"]').text()).toBe('Mar 2027')
  })

  it('renders the avalanche payoff ORDER with each debt and its projected clear month', () => {
    const w = mount(DebtPlanPanel, { props: { plan: healthyPlan } })
    const rows = w.findAll('[data-testid="debt-plan-row"]')
    expect(rows.length).toBe(2)
    // first row = the high-rate card, then the loan
    expect(rows[0].text()).toContain('Credit Card')
    expect(rows[0].text()).toContain('Nov 2026')
    expect(rows[1].text()).toContain('Car Loan')
    expect(rows[1].text()).toContain('Mar 2027')
  })

  it('shows the one-line assumed monthly-extra note (and total interest)', () => {
    const w = mount(DebtPlanPanel, { props: { plan: healthyPlan } })
    const note = w.find('[data-testid="debt-plan-extra-note"]')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('RM2,200.00/mo') // 220000 sen
    expect(note.text()).toContain('RM39.19')        // 3919 sen total interest
  })

  it('does NOT show the never-clears alert when a plan exists', () => {
    const w = mount(DebtPlanPanel, { props: { plan: healthyPlan } })
    expect(w.find('[data-testid="debt-plan-never"]').exists()).toBe(false)
  })

  it('omits debts that do not clear within the projection (monthsToPayoff <= 0)', () => {
    const mixed = {
      ...healthyPlan,
      perDebt: [
        { id: 1, name: 'Credit Card', monthsToPayoff: 5, payoffDate: '2026-11' },
        { id: 9, name: 'Stuck Loan', monthsToPayoff: -1, payoffDate: null },
      ],
    }
    const w = mount(DebtPlanPanel, { props: { plan: mixed } })
    expect(w.findAll('[data-testid="debt-plan-row"]').length).toBe(1)
    expect(w.text()).not.toContain('Stuck Loan')
  })
})

describe('DebtPlanPanel — too-low (never clears) state', () => {
  it('shows the honest "never clears at this surplus" message instead of a fake date', () => {
    const w = mount(DebtPlanPanel, { props: { plan: neverPlan } })
    const never = w.find('[data-testid="debt-plan-never"]')
    expect(never.exists()).toBe(true)
    expect(never.text().toLowerCase()).toContain('never clears')
    // No fake debt-free date
    expect(w.find('[data-testid="debt-free-date"]').exists()).toBe(false)
  })

  it('tells the user how much more per month is needed (shortfall)', () => {
    const w = mount(DebtPlanPanel, { props: { plan: neverPlan } })
    expect(w.text()).toContain('RM11.35/mo') // 1135 sen shortfall
    expect(w.text()).toContain('more')
  })

  it('still surfaces the assumed monthly extra in the never state', () => {
    const w = mount(DebtPlanPanel, { props: { plan: neverPlan } })
    expect(w.text()).toContain('RM50.00/mo') // 5000 sen assumed extra
  })

  it('uses role="alert" on the never-clears block (accessible)', () => {
    const w = mount(DebtPlanPanel, { props: { plan: neverPlan } })
    expect(w.find('[role="alert"]').exists()).toBe(true)
  })
})

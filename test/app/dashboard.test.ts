// test/app/dashboard.test.ts
// Dashboard page integration test — mocks the three API endpoints and asserts all sections render.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, Suspense, ref } from 'vue'

// ─── API fixtures ─────────────────────────────────────────────────────────────
const mockForecast = {
  sts: {
    cycleCents: 50000, dailyCents: 5000, weeklyCents: 25000, isNegative: false,
    shortfallCents: 0, nextInflowISO: '2026-06-23', daysToNextInflow: 5,
  },
  rollup: {
    incomeCents: 641950, livingCents: 183860, debtServiceCents: 90400,
    interestCents: 11101, rawSurplusCents: 367690, surplusAfterInterestCents: 356589,
  },
  cashNowCents: 100000,
  todayISO: '2026-06-18',
  deltaCashThisMonthCents: 0, // 0 → leak flag fires (rawSurplus > 0, deltaCash ≤ 0)
}

const mockDebt = {
  cardBalanceCents: 740076, creditLimitCents: 798740, availableCreditCents: 58664,
  utilization: 0.927, utilWarn: true, utilDecline: false, monthlyInterestCents: 11101,
  btStatus: 'none' as const, btRecommendation: 'attempt_bt' as const,
  payoffProgress: 0, cardFreeISO: '2026-11-18', cardFreeMonths: 5,
}

const mockGoals = {
  ef: { currentCents: 45000, targetCents: 100000, progress: 0.45 },
  killCard: { currentCents: 740076, baselineCents: 800000, progress: 0.075 },
}

const mockAccounts = [{ id: 7, type: 'cash', balance_cents: 100000 }]

// Active forecast override — set per-test to swap the /api/forecast response.
let activeForecast: typeof mockForecast = mockForecast

// ─── useFetch mock (must be defined before page import) ──────────────────────
// Returns { data: Ref<T> } matching Nuxt's runtime contract so templates auto-unwrap refs.
vi.mock('#app', () => ({
  useFetch: vi.fn(async (url: string) => {
    if (url === '/api/forecast') return { data: ref(activeForecast), refresh: vi.fn() }
    if (url === '/api/debt')     return { data: ref(mockDebt), refresh: vi.fn() }
    if (url === '/api/goals/progress') return { data: ref(mockGoals), refresh: vi.fn() }
    if (url === '/api/accounts') return { data: ref(mockAccounts), refresh: vi.fn() }
    return { data: ref(null), refresh: vi.fn() }
  }),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
}))

// useOfflineQueue mock so QuickLog renders without IndexedDB
vi.mock('../../app/composables/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    enqueue: vi.fn(async (input: any) => ({ ...input, uuid: 'test-uuid' })),
    pending: vi.fn(async () => []),
    flush: vi.fn(async () => ({ flushed: 0, remaining: 0 })),
  }),
  registerAutoFlush: vi.fn(),
}))

// Import AFTER mocks (Vitest hoists vi.mock)
import DashboardPage from '../../app/pages/index.vue'

// ─── Helper: mount inside <Suspense> (required for async setup components) ───
function mountDashboard() {
  return mount(
    defineComponent({
      render() { return h(Suspense, null, { default: () => h(DashboardPage) }) },
    }),
  )
}

beforeEach(() => {
  activeForecast = mockForecast
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Dashboard page', () => {
  it('renders the STS hero with the cycle value', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.text()).toContain('RM500.00')          // cycleCents 50000 = RM500.00
    expect(w.text()).toContain('Safe to spend until 23 Jun')
  })

  it('renders daily and weekly chips', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.text()).toContain('RM50.00')            // dailyCents 5000 = RM50.00
    expect(w.text()).toContain('/day')
    expect(w.text()).toContain('/week')
  })

  it('hero shows RM0 + shortfall (never a negative number) when isNegative', async () => {
    activeForecast = {
      ...mockForecast,
      sts: { ...mockForecast.sts, cycleCents: 0, isNegative: true, shortfallCents: 20000 },
    }
    const w = mountDashboard()
    await flushPromises()
    expect(w.text()).not.toMatch(/RM-/)              // never a negative number shown
    expect(w.text()).toContain('RM0')
    expect(w.text()).toContain('RM200.00 short')
    expect(w.find('[data-testid="sts-negative"]').exists()).toBe(true)
  })

  it('renders EF progress bar with amount and percentage', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.text()).toContain('Emergency Fund')
    expect(w.text()).toContain('45%')                // progress 0.45
    expect(w.text()).toContain('RM450.00')           // currentCents 45000
  })

  it('renders Kill-Card progress bar', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.text()).toContain('Kill Credit Card')
    expect(w.text()).toContain('RM7,400.76')         // currentCents 740076
  })

  it('renders debt card with balance, interest, card-free date, utilisation and BT copy', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.text()).toContain('RM7,400.76')         // card balance
    expect(w.text()).toContain('RM111.01')           // monthly interest
    expect(w.text()).toContain('card-free')          // card-free date label
    expect(w.text()).toContain('close to the limit') // utilWarn amber signal
    expect(w.text()).toContain('Convert/transfer')   // BT recommendation copy
  })

  it('renders the surplus rollup with income, living, debt service and card interest', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.text()).toContain('RM6,419.50')         // incomeCents 641950
    expect(w.text()).toContain('RM1,838.60')         // livingCents 183860
    expect(w.text()).toContain('Debt service')
    expect(w.text()).toContain('Card interest')
  })

  it('shows the leak insight when surplus > 0 and deltaCash ≤ 0', async () => {
    // activeForecast: rawSurplusCents=367690>0, deltaCashThisMonthCents=0 → leak fires
    const w = mountDashboard()
    await flushPromises()
    expect(w.text()).toContain("didn't land in savings")
    expect(w.text()).toContain('RM3,676.90')         // rawSurplusCents 367690
  })

  it('does not show the leak insight when deltaCash > 0 (cash actually grew)', async () => {
    activeForecast = { ...mockForecast, deltaCashThisMonthCents: 50000 }
    const w = mountDashboard()
    await flushPromises()
    expect(w.text()).not.toContain("didn't land in savings")
  })

  it('embeds QuickLog with amount input and category chips', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="amount"]').exists()).toBe(true)
    expect(w.find('[data-test="cat-food"]').exists()).toBe(true)
    expect(w.find('[data-test="cat-transport"]').exists()).toBe(true)
    expect(w.find('[data-test="cat-other"]').exists()).toBe(true)
  })
})

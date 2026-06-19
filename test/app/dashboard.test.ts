// test/app/dashboard.test.ts
// Dashboard page integration test — mocks the three API endpoints and asserts all sections render.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

const mockAccounts = [
  { id: 7, type: 'cash', balance_cents: 100000 },
  { id: 3, type: 'bank', balance_cents: 200000 },
  { id: 5, type: 'savings', balance_cents: 45000 },
]

const mockMoneyMoves = [
  {
    key: 'clear-card-with-aia',
    kind: 'action',
    title: 'Clear the 18% card with your AIA Assurance Account',
    explanation:
      'Withdraw ~RM7,400.76 from your AIA Assurance Account to clear the 18% card outright — a guaranteed ~18% return. Ask AIA about partial-withdrawal terms + coverage impact.',
    suggestedAmountCents: 740076,
    status: 'todo' as const,
  },
  {
    key: 'pause-ge-ilp',
    kind: 'confirm',
    title: 'Pause the Great Eastern ILP',
    explanation: "Confirm you've paused the Great Eastern ILP (RM350/mo) with GE.",
    suggestedAmountCents: null,
    status: 'todo' as const,
  },
]

// Active forecast override — set per-test to swap the /api/forecast response.
let activeForecast: typeof mockForecast = mockForecast
let activeGoals: typeof mockGoals = mockGoals
let activeAccounts: typeof mockAccounts = mockAccounts
let activeMoneyMoves: typeof mockMoneyMoves = mockMoneyMoves
let lastRefreshMoneyMoves: ReturnType<typeof vi.fn>

// refreshForecast and refreshGoals spies — captured per mount so tests can check calls.
let lastRefreshForecast: ReturnType<typeof vi.fn>
let lastRefreshGoals: ReturnType<typeof vi.fn>
let forecastError: any = null
let goalsError: any = null

// ─── useFetch mock (must be defined before page import) ──────────────────────
// Returns { data: Ref<T> } matching Nuxt's runtime contract so templates auto-unwrap refs.
vi.mock('#app', () => ({
  useFetch: vi.fn(async (url: string) => {
    if (url === '/api/forecast') {
      const refresh = vi.fn(async () => {})
      lastRefreshForecast = refresh
      return { data: ref(activeForecast), refresh, error: ref(forecastError) }
    }
    if (url === '/api/debt')     return { data: ref(mockDebt), refresh: vi.fn(), error: ref(null) }
    if (url === '/api/goals/progress') {
      const refresh = vi.fn(async () => {})
      lastRefreshGoals = refresh
      return { data: ref(activeGoals), refresh, error: ref(goalsError) }
    }
    if (url === '/api/accounts') return { data: ref(activeAccounts), refresh: vi.fn(), error: ref(null) }
    if (url === '/api/money-moves') {
      const refresh = vi.fn(async () => {})
      lastRefreshMoneyMoves = refresh
      return { data: ref(activeMoneyMoves), refresh, error: ref(null) }
    }
    return { data: ref(null), refresh: vi.fn(), error: ref(null) }
  }),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  definePageMeta: vi.fn(),
  useRoute: vi.fn(() => ({ path: '/', name: 'index', params: {}, query: {}, hash: '' })),
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

// ─── Helper: mount inside <Suspense> attached to document.body ────────────────
// attachTo ensures Teleport can render to body and we can querySelector on document.body.
let mountedWrappers: ReturnType<typeof mount>[] = []

function mountDashboard() {
  const div = document.createElement('div')
  document.body.appendChild(div)
  const w = mount(
    defineComponent({
      render() { return h(Suspense, null, { default: () => h(DashboardPage) }) },
    }),
    { attachTo: div },
  )
  mountedWrappers.push(w)
  return w
}

// Helper: find teleported dialog in document.body
function findSheet() {
  return document.body.querySelector('[role="dialog"]') as HTMLElement | null
}

function findInSheet(selector: string) {
  const dialog = findSheet()
  return dialog ? dialog.querySelector(selector) as HTMLElement | null : null
}

beforeEach(() => {
  activeForecast = mockForecast
  activeGoals = mockGoals
  activeAccounts = mockAccounts
  activeMoneyMoves = mockMoneyMoves
  forecastError = null
  goalsError = null
  vi.stubGlobal('$fetch', vi.fn(async () => ({ id: 42 })))
})

afterEach(() => {
  // Unmount and detach all wrappers to keep document.body clean between tests
  for (const w of mountedWrappers) {
    w.unmount()
  }
  mountedWrappers = []
  // Clean up any leftover teleported nodes
  document.body.querySelectorAll('[role="dialog"]').forEach(el => el.remove())
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

// ─── Move-to-EF sheet ─────────────────────────────────────────────────────────
describe('Move-to-EF action', () => {
  it('renders "Move to savings" button on the EF goal card', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="move-to-ef"]').exists()).toBe(true)
    expect(w.find('[data-test="move-to-ef"]').text()).toContain('Move to savings')
  })

  it('clicking "Move to savings" opens the bottom sheet', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(findSheet()).toBeNull()
    await w.find('[data-test="move-to-ef"]').trigger('click')
    await flushPromises()
    expect(findSheet()).not.toBeNull()
    expect(findSheet()!.textContent).toContain('Emergency Fund')
  })

  it('sheet is pre-filled with suggested amount (remaining-to-target)', async () => {
    // Suggested = targetCents - currentCents = 100000 - 45000 = 55000 → RM550.00
    const w = mountDashboard()
    await flushPromises()
    await w.find('[data-test="move-to-ef"]').trigger('click')
    await flushPromises()
    const input = findInSheet('#ef-amount') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('550.00')
  })

  it('confirming the sheet POSTs /api/transfers with the correct legs', async () => {
    const mockFetch = vi.fn(async () => ({ id: 42 }))
    vi.stubGlobal('$fetch', mockFetch)

    const w = mountDashboard()
    await flushPromises()
    await w.find('[data-test="move-to-ef"]').trigger('click')
    await flushPromises()

    const input = findInSheet('#ef-amount') as HTMLInputElement
    // set value and dispatch input event so Vue's v-model picks it up
    input.value = '100.00'
    input.dispatchEvent(new Event('input'))
    await flushPromises()

    const confirmBtn = findInSheet('.sheet__confirm') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    expect(mockFetch).toHaveBeenCalledWith('/api/transfers', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        amount_cents: 10000,
        from_account_id: 3,        // checking account
        to_account_id: 5,          // savings (EF) account
        note: 'Emergency fund',
        source: 'manual',
      }),
    }))
  })

  it('after successful transfer, refreshForecast and refreshGoals are called', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ id: 1 })))

    const w = mountDashboard()
    await flushPromises()
    await w.find('[data-test="move-to-ef"]').trigger('click')
    await flushPromises()

    const input = findInSheet('#ef-amount') as HTMLInputElement
    input.value = '50.00'
    input.dispatchEvent(new Event('input'))
    await flushPromises()

    const confirmBtn = findInSheet('.sheet__confirm') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    expect(lastRefreshForecast).toHaveBeenCalled()
    expect(lastRefreshGoals).toHaveBeenCalled()
  })

  it('shows an error when amount exceeds available cash', async () => {
    const w = mountDashboard()
    await flushPromises()
    await w.find('[data-test="move-to-ef"]').trigger('click')
    await flushPromises()
    // cashNowCents = 100000 = RM1000; enter RM1001
    const input = findInSheet('#ef-amount') as HTMLInputElement
    input.value = '1001.00'
    input.dispatchEvent(new Event('input'))
    await flushPromises()

    const confirmBtn = findInSheet('.sheet__confirm') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    const errorEl = findInSheet('.sheet__error') as HTMLElement
    expect(errorEl).not.toBeNull()
    expect(errorEl.textContent).toContain('exceeds available cash')
  })

  it('shows an error for a zero or blank amount', async () => {
    const w = mountDashboard()
    await flushPromises()
    await w.find('[data-test="move-to-ef"]').trigger('click')
    await flushPromises()

    // Clear the pre-filled value
    const input = findInSheet('#ef-amount') as HTMLInputElement
    input.value = ''
    input.dispatchEvent(new Event('input'))
    await flushPromises()

    const confirmBtn = findInSheet('.sheet__confirm') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    const errorEl = findInSheet('.sheet__error') as HTMLElement
    expect(errorEl).not.toBeNull()
    expect(errorEl.textContent).toContain('valid amount')
  })

  it('closing the sheet hides the dialog', async () => {
    const w = mountDashboard()
    await flushPromises()
    await w.find('[data-test="move-to-ef"]').trigger('click')
    await flushPromises()
    expect(findSheet()).not.toBeNull()

    const closeBtn = findInSheet('.sheet__close') as HTMLButtonElement
    closeBtn.click()
    await flushPromises()
    expect(findSheet()).toBeNull()
  })
})

// ─── Payday prompt ────────────────────────────────────────────────────────────
describe('Payday prompt', () => {
  it('shows the payday prompt when income has landed and EF target not met', async () => {
    // mockForecast has incomeCents=641950 > 0; mockGoals has ef.progress=0.45 < 1
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="payday-prompt"]').exists()).toBe(true)
    expect(w.text()).toContain('RM6,419.50')          // paydayIncomeCents
    expect(w.text()).toContain('RM550.00')             // suggestedSavings (55000 sen)
  })

  it('does not show the payday prompt when income is 0', async () => {
    activeForecast = {
      ...mockForecast,
      rollup: { ...mockForecast.rollup, incomeCents: 0 },
    }
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="payday-prompt"]').exists()).toBe(false)
  })

  it('does not show the payday prompt when EF target is already met', async () => {
    activeGoals = {
      ...mockGoals,
      ef: { currentCents: 100000, targetCents: 100000, progress: 1 },
    }
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="payday-prompt"]').exists()).toBe(false)
  })

  it('Skip dismisses the payday prompt', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="payday-prompt"]').exists()).toBe(true)
    const skipBtn = w.find('[data-test="payday-prompt"]').find('button[aria-label*="Skip"]')
    await skipBtn.trigger('click')
    await flushPromises()
    expect(w.find('[data-test="payday-prompt"]').exists()).toBe(false)
  })

  it('Move button opens the sheet prefilled with suggested amount', async () => {
    const w = mountDashboard()
    await flushPromises()
    const moveBtn = w.find('[data-test="payday-prompt"]').find('button[aria-label*="Move"]')
    await moveBtn.trigger('click')
    await flushPromises()
    expect(findSheet()).not.toBeNull()
    const input = findInSheet('#ef-amount') as HTMLInputElement
    expect(input.value).toBe('550.00')
  })

  it('Adjust button opens the sheet with suggested amount (editable)', async () => {
    const w = mountDashboard()
    await flushPromises()
    const adjustBtn = w.find('[data-test="payday-prompt"]').find('button[aria-label*="Adjust"]')
    await adjustBtn.trigger('click')
    await flushPromises()
    expect(findSheet()).not.toBeNull()
  })

  it('payday prompt hides after a successful transfer via Move-to-EF button', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ id: 99 })))
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="payday-prompt"]').exists()).toBe(true)

    // Open sheet via the EF card button, enter amount, confirm
    await w.find('[data-test="move-to-ef"]').trigger('click')
    await flushPromises()

    const input = findInSheet('#ef-amount') as HTMLInputElement
    input.value = '50.00'
    input.dispatchEvent(new Event('input'))
    await flushPromises()

    const confirmBtn = findInSheet('.sheet__confirm') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    expect(w.find('[data-test="payday-prompt"]').exists()).toBe(false)
  })
})

// ─── Dashboard error state ────────────────────────────────────────────────────
describe('Dashboard error state', () => {
  it('shows an error card with Retry button when the forecast fetch errors', async () => {
    forecastError = new Error('Network error')
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(true)
    expect(w.text()).toContain("couldn't be loaded")
    expect(w.text()).toContain('Retry')
  })

  it('does not show RM0 hero when dashboard has a fetch error', async () => {
    forecastError = new Error('500')
    const w = mountDashboard()
    await flushPromises()
    // The STS hero should not be present
    expect(w.find('[data-testid="sts-hero"]').exists()).toBe(false)
  })

  it('clicking Retry calls refreshForecast and refreshGoals', async () => {
    forecastError = new Error('fetch failed')
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(true)

    await w.find('[role="alert"] .btn-primary').trigger('click')
    await flushPromises()

    expect(lastRefreshForecast).toHaveBeenCalled()
    expect(lastRefreshGoals).toHaveBeenCalled()
  })

  it('normal content is NOT shown when there is a dashboard error', async () => {
    forecastError = new Error('error')
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="move-to-ef"]').exists()).toBe(false)
    expect(w.find('[data-test="payday-prompt"]').exists()).toBe(false)
  })
})

// ─── Money moves (§11/§15 advisory levers) ──────────────────────────────────
describe('Money moves', () => {
  it('renders the AIA-withdrawal move with its explanation', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="money-moves-section"]').exists()).toBe(true)
    expect(w.find('[data-test="money-move-clear-card-with-aia"]').exists()).toBe(true)
    expect(w.text()).toContain('AIA Assurance Account')
    expect(w.text()).toContain('guaranteed ~18% return')
    expect(w.text()).toContain('RM7,400.76') // suggested amount = card balance
  })

  it('renders the GE-ILP-pause confirm move', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="money-move-pause-ge-ilp"]').exists()).toBe(true)
    expect(w.text()).toContain('Great Eastern ILP')
    expect(w.text()).toContain('RM350/mo')
  })

  it('renders Mark-done and Dismiss buttons per move', async () => {
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="money-move-done-clear-card-with-aia"]').exists()).toBe(true)
    expect(w.find('[data-test="money-move-dismiss-clear-card-with-aia"]').exists()).toBe(true)
  })

  it('Mark done PATCHes the move status and refreshes', async () => {
    const mockFetch = vi.fn(async () => ({ key: 'clear-card-with-aia', status: 'done' }))
    vi.stubGlobal('$fetch', mockFetch)

    const w = mountDashboard()
    await flushPromises()
    await w.find('[data-test="money-move-done-clear-card-with-aia"]').trigger('click')
    await flushPromises()

    expect(mockFetch).toHaveBeenCalledWith('/api/money-moves/clear-card-with-aia', expect.objectContaining({
      method: 'PATCH',
      body: { status: 'done' },
    }))
    expect(lastRefreshMoneyMoves).toHaveBeenCalled()
  })

  it('Dismiss PATCHes status=dismissed and refreshes', async () => {
    const mockFetch = vi.fn(async () => ({ key: 'pause-ge-ilp', status: 'dismissed' }))
    vi.stubGlobal('$fetch', mockFetch)

    const w = mountDashboard()
    await flushPromises()
    await w.find('[data-test="money-move-dismiss-pause-ge-ilp"]').trigger('click')
    await flushPromises()

    expect(mockFetch).toHaveBeenCalledWith('/api/money-moves/pause-ge-ilp', expect.objectContaining({
      method: 'PATCH',
      body: { status: 'dismissed' },
    }))
    expect(lastRefreshMoneyMoves).toHaveBeenCalled()
  })

  it('shows a quiet "Done" state (no action buttons) for a done move', async () => {
    activeMoneyMoves = [
      { ...mockMoneyMoves[0], status: 'done' as const },
      mockMoneyMoves[1],
    ]
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="money-move-done-badge"]').exists()).toBe(true)
    // Mark-done button is gone in the done state; Undo is shown instead
    expect(w.find('[data-test="money-move-done-clear-card-with-aia"]').exists()).toBe(false)
    expect(w.find('[data-test="money-move-undo-clear-card-with-aia"]').exists()).toBe(true)
  })

  it('hides the money-moves section when no moves are returned', async () => {
    activeMoneyMoves = []
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="money-moves-section"]').exists()).toBe(false)
  })
})

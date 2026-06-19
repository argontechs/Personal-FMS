// test/app/push-ui.test.ts
// Tests for the push-notification UI on the dashboard page:
//   - "enable reminders" card (button calls usePush.enable on click)
//   - subscribed / denied states
//   - iOS non-standalone install hint
//   - reminder-health warning card
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
    incomeCents: 0, livingCents: 0, debtServiceCents: 0,
    interestCents: 0, rawSurplusCents: 0, surplusAfterInterestCents: 0,
  },
  cashNowCents: 100000,
  todayISO: '2026-06-19',
  deltaCashThisMonthCents: 0,
}

const mockDebt = {
  cardBalanceCents: 0, creditLimitCents: 100000, availableCreditCents: 100000,
  utilization: 0, utilWarn: false, utilDecline: false, monthlyInterestCents: 0,
  btStatus: 'none' as const, btRecommendation: 'none' as const,
  payoffProgress: 1, cardFreeISO: '2026-06-19', cardFreeMonths: 0,
}

const mockGoals = {
  ef: { currentCents: 100000, targetCents: 100000, progress: 1 },
  killCard: { currentCents: 0, baselineCents: 100000, progress: 0 },
}

const mockAccounts = [
  { id: 1, type: 'cash', balance_cents: 100000 },
  { id: 2, type: 'bank', balance_cents: 200000 },
  { id: 3, type: 'savings', balance_cents: 100000 },
]

// ─── usePush mock — controllable per-test ─────────────────────────────────────
// We expose a mutable object so each test can dial the exact state it wants.
const mockPushState = {
  permission: ref<NotificationPermission | 'unsupported'>('default'),
  showInstallBanner: ref(false),
  canEnable: ref(true),
  enableResult: { ok: true } as { ok: boolean; reason?: string },
}
const mockEnable = vi.fn(async () => mockPushState.enableResult)

vi.mock('../../app/composables/usePush', () => ({
  usePush: () => ({
    permission: mockPushState.permission,
    showInstallBanner: mockPushState.showInstallBanner,
    canEnable: mockPushState.canEnable,
    isIosNonStandalone: mockPushState.showInstallBanner,
    enable: mockEnable,
  }),
}))

// ─── #app mock ────────────────────────────────────────────────────────────────
vi.mock('#app', () => ({
  useFetch: vi.fn(async (url: string) => {
    if (url === '/api/forecast') return { data: ref(mockForecast), refresh: vi.fn(), error: ref(null) }
    if (url === '/api/debt')     return { data: ref(mockDebt),     refresh: vi.fn(), error: ref(null) }
    if (url === '/api/goals/progress') return { data: ref(mockGoals), refresh: vi.fn(), error: ref(null) }
    if (url === '/api/accounts') return { data: ref(mockAccounts), refresh: vi.fn(), error: ref(null) }
    return { data: ref(null), refresh: vi.fn(), error: ref(null) }
  }),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  definePageMeta: vi.fn(),
  useRoute: vi.fn(() => ({ path: '/', name: 'index', params: {}, query: {}, hash: '' })),
}))

// ─── offline queue mock ───────────────────────────────────────────────────────
vi.mock('../../app/composables/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    enqueue: vi.fn(async (input: any) => ({ ...input, uuid: 'test-uuid' })),
    pending: vi.fn(async () => []),
    flush: vi.fn(async () => ({ flushed: 0, remaining: 0 })),
  }),
  registerAutoFlush: vi.fn(),
}))

import DashboardPage from '../../app/pages/index.vue'

// ─── Mount helper ─────────────────────────────────────────────────────────────
let mountedWrappers: ReturnType<typeof mount>[] = []

function mountDashboard() {
  const div = document.createElement('div')
  document.body.appendChild(div)
  const w = mount(
    defineComponent({ render() { return h(Suspense, null, { default: () => h(DashboardPage) }) } }),
    { attachTo: div },
  )
  mountedWrappers.push(w)
  return w
}

beforeEach(() => {
  // Reset to default (not-yet-subscribed, non-iOS) state
  mockPushState.permission.value = 'default'
  mockPushState.showInstallBanner.value = false
  mockPushState.canEnable.value = true
  mockPushState.enableResult = { ok: true }
  mockEnable.mockClear()

  // Default $fetch: health push returns healthy; no other calls needed
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url === '/api/health/push') return { healthySubscriptions: 1, channelOk: true }
    return {}
  }))
})

afterEach(() => {
  for (const w of mountedWrappers) w.unmount()
  mountedWrappers = []
  document.body.querySelectorAll('[role="dialog"]').forEach(el => el.remove())
})

// ─── Enable reminders card ────────────────────────────────────────────────────
describe('Enable reminders card', () => {
  it('shows the enable-reminders card when permission is "default"', async () => {
    mockPushState.permission.value = 'default'
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="enable-reminders"]').exists()).toBe(true)
  })

  it('clicking the button calls enable() — user gesture', async () => {
    mockPushState.permission.value = 'default'
    const w = mountDashboard()
    await flushPromises()
    const btn = w.find('[data-test="enable-reminders"] button[type="button"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    await flushPromises()
    expect(mockEnable).toHaveBeenCalledTimes(1)
  })

  it('shows "reminders are on" indicator after successful subscribe', async () => {
    mockPushState.permission.value = 'default'
    mockPushState.enableResult = { ok: true }
    const w = mountDashboard()
    await flushPromises()
    await w.find('[data-test="enable-reminders"] button[type="button"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="reminders-on"]').exists()).toBe(true)
    expect(w.find('[data-test="enable-reminders"]').exists()).toBe(false)
  })

  it('shows blocked message when permission is denied', async () => {
    mockPushState.permission.value = 'denied'
    const w = mountDashboard()
    await flushPromises()
    const card = w.find('[data-test="enable-reminders"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('blocked')
    expect(card.text()).toContain('browser settings')
  })

  it('shows blocked message when enable() returns denied', async () => {
    mockPushState.permission.value = 'default'
    mockPushState.enableResult = { ok: false, reason: 'denied' }
    const w = mountDashboard()
    await flushPromises()
    await w.find('[data-test="enable-reminders"] button[type="button"]').trigger('click')
    await flushPromises()
    const card = w.find('[data-test="enable-reminders"]')
    expect(card.text()).toContain('blocked')
  })

  it('hides the card when permission is already "granted"', async () => {
    mockPushState.permission.value = 'granted'
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="enable-reminders"]').exists()).toBe(false)
    expect(w.find('[data-test="reminders-on"]').exists()).toBe(true)
  })

  it('hides the card when push is unsupported', async () => {
    mockPushState.permission.value = 'unsupported'
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="enable-reminders"]').exists()).toBe(false)
    expect(w.find('[data-test="install-hint"]').exists()).toBe(false)
  })
})

// ─── iOS install hint ─────────────────────────────────────────────────────────
describe('iOS install hint', () => {
  it('shows install hint when showInstallBanner is true (iOS non-standalone)', async () => {
    mockPushState.showInstallBanner.value = true
    mockPushState.permission.value = 'default'
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="install-hint"]').exists()).toBe(true)
    expect(w.find('[data-test="install-hint"]').text()).toContain('Add to Home Screen')
  })

  it('does NOT show install hint when not on iOS (showInstallBanner false)', async () => {
    mockPushState.showInstallBanner.value = false
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="install-hint"]').exists()).toBe(false)
  })

  it('hides the enable button when install hint is showing', async () => {
    mockPushState.showInstallBanner.value = true
    mockPushState.permission.value = 'default'
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="enable-reminders"]').exists()).toBe(false)
  })
})

// ─── Reminder health warning ──────────────────────────────────────────────────
describe('Reminder health warning', () => {
  it('shows a warning card when channelOk is false and push is granted', async () => {
    mockPushState.permission.value = 'granted'
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/health/push') return { healthySubscriptions: 0, channelOk: false }
      return {}
    }))
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="push-health-warn"]').exists()).toBe(true)
    expect(w.find('[data-test="push-health-warn"]').text()).toContain('Re-enable')
  })

  it('does NOT show the health warning when channelOk is true', async () => {
    mockPushState.permission.value = 'granted'
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/health/push') return { healthySubscriptions: 1, channelOk: true }
      return {}
    }))
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="push-health-warn"]').exists()).toBe(false)
  })

  it('does NOT show the health warning when reminders are not yet enabled', async () => {
    // permission = 'default' means reminders-on is hidden → health warn hidden too
    mockPushState.permission.value = 'default'
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/health/push') return { healthySubscriptions: 0, channelOk: false }
      return {}
    }))
    const w = mountDashboard()
    await flushPromises()
    expect(w.find('[data-test="push-health-warn"]').exists()).toBe(false)
  })
})

// test/app/trends.test.ts
// Trends page component tests — mounts in happy-dom, stubs /api/trends.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, Suspense, ref } from 'vue'

// ── Fixtures ──────────────────────────────────────────────────────────────────
const mockTrends = {
  todayISO: '2026-06-19',
  windowDays: 180,
  windowMonths: 4,
  series: [
    { date: '2026-06-17', netWorthCents: 5800000, totalDebtCents: 880000, cardBalanceCents: 740076, efBalanceCents: 40000, liquidCents: 300000 },
    { date: '2026-06-18', netWorthCents: 5850000, totalDebtCents: 870000, cardBalanceCents: 730000, efBalanceCents: 42000, liquidCents: 302000 },
    { date: '2026-06-19', netWorthCents: 5893020, totalDebtCents: 864277, cardBalanceCents: 720000, efBalanceCents: 45000, liquidCents: 305000 },
  ],
  spendByCategory: [
    { category: 'food', amountCents: 45000 },
    { category: 'transport', amountCents: 18000 },
  ],
}

const mockTrendsEmpty = {
  todayISO: '2026-06-19',
  windowDays: 180,
  windowMonths: 4,
  series: [],
  spendByCategory: [],
}

let activeTrends: typeof mockTrends | typeof mockTrendsEmpty | null = mockTrends
let fetchShouldError = false

// ── #app mock ─────────────────────────────────────────────────────────────────
vi.mock('#app', () => ({
  useFetch: vi.fn(async (url: string) => {
    if (url === '/api/trends') {
      if (fetchShouldError) return { data: ref(null), error: ref(new Error('Network error')) }
      return { data: ref(activeTrends), error: ref(null) }
    }
    return { data: ref(null), error: ref(null) }
  }),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  definePageMeta: vi.fn(),
  useRoute: vi.fn(() => ({ path: '/trends', name: 'trends', params: {}, query: {}, hash: '' })),
}))

import TrendsPage from '../../app/pages/trends.vue'

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, default: '' } },
  template: '<a :href="to"><slot /></a>',
}

function mountTrends() {
  return mount(
    defineComponent({
      render() { return h(Suspense, null, { default: () => h(TrendsPage) }) },
    }),
    { global: { stubs: { NuxtLink: NuxtLinkStub } } },
  )
}

beforeEach(() => {
  activeTrends = mockTrends
  fetchShouldError = false
  vi.clearAllMocks()
})

describe('Trends page', () => {
  it('renders the trend charts when there is data', async () => {
    const w = mountTrends()
    await flushPromises()
    expect(w.find('[data-testid="trends-charts"]').exists()).toBe(true)
    expect(w.find('[data-testid="trends-line"]').exists()).toBe(true)
    expect(w.text()).toContain('Food')
  })

  it('renders the empty state when there are <2 data points', async () => {
    activeTrends = mockTrendsEmpty
    const w = mountTrends()
    await flushPromises()
    expect(w.find('[data-testid="trends-empty"]').exists()).toBe(true)
    expect(w.text()).toContain('Trends build up as you use the app')
  })

  it('shows an error message when the API fails', async () => {
    fetchShouldError = true
    const w = mountTrends()
    await flushPromises()
    expect(w.text()).toContain('Failed to load trends')
  })

  it('renders a back link to the goals screen', async () => {
    const w = mountTrends()
    await flushPromises()
    const back = w.find('a[href="/goals"]')
    expect(back.exists()).toBe(true)
  })
})

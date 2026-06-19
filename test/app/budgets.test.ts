// test/app/budgets.test.ts
// Budgets page unit tests — mounts the page in happy-dom, stubs useFetch.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, Suspense, ref } from 'vue'

// ─── #app mock ─────────────────────────────────────────────────────────────
vi.mock('#app', () => ({
  useFetch: vi.fn(async () => ({ data: ref(null), refresh: vi.fn() })),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  definePageMeta: vi.fn(),
  useRoute: vi.fn(() => ({ path: '/budgets', name: 'budgets', params: {}, query: {}, hash: '' })),
}))

import BudgetsPage from '../../app/pages/budgets.vue'
import { useFetch } from '#app'

// ─── Fixture data ──────────────────────────────────────────────────────────
const ALL_CATEGORIES = ['food', 'transport', 'fuel', 'groceries', 'shopping', 'bills', 'other']

function makeRows(overrides: Record<string, Partial<{ limit_cents: number | null; spent_cents: number }>> = {}) {
  return ALL_CATEGORIES.map(cat => ({
    category: cat,
    limit_cents: overrides[cat]?.limit_cents ?? null,
    spent_cents: overrides[cat]?.spent_cents ?? 0,
  }))
}

// food: 96% → near limit
// groceries: over budget
// bills: null → no budget set
const mockRows = makeRows({
  food:      { limit_cents: 50000, spent_cents: 48000 },  // 96% — near limit
  transport: { limit_cents: 30000, spent_cents: 10000 },  // 33% — normal
  fuel:      { limit_cents: 20000, spent_cents: 5000  },  // 25% — normal
  groceries: { limit_cents: 30000, spent_cents: 35000 },  // over budget
  shopping:  { limit_cents: 15000, spent_cents: 14000 },  // 93% — near limit
  bills:     { limit_cents: null,  spent_cents: 0     },  // no budget
  other:     { limit_cents: 10000, spent_cents: 2000  },  // 20% — normal
})

// ─── Mount helper ──────────────────────────────────────────────────────────
function mountBudgets(rows = mockRows) {
  vi.mocked(useFetch).mockResolvedValue({ data: ref(rows), refresh: vi.fn() } as any)
  vi.stubGlobal('$fetch', vi.fn(async () => ({})))

  return mount(
    defineComponent({
      render() { return h(Suspense, null, { default: () => h(BudgetsPage) }) },
    }),
    { attachTo: document.body },
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── Tests ─────────────────────────────────────────────────────────────────
describe('Budgets page', () => {

  describe('category rows', () => {
    it('renders all 7 categories', async () => {
      const w = mountBudgets()
      await flushPromises()

      for (const cat of ALL_CATEGORIES) {
        expect(w.find(`[data-testid="budget-row-${cat}"]`).exists()).toBe(true)
      }
    })
  })

  describe('near-limit warning', () => {
    it('food at 96% shows --warning bar and "near limit" text', async () => {
      const w = mountBudgets()
      await flushPromises()

      const foodRow = w.find('[data-testid="budget-row-food"]')
      expect(foodRow.exists()).toBe(true)

      // Progress bar has fill--warn class
      const fill = foodRow.find('.budgets__fill')
      expect(fill.classes()).toContain('fill--warn')

      // Status text contains "near limit"
      const status = foodRow.find('[data-testid="budget-status-food"]')
      expect(status.text()).toContain('near limit')
    })
  })

  describe('over-budget warning', () => {
    it('groceries (over budget) shows --negative bar and "Over by RM" text', async () => {
      const w = mountBudgets()
      await flushPromises()

      const grocRow = w.find('[data-testid="budget-row-groceries"]')
      const fill = grocRow.find('.budgets__fill')
      expect(fill.classes()).toContain('fill--over')

      const status = grocRow.find('[data-testid="budget-status-groceries"]')
      expect(status.text()).toContain('Over by RM')
    })
  })

  describe('no budget set', () => {
    it('bills with no limit shows "No budget set" and a "Set budget" button', async () => {
      const w = mountBudgets()
      await flushPromises()

      const billsRow = w.find('[data-testid="budget-row-bills"]')
      expect(billsRow.text()).toContain('No budget set')
      expect(billsRow.find('.budgets__set-btn').exists()).toBe(true)
    })
  })

  describe('accessibility', () => {
    it('all progress bars have role="progressbar" and aria-valuemax="100"', async () => {
      const w = mountBudgets()
      await flushPromises()

      const progressBars = w.findAll('[role="progressbar"]')
      // 6 categories have limits (bills has none)
      expect(progressBars.length).toBe(6)
      for (const bar of progressBars) {
        expect(bar.attributes('aria-valuemax')).toBe('100')
        expect(bar.attributes('aria-valuemin')).toBe('0')
      }
    })
  })

  describe('empty state', () => {
    it('shows empty state when all categories have no budget', async () => {
      const emptyRows = makeRows() // all limit_cents: null
      const w = mountBudgets(emptyRows)
      await flushPromises()
      expect(w.find('[data-testid="empty-state"]').exists()).toBe(true)
      expect(w.text()).toContain('No budgets set yet')
    })
  })
})

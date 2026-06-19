// test/app/activity.test.ts
// Activity page unit tests — mounts the page in happy-dom, stubs $fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, Suspense } from 'vue'

// ─── #app mock ────────────────────────────────────────────────────────────────
vi.mock('#app', () => ({
  useFetch: vi.fn(async () => ({ data: { value: null }, refresh: vi.fn() })),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  definePageMeta: vi.fn(),
  useRoute: vi.fn(() => ({ path: '/activity', name: 'activity', params: {}, query: {}, hash: '' })),
}))

// Import AFTER mocks (Vitest hoists vi.mock)
import ActivityPage from '../../app/pages/activity.vue'

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeTxn = (overrides: Partial<{
  id: number; uuid: string; date: string; amount_cents: number;
  direction: string; category: string; account_id: number;
  counter_account_id: null; debt_id: null; goal_id: null;
  note: string | null; source: string; is_estimate: boolean;
}> = {}) => ({
  id: 1,
  uuid: 'aaaa-1111',
  date: '2026-06-19',
  amount_cents: -1250,
  direction: 'expense',
  category: 'food',
  account_id: 1,
  counter_account_id: null,
  debt_id: null,
  goal_id: null,
  note: null,
  source: 'manual',
  is_estimate: false,
  ...overrides,
})

// Three transactions across two dates — tests grouping + ordering
const mockTransactions = [
  makeTxn({ id: 1, date: '2026-06-19', amount_cents: -1250, category: 'food', note: 'Lunch' }),
  makeTxn({ id: 2, date: '2026-06-18', amount_cents: -5000, category: 'transport', note: null }),
  makeTxn({ id: 3, date: '2026-06-18', amount_cents: 200000, direction: 'income', category: 'other', note: null }),
]

// System-category rows — should be filtered out
const withSystemRows = [
  ...mockTransactions,
  makeTxn({ id: 10, date: '2026-06-19', amount_cents: 100000, category: 'adjustment', direction: 'income' }),
  makeTxn({ id: 11, date: '2026-06-19', amount_cents: -200000, category: 'transfer', direction: 'expense' }),
]

// ─── Helper: mount with a given $fetch response ───────────────────────────────
function mountActivity(fetchImpl?: (url: string, opts?: any) => any) {
  vi.stubGlobal('$fetch', vi.fn(fetchImpl ?? (async (url: string) => {
    if (url.startsWith('/api/transactions')) return mockTransactions
    return []
  })))

  return mount(
    defineComponent({
      render() { return h(Suspense, null, { default: () => h(ActivityPage) }) },
    }),
    { attachTo: document.body },
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Activity page', () => {

  // ── Empty state ─────────────────────────────────────────────────────────────
  describe('empty state', () => {
    it('shows empty state when there are no transactions', async () => {
      const w = mountActivity(async () => [])
      await flushPromises()
      expect(w.find('[data-testid="empty-state"]').exists()).toBe(true)
      expect(w.text()).toContain('No spending logged yet')
      expect(w.text()).toContain('+ on Home')
    })

    it('does not show empty state when transactions exist', async () => {
      const w = mountActivity()
      await flushPromises()
      expect(w.find('[data-testid="empty-state"]').exists()).toBe(false)
    })
  })

  // ── List rendering + grouping ────────────────────────────────────────────────
  describe('list rendering', () => {
    it('renders rows grouped by date with date headers', async () => {
      const w = mountActivity()
      await flushPromises()

      // Two distinct date groups
      const headers = w.findAll('.section-label')
      expect(headers.length).toBeGreaterThanOrEqual(2)

      // All three transactions rendered
      const rows = w.findAll('[role="listitem"]')
      expect(rows.length).toBe(3)
    })

    it('renders CategoryIcon for each row', async () => {
      const w = mountActivity()
      await flushPromises()

      // Each list row has a list-row__icon span (which wraps CategoryIcon)
      const icons = w.findAll('.list-row__icon')
      expect(icons.length).toBe(3)
    })

    it('shows expense amounts as -RMx.xx with --expense class', async () => {
      const w = mountActivity()
      await flushPromises()

      const amounts = w.findAll('.list-row__amount')
      // id:1 → -RM12.50 (expense)
      const expenseAmt = amounts.find(a => a.text().includes('-RM12.50'))
      expect(expenseAmt).toBeTruthy()
      expect(expenseAmt!.classes()).toContain('list-row__amount--expense')
    })

    it('shows income amounts as +RMx.xx with --income class', async () => {
      const w = mountActivity()
      await flushPromises()

      const amounts = w.findAll('.list-row__amount')
      // id:3 → +RM2000.00 (income)
      const incomeAmt = amounts.find(a => a.text().includes('+RM2,000.00') || a.text().includes('+RM2000.00'))
      expect(incomeAmt).toBeTruthy()
      expect(incomeAmt!.classes()).toContain('list-row__amount--income')
    })

    it('shows the note when present', async () => {
      const w = mountActivity()
      await flushPromises()
      expect(w.text()).toContain('Lunch')
    })

    it('groups newest date first (2026-06-19 before 2026-06-18)', async () => {
      const w = mountActivity()
      await flushPromises()
      const html = w.html()
      const pos19 = html.indexOf('19 Jun')
      const pos18 = html.indexOf('18 Jun')
      expect(pos19).toBeGreaterThan(-1)
      expect(pos18).toBeGreaterThan(-1)
      expect(pos19).toBeLessThan(pos18) // 19 Jun header appears before 18 Jun header
    })
  })

  // ── Category label casing ────────────────────────────────────────────────────
  describe('category labels', () => {
    it("income row shows 'Income' (capitalised) not the raw key 'income'", async () => {
      const incomeTxn = makeTxn({
        id: 30,
        date: '2026-06-19',
        amount_cents: 500000,
        direction: 'income',
        category: 'income',
        note: null,
      })
      const w = mountActivity(async (url: string) => {
        if (url.startsWith('/api/transactions')) return [incomeTxn]
        return []
      })
      await flushPromises()

      const rows = w.findAll('.list-row__name')
      expect(rows.length).toBe(1)
      expect(rows[0].text()).toBe('Income')
      // Must NOT show the raw lowercase key
      expect(w.html()).not.toContain('>income<')
    })

    it('note is shown as subtitle when present on any row type', async () => {
      const incomeTxn = makeTxn({
        id: 31,
        date: '2026-06-19',
        amount_cents: 230000,
        direction: 'income',
        category: 'income',
        note: 'Salary June',
      })
      const w = mountActivity(async (url: string) => {
        if (url.startsWith('/api/transactions')) return [incomeTxn]
        return []
      })
      await flushPromises()
      expect(w.text()).toContain('Salary June')
      expect(w.find('.list-row__note').exists()).toBe(true)
    })

    it('does NOT show an empty subtitle when note is null', async () => {
      const txn = makeTxn({ id: 32, date: '2026-06-19', amount_cents: -500, category: 'food', note: null })
      const w = mountActivity(async (url: string) => {
        if (url.startsWith('/api/transactions')) return [txn]
        return []
      })
      await flushPromises()
      // note span should not exist
      expect(w.find('.list-row__note').exists()).toBe(false)
    })
  })

  // ── System-row filtering ─────────────────────────────────────────────────────
  describe('system-row filter', () => {
    it('hides rows with system categories (adjustment, transfer)', async () => {
      const w = mountActivity(async (url: string) => {
        if (url.startsWith('/api/transactions')) return withSystemRows
        return []
      })
      await flushPromises()

      // Only 3 user rows visible; adjustment and transfer rows hidden
      const rows = w.findAll('[role="listitem"]')
      expect(rows.length).toBe(3)

      // None of the rows show "adjustment" or "transfer" text
      const text = w.text()
      expect(text).not.toContain('adjustment')
      expect(text).not.toContain('transfer')
    })

    it('does NOT filter out income category rows — they must be visible', async () => {
      const incomeTxn = makeTxn({
        id: 20,
        date: '2026-06-19',
        amount_cents: 500000,  // +RM5000
        direction: 'income',
        category: 'income',
        note: 'Salary',
      })
      const w = mountActivity(async (url: string) => {
        if (url.startsWith('/api/transactions')) return [incomeTxn]
        return []
      })
      await flushPromises()

      const rows = w.findAll('[role="listitem"]')
      expect(rows.length).toBe(1)

      // Amount shows as positive green
      const amounts = w.findAll('.list-row__amount')
      expect(amounts.length).toBe(1)
      expect(amounts[0].classes()).toContain('list-row__amount--income')
      expect(amounts[0].text()).toContain('+RM5,000.00')
    })

    it('manually-logged income row renders as green +RM amount', async () => {
      const incomeTxn = makeTxn({
        id: 21,
        date: '2026-06-19',
        amount_cents: 150000,  // +RM1500
        direction: 'income',
        category: 'income',
        source: 'manual',
        note: 'Side gig',
      })
      const w = mountActivity(async (url: string) => {
        if (url.startsWith('/api/transactions')) return [incomeTxn]
        return []
      })
      await flushPromises()

      const amounts = w.findAll('.list-row__amount')
      expect(amounts[0].classes()).toContain('list-row__amount--income')
      expect(amounts[0].text()).toMatch(/\+RM1[,.]?500\.00/)

      // Note visible
      expect(w.text()).toContain('Side gig')
    })
  })

  // ── Delete + undo ────────────────────────────────────────────────────────────
  describe('delete + undo', () => {
    it('calls DELETE and shows undo toast when delete button is clicked', async () => {
      const fetchMock = vi.fn(async (url: string, opts?: any) => {
        if (opts?.method === 'DELETE') return { ok: true }
        if (url.startsWith('/api/transactions')) return mockTransactions
        return []
      })
      vi.stubGlobal('$fetch', fetchMock)

      const w = mountActivity(() => {}) // override below
      vi.stubGlobal('$fetch', fetchMock)
      await flushPromises()

      // Re-mount cleanly with our mock
      w.unmount()
      const w2 = mountActivity(async (url: string, opts?: any) => {
        if (opts?.method === 'DELETE') return { ok: true }
        if (url.startsWith('/api/transactions')) return [...mockTransactions]
        return []
      })
      await flushPromises()

      const deleteBtn = w2.find('.list-row__delete')
      expect(deleteBtn.exists()).toBe(true)
      await deleteBtn.trigger('click')
      await flushPromises()

      // DELETE called
      const calls = (globalThis.$fetch as any).mock.calls
      const deleteCall = calls.find((c: any[]) => c[1]?.method === 'DELETE')
      expect(deleteCall).toBeTruthy()
      expect(deleteCall[0]).toMatch(/\/api\/transactions\/\d+/)

      // Undo toast visible
      expect(w2.find('[data-testid="undo-toast"]').exists()).toBe(true)
      expect(w2.text()).toContain('Transaction deleted')
      expect(w2.text()).toContain('Undo')
    })

    it('undo re-adds the transaction via POST', async () => {
      const fetchMock = vi.fn(async (url: string, opts?: any) => {
        if (opts?.method === 'DELETE') return { ok: true }
        if (opts?.method === 'POST') return { id: 99 }
        if (url.startsWith('/api/transactions')) return [...mockTransactions]
        return []
      })
      vi.stubGlobal('$fetch', fetchMock)

      const w = mountActivity(async (url: string, opts?: any) => {
        if (opts?.method === 'DELETE') return { ok: true }
        if (opts?.method === 'POST') return { id: 99 }
        if (url.startsWith('/api/transactions')) return [...mockTransactions]
        return []
      })
      await flushPromises()

      // Delete first row
      await w.find('.list-row__delete').trigger('click')
      await flushPromises()

      // Click Undo
      const undoBtn = w.find('.activity__toast-undo')
      expect(undoBtn.exists()).toBe(true)
      await undoBtn.trigger('click')
      await flushPromises()

      // POST called for undo
      const calls = (globalThis.$fetch as any).mock.calls
      const postCall = calls.find((c: any[]) => c[1]?.method === 'POST' && c[0] === '/api/transactions')
      expect(postCall).toBeTruthy()
      // New uuid generated (not the same as original)
      expect(postCall[1].body.uuid).toBeTruthy()
      expect(typeof postCall[1].body.uuid).toBe('string')
    })

    it('undo double-post guard: tapping Undo twice produces exactly one POST', async () => {
      // Track all POST calls to /api/transactions
      let postCount = 0
      const w = mountActivity(async (url: string, opts?: any) => {
        if (opts?.method === 'DELETE') return { ok: true }
        if (opts?.method === 'POST' && url === '/api/transactions') {
          postCount++
          return { id: 50 }
        }
        if (url.startsWith('/api/transactions')) return [...mockTransactions]
        return []
      })
      await flushPromises()

      // Delete the first row to get the undo toast
      await w.find('.list-row__delete').trigger('click')
      await flushPromises()

      const undoBtn = w.find('.activity__toast-undo')
      expect(undoBtn.exists()).toBe(true)

      // Tap Undo twice in rapid succession — second tap must be a no-op
      await undoBtn.trigger('click')
      await undoBtn.trigger('click')
      await flushPromises()

      // Exactly one POST must have been issued despite two taps
      expect(postCount).toBe(1)
    })
  })

  // ── Edit sheet ───────────────────────────────────────────────────────────────
  // The edit sheet is rendered via <Teleport to="body">, so elements live outside the
  // Vue wrapper's subtree. Query them via document.querySelector / document.body.
  describe('edit sheet', () => {
    afterEach(() => {
      // Cleanup any teleported sheets left over between tests
      document.querySelectorAll('.edit-overlay').forEach(el => el.remove())
    })

    it('opens the edit sheet when a row is tapped', async () => {
      const w = mountActivity()
      await flushPromises()

      expect(document.querySelector('[data-testid="edit-sheet"]')).toBeNull()
      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()
      expect(document.querySelector('[data-testid="edit-sheet"]')).not.toBeNull()
    })

    it('pre-populates edit fields with the transaction values', async () => {
      const w = mountActivity()
      await flushPromises()

      // First row: food, -1250 cents, date 2026-06-19
      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()

      const amountInput = document.querySelector('#edit-amount') as HTMLInputElement | null
      expect(amountInput).not.toBeNull()
      expect(amountInput!.value).toBe('12.50')

      const dateInput = document.querySelector('#edit-date') as HTMLInputElement | null
      expect(dateInput).not.toBeNull()
      expect(dateInput!.value).toBe('2026-06-19')

      // Active category chip should be 'food'
      const foodChip = document.querySelector('[data-test="edit-cat-food"]')
      expect(foodChip?.classList.contains('edit-sheet__chip--active')).toBe(true)
    })

    it('calls PATCH on save and closes the sheet', async () => {
      const patchResult = makeTxn({ id: 1, amount_cents: -2000, category: 'transport', date: '2026-06-19' })

      const w = mountActivity(async (url: string, opts?: any) => {
        if (opts?.method === 'PATCH') return patchResult
        if (url.startsWith('/api/transactions')) return [...mockTransactions]
        return []
      })
      await flushPromises()

      // Open edit sheet
      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()

      // Update amount via native input event (Teleport renders outside wrapper)
      const amountInput = document.querySelector('#edit-amount') as HTMLInputElement
      amountInput.value = '20.00'
      amountInput.dispatchEvent(new Event('input', { bubbles: true }))
      await w.vm.$nextTick()

      // Select transport category
      const transportChip = document.querySelector('[data-test="edit-cat-transport"]') as HTMLElement
      transportChip.click()
      await w.vm.$nextTick()

      // Save
      const saveBtn = document.querySelector('.edit-sheet__save') as HTMLElement
      saveBtn.click()
      await flushPromises()

      // PATCH called
      const calls = (globalThis.$fetch as any).mock.calls
      const patchCall = calls.find((c: any[]) => c[1]?.method === 'PATCH')
      expect(patchCall).toBeTruthy()
      expect(patchCall[0]).toMatch(/\/api\/transactions\/1/)
      expect(patchCall[1].body.category).toBe('transport')

      // Sheet closed
      expect(document.querySelector('[data-testid="edit-sheet"]')).toBeNull()
    })

    it('shows validation error when amount is zero or negative', async () => {
      const w = mountActivity()
      await flushPromises()

      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()

      // Set invalid amount via native event
      const amountInput = document.querySelector('#edit-amount') as HTMLInputElement
      amountInput.value = '0'
      amountInput.dispatchEvent(new Event('input', { bubbles: true }))
      await w.vm.$nextTick()

      const saveBtn = document.querySelector('.edit-sheet__save') as HTMLElement
      saveBtn.click()
      await w.vm.$nextTick()

      // Error message visible inside the teleported sheet
      const sheet = document.querySelector('[data-testid="edit-sheet"]')
      expect(sheet).not.toBeNull()
      expect(sheet!.textContent).toContain('Enter a positive amount')
    })

    it('closes the sheet when Cancel is clicked', async () => {
      const w = mountActivity()
      await flushPromises()

      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()
      expect(document.querySelector('[data-testid="edit-sheet"]')).not.toBeNull()

      const cancelBtn = document.querySelector('.edit-sheet__cancel') as HTMLElement
      cancelBtn.click()
      await w.vm.$nextTick()
      expect(document.querySelector('[data-testid="edit-sheet"]')).toBeNull()
    })
  })

  // ── Month switcher ───────────────────────────────────────────────────────────
  describe('month switcher', () => {
    it('renders a month label in the header', async () => {
      const w = mountActivity()
      await flushPromises()
      // Should show a month/year label (e.g. "June 2026")
      expect(w.find('.activity__month-label').text()).toMatch(/\w+ \d{4}/)
    })

    it('disables the next-month button when on current month', async () => {
      const w = mountActivity()
      await flushPromises()
      const nextBtn = w.find('[aria-label="Next month"]')
      expect(nextBtn.attributes('disabled')).toBeDefined()
    })

    it('enables next-month button after going back one month', async () => {
      const w = mountActivity()
      await flushPromises()

      await w.find('[aria-label="Previous month"]').trigger('click')
      await flushPromises()

      const nextBtn = w.find('[aria-label="Next month"]')
      expect(nextBtn.attributes('disabled')).toBeUndefined()
    })
  })
})

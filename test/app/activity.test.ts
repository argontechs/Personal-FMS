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
import { useFetch } from '#app'

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
  // activity.vue now `await useFetch('/api/accounts')` — after resetAllMocks the mock returns
  // undefined, which would break the `const { data } = await useFetch(...)` destructure. Restore a
  // safe default (no accounts → picker hidden) so existing tests are unaffected. Tests that need a
  // populated picker override useFetch themselves.
  vi.mocked(useFetch).mockResolvedValue({ data: { value: null }, refresh: vi.fn() } as any)
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

  // ── System-row read-only guard (ledger-corruption prevention) ────────────────
  // Interest rows (category 'interest', POSITIVE amount, debt_id) and debt-payment rows
  // (debt_id) must stay VISIBLE as history but carry NO edit handler and NO delete button.
  describe('system-row read-only guard', () => {
    it('a card-INTEREST row (category interest, positive, debt_id) is VISIBLE but NOT editable/deletable', async () => {
      const interestTxn = makeTxn({
        id: 70,
        date: '2026-06-19',
        amount_cents: 4500, // POSITIVE — debt-grows convention
        direction: 'expense',
        category: 'interest' as any,
        debt_id: 3 as any,
        source: 'auto',
        note: 'Card interest',
      })
      const w = mountActivity(async (url: string) => {
        if (url.startsWith('/api/transactions')) return [interestTxn]
        return []
      })
      await flushPromises()

      // Still rendered as history.
      expect(w.findAll('[role="listitem"]').length).toBe(1)
      expect(w.text()).toContain('Interest')

      // It must render as the read-only variant, NOT the editable button.
      expect(w.find('[data-test="row-readonly"]').exists()).toBe(true)
      expect(w.find('[data-test="row-editable"]').exists()).toBe(false)

      // No edit-opening button (list-row__main button) and no delete button.
      expect(w.find('button.list-row__main').exists()).toBe(false)
      expect(w.find('.list-row__delete').exists()).toBe(false)

      // Tapping the row must NOT open the edit sheet.
      await w.find('[data-test="row-readonly"]').trigger('click')
      await w.vm.$nextTick()
      expect(document.querySelector('[data-testid="edit-sheet"]')).toBeNull()
    })

    it('a DEBT-PAYMENT row (debt_id set) is VISIBLE but NOT editable/deletable', async () => {
      const debtTxn = makeTxn({
        id: 71,
        date: '2026-06-19',
        amount_cents: -30000, // a payment leg
        direction: 'expense',
        category: 'debt' as any,
        debt_id: 5 as any,
        source: 'manual',
        note: 'Card payment',
      })
      const w = mountActivity(async (url: string) => {
        if (url.startsWith('/api/transactions')) return [debtTxn]
        return []
      })
      await flushPromises()

      expect(w.findAll('[role="listitem"]').length).toBe(1)
      expect(w.find('[data-test="row-readonly"]').exists()).toBe(true)
      expect(w.find('[data-test="row-editable"]').exists()).toBe(false)
      expect(w.find('button.list-row__main').exists()).toBe(false)
      expect(w.find('.list-row__delete').exists()).toBe(false)
    })

    it('a normal user spend + a user income ARE editable (button + delete present)', async () => {
      const w = mountActivity(async (url: string) => {
        if (url.startsWith('/api/transactions')) return [
          makeTxn({ id: 80, date: '2026-06-19', amount_cents: -1200, direction: 'expense', category: 'food' }),
          makeTxn({ id: 81, date: '2026-06-19', amount_cents: 200000, direction: 'income', category: 'income' }),
        ]
        return []
      })
      await flushPromises()

      // Both rows editable: two editable buttons + two delete buttons, zero read-only rows.
      expect(w.findAll('[data-test="row-editable"]').length).toBe(2)
      expect(w.findAll('[data-test="row-readonly"]').length).toBe(0)
      expect(w.findAll('.list-row__delete').length).toBe(2)
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

    // ── Direction-aware edit (ledger-corruption regression) ────────────────────
    it('editing an income amount keeps it income: PATCH sends positive amount + direction=income + category=income', async () => {
      const incomeTxn = makeTxn({
        id: 40,
        date: '2026-06-19',
        amount_cents: 200000, // +RM2000
        direction: 'income',
        category: 'income',
        note: 'Salary',
      })
      // Server echoes back a correctly-signed income row.
      const patchResult = makeTxn({
        id: 40,
        amount_cents: 250000,
        direction: 'income',
        category: 'income',
        date: '2026-06-19',
        note: 'Salary',
      })

      const w = mountActivity(async (url: string, opts?: any) => {
        if (opts?.method === 'PATCH') return patchResult
        if (url.startsWith('/api/transactions')) return [incomeTxn]
        return []
      })
      await flushPromises()

      // Open edit sheet on the income row
      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()

      // Income rows must NOT show the spend-category picker — they show the Income badge.
      expect(document.querySelector('[data-test="edit-income-badge"]')).not.toBeNull()
      expect(document.querySelector('[data-test="edit-cat-food"]')).toBeNull()

      // Change the amount to RM2500
      const amountInput = document.querySelector('#edit-amount') as HTMLInputElement
      amountInput.value = '2500.00'
      amountInput.dispatchEvent(new Event('input', { bubbles: true }))
      await w.vm.$nextTick()

      // Save
      ;(document.querySelector('.edit-sheet__save') as HTMLElement).click()
      await flushPromises()

      // PATCH body must keep it income: positive amount, direction=income, category=income
      const calls = (globalThis.$fetch as any).mock.calls
      const patchCall = calls.find((c: any[]) => c[1]?.method === 'PATCH')
      expect(patchCall).toBeTruthy()
      expect(patchCall[1].body.amount_cents).toBe(250000) // POSITIVE, not negated
      expect(patchCall[1].body.direction).toBe('income')
      expect(patchCall[1].body.category).toBe('income')

      // The row still renders as income (+RM, green)
      const amounts = w.findAll('.list-row__amount')
      expect(amounts[0].classes()).toContain('list-row__amount--income')
      expect(amounts[0].text()).toMatch(/\+RM2[,.]?500\.00/)
    })

    it('editing an expense amount keeps it expense: PATCH sends negative amount + direction=expense', async () => {
      const patchResult = makeTxn({ id: 1, amount_cents: -3000, category: 'food', direction: 'expense', date: '2026-06-19' })

      const w = mountActivity(async (url: string, opts?: any) => {
        if (opts?.method === 'PATCH') return patchResult
        if (url.startsWith('/api/transactions')) return [makeTxn({ id: 1, amount_cents: -1250, category: 'food', direction: 'expense' })]
        return []
      })
      await flushPromises()

      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()

      // Expense rows show the spend picker, not the income badge.
      expect(document.querySelector('[data-test="edit-cat-food"]')).not.toBeNull()
      expect(document.querySelector('[data-test="edit-income-badge"]')).toBeNull()

      const amountInput = document.querySelector('#edit-amount') as HTMLInputElement
      amountInput.value = '30.00'
      amountInput.dispatchEvent(new Event('input', { bubbles: true }))
      await w.vm.$nextTick()

      ;(document.querySelector('.edit-sheet__save') as HTMLElement).click()
      await flushPromises()

      const calls = (globalThis.$fetch as any).mock.calls
      const patchCall = calls.find((c: any[]) => c[1]?.method === 'PATCH')
      expect(patchCall).toBeTruthy()
      expect(patchCall[1].body.amount_cents).toBe(-3000) // NEGATIVE
      expect(patchCall[1].body.direction).toBe('expense')
      expect(patchCall[1].body.category).toBe('food')

      const amounts = w.findAll('.list-row__amount')
      expect(amounts[0].classes()).toContain('list-row__amount--expense')
      expect(amounts[0].text()).toContain('-RM30.00')
    })

    it('saving an income edit does NOT require a spend category (no validation error)', async () => {
      const incomeTxn = makeTxn({ id: 41, amount_cents: 100000, direction: 'income', category: 'income', note: null })
      const w = mountActivity(async (url: string, opts?: any) => {
        if (opts?.method === 'PATCH') return makeTxn({ id: 41, amount_cents: 100000, direction: 'income', category: 'income' })
        if (url.startsWith('/api/transactions')) return [incomeTxn]
        return []
      })
      await flushPromises()

      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()

      ;(document.querySelector('.edit-sheet__save') as HTMLElement).click()
      await flushPromises()

      // No "Select a category" error, and the sheet closed (PATCH succeeded).
      const sheet = document.querySelector('[data-testid="edit-sheet"]')
      expect(sheet).toBeNull()
      const calls = (globalThis.$fetch as any).mock.calls
      expect(calls.some((c: any[]) => c[1]?.method === 'PATCH')).toBe(true)
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

    // ── 'Paid from' account picker (account_id edit) ──────────────────────────
    // The sheet renders a spendable-account <select> pre-selected to the row's current
    // account, filters out card accounts, and includes account_id in the PATCH body.
    // Applies to both expense and income rows.
    const SPENDABLE_ACCOUNTS = [
      { id: 1, name: 'Cash', type: 'cash' },
      { id: 2, name: 'Main Bank', type: 'bank' },
      { id: 3, name: 'EF Savings', type: 'savings' },
      { id: 9, name: 'Visa Card', type: 'card' }, // must be filtered OUT
    ]

    // Stub useFetch('/api/accounts') to return real accounts, then mount.
    function mountWithAccounts(fetchImpl?: (url: string, opts?: any) => any) {
      vi.mocked(useFetch).mockResolvedValue(
        { data: { value: SPENDABLE_ACCOUNTS }, refresh: vi.fn() } as any,
      )
      return mountActivity(fetchImpl)
    }

    it('renders the account picker pre-selected to the row current account, card excluded', async () => {
      const w = mountWithAccounts(async (url: string) => {
        if (url.startsWith('/api/transactions')) {
          return [makeTxn({ id: 1, account_id: 2, amount_cents: -1250, category: 'food', direction: 'expense' })]
        }
        return []
      })
      await flushPromises()

      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()

      const select = document.querySelector('[data-test="edit-account"]') as HTMLSelectElement
      expect(select).not.toBeNull()
      // Pre-selected to the row's current account_id (2 = Main Bank).
      expect(select.value).toBe('2')
      // Card option filtered out → only the 3 spendable accounts are offered.
      const optionValues = Array.from(select.querySelectorAll('option')).map(o => (o as HTMLOptionElement).value)
      expect(optionValues).toEqual(['1', '2', '3'])
      expect(optionValues).not.toContain('9')
    })

    it('includes the chosen account_id in the PATCH body (expense row)', async () => {
      const patchResult = makeTxn({ id: 1, account_id: 3, amount_cents: -1250, category: 'food', direction: 'expense' })
      const w = mountWithAccounts(async (url: string, opts?: any) => {
        if (opts?.method === 'PATCH') return patchResult
        if (url.startsWith('/api/transactions')) {
          return [makeTxn({ id: 1, account_id: 2, amount_cents: -1250, category: 'food', direction: 'expense' })]
        }
        return []
      })
      await flushPromises()

      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()

      // Change the funding account 2 → 3 (EF Savings).
      const select = document.querySelector('[data-test="edit-account"]') as HTMLSelectElement
      select.value = '3'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await w.vm.$nextTick()

      ;(document.querySelector('.edit-sheet__save') as HTMLElement).click()
      await flushPromises()

      const calls = (globalThis.$fetch as any).mock.calls
      const patchCall = calls.find((c: any[]) => c[1]?.method === 'PATCH')
      expect(patchCall).toBeTruthy()
      expect(patchCall[1].body.account_id).toBe(3)

      document.querySelectorAll('.edit-overlay').forEach(el => el.remove())
    })

    it('the picker is available on income rows too and account_id is PATCHed', async () => {
      const patchResult = makeTxn({ id: 50, account_id: 1, amount_cents: 200000, direction: 'income', category: 'income' })
      const w = mountWithAccounts(async (url: string, opts?: any) => {
        if (opts?.method === 'PATCH') return patchResult
        if (url.startsWith('/api/transactions')) {
          return [makeTxn({ id: 50, account_id: 2, amount_cents: 200000, direction: 'income', category: 'income', note: 'Salary' })]
        }
        return []
      })
      await flushPromises()

      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()

      // Picker present + pre-selected to current account (2) even for income.
      const select = document.querySelector('[data-test="edit-account"]') as HTMLSelectElement
      expect(select).not.toBeNull()
      expect(select.value).toBe('2')

      // Move income to Cash (1) and save.
      select.value = '1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await w.vm.$nextTick()

      ;(document.querySelector('.edit-sheet__save') as HTMLElement).click()
      await flushPromises()

      const calls = (globalThis.$fetch as any).mock.calls
      const patchCall = calls.find((c: any[]) => c[1]?.method === 'PATCH')
      expect(patchCall).toBeTruthy()
      expect(patchCall[1].body.account_id).toBe(1)
      expect(patchCall[1].body.direction).toBe('income')

      document.querySelectorAll('.edit-overlay').forEach(el => el.remove())
    })
  })

  // ── Search + category filter ──────────────────────────────────────────────────
  // Client-side filter over the already-loaded month. Search matches note text +
  // category label (case-insensitive substring); category chips narrow to one spend
  // category; the two combine. No-match shows a DISTINCT empty state from the month's
  // true-empty state, and edit/delete must still work on a filtered row.
  describe('search + category filter', () => {
    // A varied month: distinct notes + categories to filter against.
    const searchSet = [
      makeTxn({ id: 100, date: '2026-06-19', amount_cents: -1500, category: 'food', note: 'Lunch at OldTown' }),
      makeTxn({ id: 101, date: '2026-06-18', amount_cents: -3000, category: 'transport', note: 'Grab to airport' }),
      makeTxn({ id: 102, date: '2026-06-18', amount_cents: -8000, category: 'groceries', note: 'Weekly Tesco run' }),
      makeTxn({ id: 103, date: '2026-06-17', amount_cents: -2200, category: 'food', note: 'Dinner with team' }),
    ]
    const mountSearch = () =>
      mountActivity(async (url: string) => {
        if (url.startsWith('/api/transactions')) return [...searchSet]
        return []
      })

    it('renders the search input and category filter when the month has rows', async () => {
      const w = mountSearch()
      await flushPromises()
      expect(w.find('[data-test="activity-search"]').exists()).toBe(true)
      expect(w.find('[data-test="activity-filter"]').exists()).toBe(true)
      // All 4 rows visible before any filter.
      expect(w.findAll('[role="listitem"]').length).toBe(4)
    })

    it('typing a note substring filters to matching rows (case-insensitive)', async () => {
      const w = mountSearch()
      await flushPromises()

      const search = w.find('[data-test="activity-search"]')
      await search.setValue('tesco') // matches only "Weekly Tesco run"
      await flushPromises()

      const rows = w.findAll('[role="listitem"]')
      expect(rows.length).toBe(1)
      expect(w.text()).toContain('Weekly Tesco run')
      expect(w.text()).not.toContain('Lunch at OldTown')
    })

    it('search also matches the category label (e.g. "transport")', async () => {
      const w = mountSearch()
      await flushPromises()

      await w.find('[data-test="activity-search"]').setValue('Transport')
      await flushPromises()

      const rows = w.findAll('[role="listitem"]')
      expect(rows.length).toBe(1)
      expect(w.text()).toContain('Grab to airport')
    })

    it('selecting a category chip narrows to that category', async () => {
      const w = mountSearch()
      await flushPromises()

      // 'food' chip → two food rows (id 100, 103)
      await w.find('[data-test="activity-filter-food"]').trigger('click')
      await flushPromises()

      const rows = w.findAll('[role="listitem"]')
      expect(rows.length).toBe(2)
      expect(w.text()).toContain('Lunch at OldTown')
      expect(w.text()).toContain('Dinner with team')
      expect(w.text()).not.toContain('Grab to airport')
    })

    it('combines search + category (food + "dinner" → one row)', async () => {
      const w = mountSearch()
      await flushPromises()

      await w.find('[data-test="activity-filter-food"]').trigger('click')
      await w.find('[data-test="activity-search"]').setValue('dinner')
      await flushPromises()

      const rows = w.findAll('[role="listitem"]')
      expect(rows.length).toBe(1)
      expect(w.text()).toContain('Dinner with team')
      expect(w.text()).not.toContain('Lunch at OldTown')
    })

    it('clearing the search restores all rows', async () => {
      const w = mountSearch()
      await flushPromises()

      const search = w.find('[data-test="activity-search"]')
      await search.setValue('tesco')
      await flushPromises()
      expect(w.findAll('[role="listitem"]').length).toBe(1)

      await search.setValue('')
      await flushPromises()
      expect(w.findAll('[role="listitem"]').length).toBe(4)
    })

    it('no-match shows the DISTINCT no-match state, not the month true-empty state', async () => {
      const w = mountSearch()
      await flushPromises()

      await w.find('[data-test="activity-search"]').setValue('zzz-no-such-entry')
      await flushPromises()

      // No-match state visible…
      expect(w.find('[data-testid="nomatch-state"]').exists()).toBe(true)
      expect(w.text()).toContain('No matching entries')
      // …and it is NOT the month's true-empty state.
      expect(w.find('[data-testid="empty-state"]').exists()).toBe(false)
      expect(w.text()).not.toContain('No spending logged yet')
      // The search input remains so the user can refine.
      expect(w.find('[data-test="activity-search"]').exists()).toBe(true)
    })

    it('an empty month shows the true-empty state and NO search/filter controls', async () => {
      const w = mountActivity(async () => [])
      await flushPromises()
      expect(w.find('[data-testid="empty-state"]').exists()).toBe(true)
      expect(w.find('[data-testid="nomatch-state"]').exists()).toBe(false)
      expect(w.find('[data-test="activity-search"]').exists()).toBe(false)
    })

    it('edit still works on a filtered row (PATCH fires)', async () => {
      const patchResult = makeTxn({ id: 102, amount_cents: -9000, category: 'groceries', date: '2026-06-18' })
      const w = mountActivity(async (url: string, opts?: any) => {
        if (opts?.method === 'PATCH') return patchResult
        if (url.startsWith('/api/transactions')) return [...searchSet]
        return []
      })
      await flushPromises()

      // Filter down to the single groceries row, then open + save it.
      await w.find('[data-test="activity-search"]').setValue('tesco')
      await flushPromises()
      expect(w.findAll('[role="listitem"]').length).toBe(1)

      await w.find('.list-row__main').trigger('click')
      await w.vm.$nextTick()
      expect(document.querySelector('[data-testid="edit-sheet"]')).not.toBeNull()

      ;(document.querySelector('.edit-sheet__save') as HTMLElement).click()
      await flushPromises()

      const calls = (globalThis.$fetch as any).mock.calls
      const patchCall = calls.find((c: any[]) => c[1]?.method === 'PATCH')
      expect(patchCall).toBeTruthy()
      expect(patchCall[0]).toMatch(/\/api\/transactions\/102/)

      document.querySelectorAll('.edit-overlay').forEach(el => el.remove())
    })

    it('delete still works on a filtered row (DELETE fires + undo toast)', async () => {
      const w = mountActivity(async (url: string, opts?: any) => {
        if (opts?.method === 'DELETE') return { ok: true }
        if (url.startsWith('/api/transactions')) return [...searchSet]
        return []
      })
      await flushPromises()

      await w.find('[data-test="activity-search"]').setValue('tesco')
      await flushPromises()
      const rows = w.findAll('[role="listitem"]')
      expect(rows.length).toBe(1)

      await w.find('.list-row__delete').trigger('click')
      await flushPromises()

      const calls = (globalThis.$fetch as any).mock.calls
      const deleteCall = calls.find((c: any[]) => c[1]?.method === 'DELETE')
      expect(deleteCall).toBeTruthy()
      expect(deleteCall[0]).toMatch(/\/api\/transactions\/102/)
      expect(w.find('[data-testid="undo-toast"]').exists()).toBe(true)
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

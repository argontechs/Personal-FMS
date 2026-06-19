// test/app/bills.test.ts
// Unit tests for the Bills & Subscriptions page.
// Stubs useFetch and $fetch; mounts in happy-dom via Suspense.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, Suspense, ref } from 'vue'

// ─── #app mock ─────────────────────────────────────────────────────────────────
vi.mock('#app', () => ({
  useFetch: vi.fn(async () => ({ data: ref(null), refresh: vi.fn(), error: ref(null) })),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  definePageMeta: vi.fn(),
  useRoute: vi.fn(() => ({ path: '/bills', name: 'bills', params: {}, query: {}, hash: '' })),
}))

import BillsPage from '../../app/pages/bills.vue'
import { useFetch } from '#app'

// ─── Fixture data ─────────────────────────────────────────────────────────────
const mockAccounts = [
  { id: 1, name: 'Cash Wallet',    type: 'cash',    balance_cents: 50000,  is_active: true },
  { id: 2, name: 'Maybank',        type: 'bank',    balance_cents: 200000, is_active: true },
  { id: 3, name: 'HSBC Card',      type: 'card',    balance_cents: -74000, is_active: true },
]

const mockRecurring = [
  {
    id: 1, name: 'Salary',         direction: 'income',  amount_cents: 500000, is_variable: false,
    cadence: 'monthly', day_of_month: 25, weekday: null, category: 'income',
    funding_account_id: 2, debt_id: null, auto_post: true,
    start_date: '2024-01-01', end_date: null, remaining_occurrences: null,
    last_posted_date: null, next_due_date: '2026-06-25',
    remaining_installments_json: null, is_active: true, created_at: 1000, updated_at: 1000,
  },
  {
    id: 2, name: 'Netflix',        direction: 'expense', amount_cents: 5500,   is_variable: false,
    cadence: 'monthly', day_of_month: 10, weekday: null, category: 'bills',
    funding_account_id: 3, debt_id: null, auto_post: true,
    start_date: '2024-01-01', end_date: null, remaining_occurrences: null,
    last_posted_date: null, next_due_date: '2026-06-10',
    remaining_installments_json: null, is_active: true, created_at: 1000, updated_at: 1000,
  },
  {
    id: 3, name: 'Car Loan',       direction: 'expense', amount_cents: 100000, is_variable: false,
    cadence: 'monthly', day_of_month: 5,  weekday: null, category: 'debt',
    funding_account_id: 2, debt_id: 10,   auto_post: true,
    start_date: '2024-01-01', end_date: null, remaining_occurrences: null,
    last_posted_date: null, next_due_date: '2026-06-05',
    remaining_installments_json: null, is_active: true, created_at: 1000, updated_at: 1000,
  },
  {
    id: 4, name: 'Spotify',        direction: 'expense', amount_cents: 1999,   is_variable: false,
    cadence: 'monthly', day_of_month: 15, weekday: null, category: 'bills',
    funding_account_id: 3, debt_id: null, auto_post: true,
    start_date: '2024-01-01', end_date: null, remaining_occurrences: null,
    last_posted_date: null, next_due_date: '2026-06-15',
    remaining_installments_json: null, is_active: true, created_at: 1000, updated_at: 1000,
  },
  {
    id: 5, name: 'GE ILP',         direction: 'expense', amount_cents: 25000,  is_variable: false,
    cadence: 'monthly', day_of_month: 1,  weekday: null, category: 'bills',
    funding_account_id: 3, debt_id: null, auto_post: true,
    start_date: '2024-01-01', end_date: null, remaining_occurrences: null,
    last_posted_date: null, next_due_date: '2026-06-01',
    remaining_installments_json: null, is_active: false, created_at: 1000, updated_at: 1000,
  },
]

// ─── Mount helper ─────────────────────────────────────────────────────────────
let mountedWrappers: ReturnType<typeof mount>[] = []

function mountBills(
  recurringData = mockRecurring,
  accountsData = mockAccounts,
  opts: { recurringError?: Error } = {},
) {
  const impl = (url: string) => {
    if (url === '/api/recurring') {
      return Promise.resolve({
        data: ref(recurringData),
        refresh: vi.fn(),
        error: ref(opts.recurringError ?? null),
      })
    }
    if (url === '/api/accounts') {
      return Promise.resolve({ data: ref(accountsData), refresh: vi.fn(), error: ref(null) })
    }
    return Promise.resolve({ data: ref(null), refresh: vi.fn(), error: ref(null) })
  }
  vi.mocked(useFetch).mockImplementation(impl as any)

  const div = document.createElement('div')
  document.body.appendChild(div)

  const w = mount(
    defineComponent({
      render() { return h(Suspense, null, { default: () => h(BillsPage) }) },
    }),
    { attachTo: div },
  )
  mountedWrappers.push(w)
  return w
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('$fetch', vi.fn(async () => ({})))
})

afterEach(() => {
  for (const w of mountedWrappers) w.unmount()
  mountedWrappers = []
  vi.unstubAllGlobals()
})

// ─── 1. Grouped rendering ─────────────────────────────────────────────────────
describe('Bills page — grouped list rendering', () => {
  it('renders Income group with Salary', async () => {
    const w = mountBills()
    await flushPromises()
    expect(w.text()).toContain('Income')
    expect(w.text()).toContain('Salary')
  })

  it('renders Bills & Subscriptions group with Netflix and Spotify', async () => {
    const w = mountBills()
    await flushPromises()
    expect(w.text()).toContain('Bills')
    expect(w.text()).toContain('Netflix')
    expect(w.text()).toContain('Spotify')
  })

  it('renders Debt Payments group with Car Loan', async () => {
    const w = mountBills()
    await flushPromises()
    expect(w.text()).toContain('Debt Payments')
    expect(w.text()).toContain('Car Loan')
  })

  it('renders formatted amounts with RM', async () => {
    const w = mountBills()
    await flushPromises()
    // Salary = 500000 cents = RM5,000.00
    expect(w.text()).toContain('RM5,000.00')
    // Netflix = 5500 cents = RM55.00
    expect(w.text()).toContain('RM55.00')
  })

  it('shows Paused badge for inactive items (GE ILP is_active=false)', async () => {
    const w = mountBills()
    await flushPromises()
    expect(w.text()).toContain('GE ILP')
    expect(w.text()).toContain('Paused')
  })

  it('shows cadence and day-of-month metadata', async () => {
    const w = mountBills()
    await flushPromises()
    // Netflix: monthly, day 10 → "mo" + "Day 10"
    expect(w.text()).toContain('mo')
    expect(w.text()).toContain('Day 10')
  })

  it('shows account name on the row', async () => {
    const w = mountBills()
    await flushPromises()
    // Car Loan uses Maybank (id=2)
    expect(w.text()).toContain('Maybank')
  })

  it('shows "card" tag for card-funded items', async () => {
    const w = mountBills()
    await flushPromises()
    // Netflix funding_account_id=3 (HSBC Card type='card')
    expect(w.html()).toContain('card')
  })
})

// ─── 2. Add (POST) ────────────────────────────────────────────────────────────
describe('Bills page — add recurring item (POST /api/recurring)', () => {
  it('opens add sheet when Add button is clicked', async () => {
    const w = mountBills()
    await flushPromises()
    const addBtn = w.find('[aria-label="Add new recurring item"]')
    expect(addBtn.exists()).toBe(true)
    await addBtn.trigger('click')
    await flushPromises()
    // Sheet is Teleported to document.body — check there
    expect(document.querySelector('[aria-label="Add recurring item"]')).not.toBeNull()
  })

  it('POSTs to /api/recurring with correct body shape', async () => {
    const fetchMock = vi.fn(async () => ({
      id: 99, name: 'Unifi', direction: 'expense', amount_cents: 9900,
      is_variable: false, cadence: 'monthly', day_of_month: 20, weekday: null,
      category: 'bills', funding_account_id: 2, debt_id: null, auto_post: true,
      start_date: '2026-06-19', end_date: null, remaining_occurrences: null,
      last_posted_date: null, next_due_date: null, remaining_installments_json: null,
      is_active: true, created_at: 1000, updated_at: 1000,
    }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountBills()
    await flushPromises()

    // Open add sheet
    await w.find('[aria-label="Add new recurring item"]').trigger('click')
    await flushPromises()

    // Teleport renders to document.body — use document.querySelector
    const nameInput = document.querySelector('#add-name') as HTMLInputElement
    expect(nameInput).not.toBeNull()
    nameInput.value = 'Unifi'
    nameInput.dispatchEvent(new Event('input'))

    const amountInput = document.querySelector('#add-amount') as HTMLInputElement
    expect(amountInput).not.toBeNull()
    amountInput.value = '99.00'
    amountInput.dispatchEvent(new Event('input'))

    const domInput = document.querySelector('#add-dom') as HTMLInputElement
    expect(domInput).not.toBeNull()
    domInput.value = '20'
    domInput.dispatchEvent(new Event('input'))

    await flushPromises()

    // Submit
    const confirmBtn = document.querySelector('[aria-label="Add recurring item"] .sheet__confirm') as HTMLButtonElement
    expect(confirmBtn).not.toBeNull()
    confirmBtn.click()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recurring',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          name: 'Unifi',
          direction: 'expense',
          amount_cents: 9900,
          cadence: 'monthly',
          category: 'bills',
        }),
      }),
    )
  })

  it('shows validation error if name is empty', async () => {
    const w = mountBills()
    await flushPromises()
    await w.find('[aria-label="Add new recurring item"]').trigger('click')
    await flushPromises()
    // Submit with no name via document.querySelector (Teleport)
    const confirmBtn = document.querySelector('[aria-label="Add recurring item"] .sheet__confirm') as HTMLButtonElement
    expect(confirmBtn).not.toBeNull()
    confirmBtn.click()
    await flushPromises()
    // Error renders inside Teleport — check document.body text
    expect(document.body.textContent).toContain('Name is required')
  })
})

// ─── 3. Edit (PATCH) ──────────────────────────────────────────────────────────
describe('Bills page — edit recurring item (PATCH /api/recurring/:id)', () => {
  it('opens edit sheet with existing values when Edit is clicked', async () => {
    const w = mountBills()
    await flushPromises()

    // Click edit on Netflix (first edit button)
    const editBtns = w.findAll('[aria-label^="Edit "]')
    expect(editBtns.length).toBeGreaterThan(0)
    await editBtns[1].trigger('click') // Netflix is 2nd item overall (after Salary)
    await flushPromises()

    // Teleport renders to document.body — check there
    const editDialog = document.querySelector('[aria-label="Edit recurring item"]')
    expect(editDialog).not.toBeNull()
  })

  it('PATCHes /api/recurring/:id with valid body', async () => {
    const fetchMock = vi.fn(async () => ({
      ...mockRecurring[1], name: 'Netflix HD', amount_cents: 6000,
    }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountBills()
    await flushPromises()

    // Find edit button for Netflix (id=2)
    const editBtn = w.find('[aria-label="Edit Netflix"]')
    expect(editBtn.exists()).toBe(true)
    await editBtn.trigger('click')
    await flushPromises()

    // Teleport renders to document.body — use document.querySelector
    const nameInput = document.querySelector('#edit-name') as HTMLInputElement
    expect(nameInput).not.toBeNull()
    nameInput.value = 'Netflix HD'
    nameInput.dispatchEvent(new Event('input'))
    await flushPromises()

    const amountInput = document.querySelector('#edit-amount') as HTMLInputElement
    expect(amountInput).not.toBeNull()
    amountInput.value = '60.00'
    amountInput.dispatchEvent(new Event('input'))
    await flushPromises()

    // Submit via the confirm button inside the edit sheet
    const confirmBtn = document.querySelector('[aria-label="Edit recurring item"] .sheet__confirm') as HTMLButtonElement
    expect(confirmBtn).not.toBeNull()
    confirmBtn.click()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recurring/2',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({
          name: 'Netflix HD',
          amount_cents: 6000,
        }),
      }),
    )
  })
})

// ─── 4. Pause / resume (PATCH is_active) ──────────────────────────────────────
describe('Bills page — pause / resume (PATCH is_active)', () => {
  it('clicking Pause calls PATCH with is_active: false', async () => {
    const fetchMock = vi.fn(async () => ({ ...mockRecurring[0], is_active: false }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountBills()
    await flushPromises()

    const pauseBtn = w.find('[aria-label="Pause Salary"]')
    expect(pauseBtn.exists()).toBe(true)
    await pauseBtn.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recurring/1',
      expect.objectContaining({
        method: 'PATCH',
        body: { is_active: false },
      }),
    )
  })

  it('clicking Resume calls PATCH with is_active: true', async () => {
    const fetchMock = vi.fn(async () => ({ ...mockRecurring[4], is_active: true }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountBills()
    await flushPromises()

    // GE ILP (id=5) is_active=false — button text is "Resume"
    const resumeBtn = w.find('[aria-label="Resume GE ILP"]')
    expect(resumeBtn.exists()).toBe(true)
    await resumeBtn.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recurring/5',
      expect.objectContaining({
        method: 'PATCH',
        body: { is_active: true },
      }),
    )
  })
})

// ─── 5. Delete (guarded) ──────────────────────────────────────────────────────
describe('Bills page — delete (guarded with confirm)', () => {
  it('first click shows Confirm delete, not immediate DELETE', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountBills()
    await flushPromises()

    const deleteBtn = w.find('[aria-label="Delete Salary"]')
    expect(deleteBtn.exists()).toBe(true)
    await deleteBtn.trigger('click')
    await flushPromises()

    // Should show confirm — no DELETE called yet
    expect(fetchMock).not.toHaveBeenCalled()
    expect(w.text()).toContain('Confirm delete')
  })

  it('clicking Confirm delete calls DELETE /api/recurring/:id', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountBills()
    await flushPromises()

    // Step 1: prompt delete
    await w.find('[aria-label="Delete Salary"]').trigger('click')
    await flushPromises()

    // Step 2: confirm
    const confirmBtn = w.find('[aria-label="Confirm delete Salary"]')
    expect(confirmBtn.exists()).toBe(true)
    await confirmBtn.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recurring/1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('Cancel delete hides the confirm prompt', async () => {
    const w = mountBills()
    await flushPromises()

    await w.find('[aria-label="Delete Netflix"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Confirm delete')

    const cancelBtn = w.find('[aria-label^="Cancel"]')
    if (cancelBtn.exists()) {
      await cancelBtn.trigger('click')
    } else {
      // May be a plain text "Cancel" button
      const btns = w.findAll('button')
      const cancel = btns.find(b => b.text() === 'Cancel')
      expect(cancel).toBeDefined()
      await cancel!.trigger('click')
    }
    await flushPromises()
    expect(w.text()).not.toContain('Confirm delete')
  })
})

// ─── 6. Flip-off-card ─────────────────────────────────────────────────────────
describe('Bills page — flip-off-card', () => {
  it('shows flip banner when card-funded items exist', async () => {
    const w = mountBills()
    await flushPromises()
    // Netflix and Spotify are card-funded (funding_account_id=3, type='card')
    expect(w.find('[data-test="flip-banner"]').exists()).toBe(true)
  })

  it('POSTs to /api/recurring/flip-off-card with card_account_id and bank_account_id', async () => {
    const fetchMock = vi.fn(async () => ({ flipped: 2, paused: 0 }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountBills()
    await flushPromises()

    // Open flip sheet
    const moveBtn = w.find('[aria-label="Move all card-funded recurring payments to bank account"]')
    expect(moveBtn.exists()).toBe(true)
    await moveBtn.trigger('click')
    await flushPromises()

    // Confirm flip — Teleport renders to document.body
    const flipConfirmBtn = document.querySelector('[data-test="flip-confirm-btn"]') as HTMLButtonElement
    expect(flipConfirmBtn).not.toBeNull()
    flipConfirmBtn.click()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recurring/flip-off-card',
      expect.objectContaining({
        method: 'POST',
        body: {
          card_account_id: 3,  // HSBC Card id
          bank_account_id: 2,  // Maybank id
        },
      }),
    )
  })

  it('does not show flip banner when no card account exists', async () => {
    const noCardAccounts = [
      { id: 1, name: 'Cash Wallet', type: 'cash', balance_cents: 50000, is_active: true },
      { id: 2, name: 'Maybank',     type: 'bank', balance_cents: 200000, is_active: true },
    ]
    const w = mountBills(mockRecurring, noCardAccounts)
    await flushPromises()
    expect(w.find('[data-test="flip-banner"]').exists()).toBe(false)
  })
})

// ─── 7. Error and empty states ────────────────────────────────────────────────
describe('Bills page — error and empty states', () => {
  it('shows error alert when recurring fetch fails', async () => {
    const w = mountBills([], mockAccounts, { recurringError: new Error('Network error') })
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(true)
    expect(w.text()).toContain("Couldn't load")
  })

  it('shows empty state when no items exist', async () => {
    const w = mountBills([])
    await flushPromises()
    expect(w.text()).toContain('No recurring items yet')
  })
})

// ─── 8. Auto-deduct vs Reminder-only mode (auto_post) ─────────────────────────
describe('Bills page — auto-deduct vs reminder-only mode', () => {
  it('POST persists auto_post=false when reminder-only mode is chosen', async () => {
    const fetchMock = vi.fn(async () => ({ ...mockRecurring[1], id: 99, auto_post: false }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountBills()
    await flushPromises()

    await w.find('[aria-label="Add new recurring item"]').trigger('click')
    await flushPromises()

    const nameInput = document.querySelector('#add-name') as HTMLInputElement
    nameInput.value = 'Rent'
    nameInput.dispatchEvent(new Event('input'))
    const amountInput = document.querySelector('#add-amount') as HTMLInputElement
    amountInput.value = '1200.00'
    amountInput.dispatchEvent(new Event('input'))

    // Select the reminder-only radio
    const reminderRadio = document.querySelector('[data-test="add-mode"] input[value="reminder"]') as HTMLInputElement
    expect(reminderRadio).not.toBeNull()
    reminderRadio.checked = true
    reminderRadio.dispatchEvent(new Event('change'))
    await flushPromises()

    const confirmBtn = document.querySelector('[aria-label="Add recurring item"] .sheet__confirm') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recurring',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ name: 'Rent', auto_post: false }),
      }),
    )
  })

  it('POST defaults auto_post=true (auto-deduct) when mode is untouched', async () => {
    const fetchMock = vi.fn(async () => ({ ...mockRecurring[1], id: 98 }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountBills()
    await flushPromises()
    await w.find('[aria-label="Add new recurring item"]').trigger('click')
    await flushPromises()

    const nameInput = document.querySelector('#add-name') as HTMLInputElement
    nameInput.value = 'Unifi'
    nameInput.dispatchEvent(new Event('input'))
    const amountInput = document.querySelector('#add-amount') as HTMLInputElement
    amountInput.value = '99.00'
    amountInput.dispatchEvent(new Event('input'))
    await flushPromises()

    const confirmBtn = document.querySelector('[aria-label="Add recurring item"] .sheet__confirm') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recurring',
      expect.objectContaining({ body: expect.objectContaining({ auto_post: true }) }),
    )
  })

  it('PATCH persists auto_post=false when an item is edited to reminder-only', async () => {
    const fetchMock = vi.fn(async () => ({ ...mockRecurring[1], auto_post: false }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountBills()
    await flushPromises()

    await w.find('[aria-label="Edit Netflix"]').trigger('click')
    await flushPromises()

    const reminderRadio = document.querySelector('[data-test="edit-mode"] input[value="reminder"]') as HTMLInputElement
    expect(reminderRadio).not.toBeNull()
    reminderRadio.checked = true
    reminderRadio.dispatchEvent(new Event('change'))
    await flushPromises()

    const confirmBtn = document.querySelector('[aria-label="Edit recurring item"] .sheet__confirm') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/recurring/2',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({ auto_post: false }),
      }),
    )
  })

  it('renders Auto and Reminder mode badges on rows', async () => {
    const items = [
      { ...mockRecurring[1], id: 2, name: 'AutoBill', auto_post: true },
      { ...mockRecurring[3], id: 4, name: 'ReminderBill', auto_post: false },
    ]
    const w = mountBills(items)
    await flushPromises()
    const badges = w.findAll('[data-test="mode-badge"]')
    const labels = badges.map(b => b.text())
    expect(labels).toContain('Auto')
    expect(labels).toContain('Reminder')
  })
})

// ─── 9. Upcoming charges (next 14 days, both modes) ───────────────────────────
describe('Bills page — Upcoming charges', () => {
  // Build dates inside the today..today+14 window relative to the real clock.
  function isoPlus(days: number): string {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString().slice(0, 10)
  }

  const upcomingFixtures = [
    { ...mockRecurring[1], id: 21, name: 'AutoUpcoming',     auto_post: true,  is_active: true, next_due_date: isoPlus(3) },
    { ...mockRecurring[3], id: 22, name: 'ReminderUpcoming', auto_post: false, is_active: true, next_due_date: isoPlus(7) },
    { ...mockRecurring[1], id: 23, name: 'WayOut',           auto_post: true,  is_active: true, next_due_date: isoPlus(40) },
    { ...mockRecurring[1], id: 24, name: 'PausedUpcoming',   auto_post: false, is_active: false, next_due_date: isoPlus(2) },
  ]

  it('renders the Upcoming charges section listing both auto and reminder items within 14 days', async () => {
    const w = mountBills(upcomingFixtures)
    await flushPromises()
    const section = w.find('[data-test="upcoming-charges"]')
    expect(section.exists()).toBe(true)
    expect(section.text()).toContain('AutoUpcoming')
    expect(section.text()).toContain('ReminderUpcoming')
    // Both mode badges present in the upcoming list
    const badges = section.findAll('[data-test="upcoming-mode-badge"]').map(b => b.text())
    expect(badges).toContain('Auto')
    expect(badges).toContain('Reminder')
  })

  it('excludes items beyond 14 days and paused items from Upcoming charges', async () => {
    const w = mountBills(upcomingFixtures)
    await flushPromises()
    const section = w.find('[data-test="upcoming-charges"]')
    expect(section.text()).not.toContain('WayOut')
    expect(section.text()).not.toContain('PausedUpcoming')
    // Exactly 2 upcoming rows (AutoUpcoming + ReminderUpcoming)
    expect(section.findAll('[data-test="upcoming-row"]')).toHaveLength(2)
  })
})

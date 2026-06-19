// test/app/accounts.test.ts
// Accounts & Debts page unit tests — mounts the page in happy-dom, stubs useFetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, Suspense, ref } from 'vue'

// ─── #app mock ─────────────────────────────────────────────────────────────────
vi.mock('#app', () => ({
  useFetch: vi.fn(async () => ({ data: ref(null), refresh: vi.fn(), error: ref(null) })),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  definePageMeta: vi.fn(),
  useRoute: vi.fn(() => ({ path: '/accounts', name: 'accounts', params: {}, query: {}, hash: '' })),
}))

import AccountsPage from '../../app/pages/accounts.vue'
import { useFetch } from '#app'

// ─── Fixture data ──────────────────────────────────────────────────────────────

/** 5 accounts: cash, bank, ewallet, savings, AND a card account (must NOT appear as asset) */
const mockAccounts = [
  { id: 1, name: 'Cash Wallet',   type: 'cash',    balance_cents: 50000,   is_active: true },
  { id: 2, name: 'Maybank',       type: 'bank',    balance_cents: 200000,  is_active: true },
  { id: 3, name: 'Touch n Go',    type: 'ewallet', balance_cents: 15000,   is_active: true },
  { id: 4, name: 'Emergency Fund',type: 'savings', balance_cents: 80000,   is_active: true },
  { id: 5, name: 'HSBC Card',     type: 'card',    balance_cents: -740076, is_active: true }, // mirror — must be EXCLUDED from assets
]

/** 7 debts in avalanche order (priority_rank 1→7) */
const mockDebts = [
  { id: 10, name: 'Credit Card',       type: 'revolving',    balance_cents: 740076,  rate_type: 'apr',      apr_bps: 1800,  flat_rate_bps: null, due_day: 25, priority_rank: 1, payoff_baseline_cents: 800000 },
  { id: 11, name: 'Car Loan',          type: 'installment',  balance_cents: 2500000, rate_type: 'flat',     apr_bps: null,  flat_rate_bps: 175,  due_day: 10, priority_rank: 2, payoff_baseline_cents: null    },
  { id: 12, name: 'PTPTN',             type: 'reducing_loan',balance_cents: 1200000, rate_type: 'flat',     apr_bps: null,  flat_rate_bps: 100,  due_day: 15, priority_rank: 3, payoff_baseline_cents: 1500000 },
  { id: 13, name: 'Personal Loan A',   type: 'flat_loan',    balance_cents: 300000,  rate_type: 'flat',     apr_bps: null,  flat_rate_bps: 244,  due_day: 18, priority_rank: 4, payoff_baseline_cents: 400000  },
  { id: 14, name: 'Personal Loan B',   type: 'flat_loan',    balance_cents: 150000,  rate_type: 'flat',     apr_bps: null,  flat_rate_bps: 244,  due_day: 20, priority_rank: 5, payoff_baseline_cents: 200000  },
  { id: 15, name: 'ShopeePayLater',    type: 'flat_loan',    balance_cents: 50000,   rate_type: 'none',     apr_bps: null,  flat_rate_bps: null, due_day: 1,  priority_rank: 6, payoff_baseline_cents: null    },
  { id: 16, name: 'Ryt PayLater',      type: 'flat_loan',    balance_cents: 30000,   rate_type: 'none',     apr_bps: null,  flat_rate_bps: null, due_day: 5,  priority_rank: 7, payoff_baseline_cents: null    },
]

/** Holdings (investments/insurance) — manual-value assets */
const mockHoldings = [
  { id: 20, name: 'AIA Assurance Account', institution: 'AIA',  kind: 'investment', current_value_cents: 6352297, liquid: 1, note: 'May allow partial withdrawal' },
  { id: 21, name: 'ASM 3',                 institution: 'ASNB', kind: 'savings',    current_value_cents: 20000,   liquid: 1, note: null },
]

// ─── Mount helper ──────────────────────────────────────────────────────────────
let mountedWrappers: ReturnType<typeof mount>[] = []

function mountAccounts(accountsData = mockAccounts, debtsData = mockDebts, opts: { accountsError?: Error; debtsError?: Error; holdingsData?: any[]; holdingsError?: Error } = {}) {
  const impl = (url: string) => {
    if (url === '/api/accounts') {
      return Promise.resolve({ data: ref(accountsData), refresh: vi.fn(), error: ref(opts.accountsError ?? null) })
    }
    if (url === '/api/debts') {
      return Promise.resolve({ data: ref(debtsData), refresh: vi.fn(), error: ref(opts.debtsError ?? null) })
    }
    if (url === '/api/holdings') {
      return Promise.resolve({ data: ref(opts.holdingsData ?? []), refresh: vi.fn(), error: ref(opts.holdingsError ?? null) })
    }
    return Promise.resolve({ data: ref(null), refresh: vi.fn(), error: ref(null) })
  }
  vi.mocked(useFetch).mockImplementation(impl as any)

  const div = document.createElement('div')
  document.body.appendChild(div)

  const w = mount(
    defineComponent({
      render() { return h(Suspense, null, { default: () => h(AccountsPage) }) },
    }),
    { attachTo: div },
  )
  mountedWrappers.push(w)
  return w
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  for (const w of mountedWrappers) { w.unmount() }
  mountedWrappers = []
})

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Accounts & Debts page — account balances', () => {
  it('renders account balances (tabular-nums)', async () => {
    const w = mountAccounts()
    await flushPromises()
    expect(w.text()).toContain('Cash Wallet')
    expect(w.text()).toContain('RM500.00')   // 50000 sen
    expect(w.text()).toContain('Maybank')
    expect(w.text()).toContain('RM2,000.00') // 200000 sen
    expect(w.text()).toContain('Touch n Go')
    expect(w.text()).toContain('RM150.00')   // 15000 sen
  })

  it('renders savings account (Emergency Fund)', async () => {
    const w = mountAccounts()
    await flushPromises()
    expect(w.text()).toContain('Emergency Fund')
    expect(w.text()).toContain('RM800.00')   // 80000 sen
  })

  it('does NOT list the card account (HSBC Card) as an asset', async () => {
    const w = mountAccounts()
    await flushPromises()
    // HSBC Card type='card' must not appear in the accounts sections
    const html = w.html()
    // The card name appears in debts only — but since we have Credit Card in debts and HSBC Card in accounts,
    // the card account row should not be in the spendable or savings list.
    // We verify by checking the account list does NOT contain "card" type badges in the asset lists.
    // The HSBC Card account should not appear as an asset row.
    expect(w.text()).not.toContain('HSBC Card')
  })
})

describe('Accounts & Debts page — all 7 debts', () => {
  it('renders all 7 debt names', async () => {
    const w = mountAccounts()
    await flushPromises()
    expect(w.text()).toContain('Credit Card')
    expect(w.text()).toContain('Car Loan')
    expect(w.text()).toContain('PTPTN')
    expect(w.text()).toContain('Personal Loan A')
    expect(w.text()).toContain('Personal Loan B')
    expect(w.text()).toContain('ShopeePayLater')
    expect(w.text()).toContain('Ryt PayLater')
  })

  it('renders the credit card balance as what is owed', async () => {
    const w = mountAccounts()
    await flushPromises()
    expect(w.text()).toContain('RM7,400.76') // 740076 sen
  })

  it('renders 18% APR label on the credit card', async () => {
    const w = mountAccounts()
    await flushPromises()
    expect(w.text()).toContain('18% APR')
  })

  it('renders flat rate labels on other debts', async () => {
    const w = mountAccounts()
    await flushPromises()
    expect(w.text()).toContain('2.44%')  // Personal Loan A / B flat rate (244 bps / 100)
  })

  it('renders a progress bar for debts with a baseline', async () => {
    const w = mountAccounts()
    await flushPromises()
    // Credit Card has payoff_baseline_cents=800000; balance=740076 → ~7.5% paid
    const bars = w.findAll('[role="progressbar"]')
    expect(bars.length).toBeGreaterThan(0)
  })

  it('does not render a progress bar for debts with no baseline (Car Loan)', async () => {
    const w = mountAccounts()
    await flushPromises()
    // Car loan has payoff_baseline_cents=null — no progress bar should be present for it
    // We can't test per-debt bar absence without data-testid, but we confirm bar count <= debts with baseline
    const debtsWithBaseline = mockDebts.filter(d => d.payoff_baseline_cents !== null)
    const bars = w.findAll('[role="progressbar"]')
    expect(bars.length).toBe(debtsWithBaseline.length)
  })
})

describe('Accounts & Debts page — net position', () => {
  it('shows a net worth section', async () => {
    const w = mountAccounts()
    await flushPromises()
    expect(w.text().toLowerCase()).toContain('net worth')
  })

  it('shows Total assets (excl. card), Total debts, and net', async () => {
    const w = mountAccounts()
    await flushPromises()
    // Total assets: 50000 + 200000 + 15000 + 80000 = 345000 sen = RM3,450.00
    expect(w.text()).toContain('RM3,450.00')
    // Total debts: sum of all 7 = 740076+2500000+1200000+300000+150000+50000+30000 = 4970076 → RM49,700.76
    expect(w.text()).toContain('RM49,700.76')
  })

  it('shows deficit text (not just color) when net is negative', async () => {
    const w = mountAccounts()
    await flushPromises()
    // net = 345000 - 4970076 = -4625076 → deficit
    expect(w.text()).toContain('deficit')
  })

  it('renders holdings and folds them into net worth (old caveat removed)', async () => {
    const w = mountAccounts(mockAccounts, mockDebts, { holdingsData: mockHoldings })
    await flushPromises()
    // Holdings render with name + value
    expect(w.text()).toContain('AIA Assurance Account')
    expect(w.text()).toContain('RM63,522.97')   // 6352297 sen
    // Total assets now = liquid 345000 + holdings (6352297 + 20000 = 6372297) = 6717297 → RM67,172.97
    expect(w.text()).toContain('RM67,172.97')
    // The obsolete "holdings aren't tracked yet" caveat must be gone
    expect(w.text()).not.toContain("aren't tracked")
  })
})

describe('Accounts & Debts page — error and loading states', () => {
  it('shows error state when API fails', async () => {
    const w = mountAccounts(mockAccounts, mockDebts, { accountsError: new Error('Network error') })
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(true)
    expect(w.text()).toContain("couldn't be loaded")
  })

  it('shows Retry button on error', async () => {
    const w = mountAccounts(mockAccounts, mockDebts, { accountsError: new Error('fail') })
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('Retry')
  })
})

// test/app/settings.test.ts
// Unit tests for the Settings page — mounts in happy-dom, stubs API calls.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, Suspense, ref } from 'vue'

// ─── API fixtures ─────────────────────────────────────────────────────────────
const mockGoals = {
  ef: { currentCents: 45000, targetCents: 100000, progress: 0.45 },
  killCard: { currentCents: 740000, baselineCents: 800000, progress: 0.075 },
}

const mockAccounts = [
  { id: 1, name: 'Cash Wallet', type: 'cash',    balance_cents: 12500, is_active: true },
  { id: 2, name: 'Maybank',     type: 'bank',    balance_cents: 200000, is_active: true },
  { id: 3, name: 'EF Savings',  type: 'savings', balance_cents: 45000, is_active: true },
  { id: 4, name: 'Credit Card', type: 'card',    balance_cents: -740000, is_active: true },
]

const mockDebt = { cardBalanceCents: 740000, creditLimitCents: 1000000 }

// ─── usePush mock ──────────────────────────────────────────────────────────────
const mockPushState = {
  permission: ref<NotificationPermission | 'unsupported'>('default'),
  showInstallBanner: ref(false),
  canEnable: ref(true),
  isIosNonStandalone: ref(false),
  enableResult: { ok: true } as { ok: boolean; reason?: string },
}
const mockEnable = vi.fn(async () => mockPushState.enableResult)

vi.mock('../../app/composables/usePush', () => ({
  usePush: () => ({
    permission: mockPushState.permission,
    showInstallBanner: mockPushState.showInstallBanner,
    canEnable: mockPushState.canEnable,
    isIosNonStandalone: mockPushState.isIosNonStandalone,
    enable: mockEnable,
  }),
}))

// ─── #app mock ────────────────────────────────────────────────────────────────
vi.mock('#app', () => ({
  useFetch: vi.fn(async (url: string) => {
    if (url === '/api/goals/progress') return { data: ref(mockGoals), refresh: vi.fn(), error: ref(null) }
    if (url === '/api/accounts')       return { data: ref(mockAccounts), refresh: vi.fn(), error: ref(null) }
    if (url === '/api/debt')           return { data: ref(mockDebt), refresh: vi.fn(), error: ref(null) }
    return { data: ref(null), refresh: vi.fn(), error: ref(null) }
  }),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  definePageMeta: vi.fn(),
  useRoute: vi.fn(() => ({ path: '/settings', name: 'settings', params: {}, query: {}, hash: '' })),
}))

// ─── Import AFTER mocks ───────────────────────────────────────────────────────
import SettingsPage from '../../app/pages/settings.vue'
import { navigateTo as mockNavigateTo } from '#app'

// ─── Mount helper ─────────────────────────────────────────────────────────────
let mountedWrappers: ReturnType<typeof mount>[] = []

function mountSettings() {
  const div = document.createElement('div')
  document.body.appendChild(div)
  const w = mount(
    defineComponent({ render() { return h(Suspense, null, { default: () => h(SettingsPage) }) } }),
    { attachTo: div },
  )
  mountedWrappers.push(w)
  return w
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPushState.permission.value = 'default'
  mockPushState.showInstallBanner.value = false
  mockPushState.canEnable.value = true
  mockPushState.isIosNonStandalone.value = false
  mockPushState.enableResult = { ok: true }
  // Default $fetch stub
  vi.stubGlobal('$fetch', vi.fn(async () => ({})))
})

afterEach(() => {
  for (const w of mountedWrappers) w.unmount()
  mountedWrappers = []
})

// ─── Section 1: Reconcile Balances ───────────────────────────────────────────
describe('Settings — Reconcile Balances', () => {
  it('renders a reconcile row per spendable account with its computed balance (card excluded from spendable list)', async () => {
    const w = mountSettings()
    await flushPromises()
    expect(w.text()).toContain('Reconcile Balances')
    // 12500 cents = RM125.00 (cash); each spendable account is listed by name.
    expect(w.text()).toContain('RM125.00')
    expect(w.text()).toContain('Cash Wallet')
    expect(w.text()).toContain('Maybank')
    expect(w.text()).toContain('EF Savings')
    // Three spendable accounts → three account reconcile rows.
    expect(w.find('[data-test="recon-account-1"]').exists()).toBe(true)
    expect(w.find('[data-test="recon-account-2"]').exists()).toBe(true)
    expect(w.find('[data-test="recon-account-3"]').exists()).toBe(true)
    // The card is NOT in the spendable rows (it gets its own card row).
    expect(w.find('[data-test="recon-account-4"]').exists()).toBe(false)
  })

  it('reconciles a spendable account → POST /api/accounts/correct-cash with account_id + target_cents', async () => {
    const fetchMock = vi.fn(async () => ({ id: 1, adjustment_cents: 2500, computedCents: 12500, realCents: 15000, deltaCents: 2500 }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountSettings()
    await flushPromises()

    const input = w.find('#recon-account-1-input')
    expect(input.exists()).toBe(true)
    await input.setValue('150.00')
    await w.find('[data-test="recon-account-1"] form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/accounts/correct-cash',
      expect.objectContaining({
        method: 'POST',
        body: { account_id: 1, target_cents: 15000 },
      }),
    )
  })

  it('shows the corrected drift after reconciling an account', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ id: 1, adjustment_cents: 2500, computedCents: 12500, realCents: 15000, deltaCents: 2500 })))
    const w = mountSettings()
    await flushPromises()
    await w.find('#recon-account-1-input').setValue('150.00')
    await w.find('[data-test="recon-account-1"] form').trigger('submit')
    await flushPromises()
    expect(w.text()).toContain('Adjusted by +RM25.00')
  })

  it('renders the credit-card reconcile row with the computed card balance', async () => {
    const w = mountSettings()
    await flushPromises()
    expect(w.find('[data-test="recon-card"]').exists()).toBe(true)
    // 740000 cents = RM7,400.00
    expect(w.text()).toContain('RM7,400.00')
  })

  it('reconciles the card → POST /api/debts/card/reconcile with real_cents', async () => {
    const fetchMock = vi.fn(async () => ({ id: 9, adjustment_cents: 15000, computedCents: 740000, realCents: 755000, deltaCents: 15000 }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountSettings()
    await flushPromises()

    await w.find('#recon-card-input').setValue('7550.00')
    await w.find('[data-test="recon-card"] form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/debts/card/reconcile',
      expect.objectContaining({
        method: 'POST',
        body: { real_cents: 755000 },
      }),
    )
  })

  it('shows the corrected drift + baseline note after reconciling the card', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ id: 9, adjustment_cents: 15000, computedCents: 740000, realCents: 755000, deltaCents: 15000 })))
    const w = mountSettings()
    await flushPromises()
    await w.find('#recon-card-input').setValue('7550.00')
    await w.find('[data-test="recon-card"] form').trigger('submit')
    await flushPromises()
    expect(w.text()).toContain('Adjusted by +RM150.00')
    expect(w.text()).toContain('baseline unchanged')
  })
})

// ─── Section 2: EF Target ─────────────────────────────────────────────────────
describe('Settings — Emergency Fund Target', () => {
  it('renders current EF target', async () => {
    const w = mountSettings()
    await flushPromises()
    // 100000 cents = RM1,000.00
    expect(w.text()).toContain('RM1,000.00')
  })

  it('RM 1k preset calls PATCH /api/goals/ef-target with 100000 cents', async () => {
    const fetchMock = vi.fn(async () => ({ id: 1, type: 'savings', target_amount_cents: 100000 }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountSettings()
    await flushPromises()

    // Find the RM 1,000 preset button
    const presetBtns = w.findAll('.settings-preset-btn')
    const rm1kBtn = presetBtns.find(b => b.text().includes('1,000'))
    expect(rm1kBtn).toBeDefined()
    await rm1kBtn!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/goals/ef-target',
      expect.objectContaining({
        method: 'PATCH',
        body: { targetAmountCents: 100000 },
      }),
    )
  })

  it('RM 15k preset calls PATCH /api/goals/ef-target with 1500000 cents', async () => {
    const fetchMock = vi.fn(async () => ({ id: 1, type: 'savings', target_amount_cents: 1500000 }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountSettings()
    await flushPromises()

    const presetBtns = w.findAll('.settings-preset-btn')
    const rm15kBtn = presetBtns.find(b => b.text().includes('15,000'))
    expect(rm15kBtn).toBeDefined()
    await rm15kBtn!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/goals/ef-target',
      expect.objectContaining({
        method: 'PATCH',
        body: { targetAmountCents: 1500000 },
      }),
    )
  })

  it('custom amount field calls PATCH with correct cents', async () => {
    const fetchMock = vi.fn(async () => ({ id: 1, type: 'savings', target_amount_cents: 500000 }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountSettings()
    await flushPromises()

    await w.find('#ef-custom').setValue('5000.00')
    // Submit the EF custom form specifically (it contains #ef-custom).
    const efForm = w.find('#ef-custom').element.closest('form') as HTMLFormElement
    await w.find('#ef-custom').setValue('5000.00')
    const efFormWrapper = w.findAll('form').find(f => f.element === efForm)!
    await efFormWrapper.trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/goals/ef-target',
      expect.objectContaining({
        method: 'PATCH',
        body: { targetAmountCents: 500000 },
      }),
    )
  })

  it('shows success message after EF target update', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ id: 1, type: 'savings', target_amount_cents: 100000 })))
    const w = mountSettings()
    await flushPromises()

    const presetBtns = w.findAll('.settings-preset-btn')
    await presetBtns[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('EF target updated')
  })
})

// ─── Section 3: Reminders ─────────────────────────────────────────────────────
describe('Settings — Reminders', () => {
  it('shows push notification status badge', async () => {
    mockPushState.permission.value = 'default'
    const w = mountSettings()
    await flushPromises()
    expect(w.text()).toContain('Push notifications')
    expect(w.text()).toContain('Not enabled')
  })

  it('shows Enabled badge when permission is granted', async () => {
    mockPushState.permission.value = 'granted'
    const w = mountSettings()
    await flushPromises()
    expect(w.text()).toContain('Enabled')
  })

  it('shows Blocked badge when permission is denied', async () => {
    mockPushState.permission.value = 'denied'
    const w = mountSettings()
    await flushPromises()
    expect(w.text()).toContain('Blocked')
  })

  it('Enable Notifications button visible when canEnable and not granted', async () => {
    mockPushState.permission.value = 'default'
    mockPushState.canEnable.value = true
    const w = mountSettings()
    await flushPromises()
    expect(w.text()).toContain('Enable Notifications')
  })

  it('clicking Enable Notifications calls push.enable()', async () => {
    mockPushState.permission.value = 'default'
    mockPushState.canEnable.value = true
    const w = mountSettings()
    await flushPromises()
    const btn = w.find('.settings-push-btn')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    await flushPromises()
    expect(mockEnable).toHaveBeenCalledTimes(1)
  })

  it('shows iOS Add to Home Screen banner when showInstallBanner is true', async () => {
    mockPushState.showInstallBanner.value = true
    mockPushState.permission.value = 'default'
    const w = mountSettings()
    await flushPromises()
    expect(w.text()).toContain('Add to Home Screen')
  })
})

// ─── Section 4: Bills link ────────────────────────────────────────────────────
describe('Settings — Bills & Subscriptions link', () => {
  it('renders Bills & Subscriptions section', async () => {
    const w = mountSettings()
    await flushPromises()
    expect(w.text()).toContain('Bills')
    expect(w.text()).toContain('Subscriptions')
  })

  it('clicking the link card navigates to /bills', async () => {
    const w = mountSettings()
    await flushPromises()
    const linkCard = w.find('.settings-link-card')
    expect(linkCard.exists()).toBe(true)
    await linkCard.trigger('click')
    await flushPromises()
    expect(mockNavigateTo).toHaveBeenCalledWith('/bills')
  })
})

// ─── Section 5: Log out ───────────────────────────────────────────────────────
describe('Settings — Log out', () => {
  it('renders a Log out button', async () => {
    const w = mountSettings()
    await flushPromises()
    expect(w.text()).toContain('Log out')
  })

  it('clicking Log out POSTs to /api/auth/logout and navigates to /login', async () => {
    const fetchMock = vi.fn(async () => ({}))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountSettings()
    await flushPromises()

    const logoutBtn = w.find('.settings-logout-btn')
    expect(logoutBtn.exists()).toBe(true)
    await logoutBtn.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
    expect(mockNavigateTo).toHaveBeenCalledWith('/login')
  })
})

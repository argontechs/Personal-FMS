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
]

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

// ─── Section 1: Correct Cash Balance ─────────────────────────────────────────
describe('Settings — Correct Cash Balance', () => {
  it('renders the current cash balance', async () => {
    const w = mountSettings()
    await flushPromises()
    // 12500 cents = RM125.00
    expect(w.text()).toContain('RM125.00')
    expect(w.text()).toContain('Cash Wallet')
  })

  it('submits POST /api/accounts/correct-cash with correct body shape', async () => {
    const fetchMock = vi.fn(async () => ({ id: 1, adjustment_cents: 2500 }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountSettings()
    await flushPromises()

    // Find the cash amount input and set it to 150.00
    const input = w.find('#cash-amount')
    expect(input.exists()).toBe(true)
    await input.setValue('150.00')

    // Submit
    const form = w.find('form')
    await form.trigger('submit')
    await flushPromises()

    // Verify $fetch called with correct endpoint and body shape
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/accounts/correct-cash',
      expect.objectContaining({
        method: 'POST',
        body: {
          account_id: 1,       // primaryCashAccount.id from mockAccounts[0]
          target_cents: 15000, // Math.round(150.00 * 100)
        },
      }),
    )
  })

  it('converts RM to cents correctly (Math.round)', async () => {
    const fetchMock = vi.fn(async () => ({ id: 2, adjustment_cents: 100 }))
    vi.stubGlobal('$fetch', fetchMock)

    const w = mountSettings()
    await flushPromises()
    await w.find('#cash-amount').setValue('99.99')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/accounts/correct-cash',
      expect.objectContaining({ body: expect.objectContaining({ target_cents: 9999 }) }),
    )
  })

  it('shows success message after submit', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => ({ id: 3, adjustment_cents: 0 })))
    const w = mountSettings()
    await flushPromises()
    await w.find('#cash-amount').setValue('125.00')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.text()).toContain('Cash balance updated')
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
    // Find the EF form (second form on page)
    const forms = w.findAll('form')
    // The EF custom form is the second form
    await forms[1].trigger('submit')
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

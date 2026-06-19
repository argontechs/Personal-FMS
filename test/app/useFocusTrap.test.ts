// test/app/useFocusTrap.test.ts
// Component test for the shared focus-trap (app/composables/useFocusTrap.ts),
// exercised through the Accounts holdings sheet — the most representative dialog
// (real trigger button → sheet with input + close + confirm + Esc).
//
// Verifies the four required behaviors:
//   1. opening moves focus INSIDE the dialog,
//   2. Tab from the last focusable wraps back to the first (trapped),
//   3. Escape closes the sheet,
//   4. focus returns to the trigger element on close.
//
// Also asserts the background is marked inert when the sheet is open.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, Suspense, ref, nextTick } from 'vue'

vi.mock('#app', () => ({
  useFetch: vi.fn(async () => ({ data: ref(null), refresh: vi.fn(), error: ref(null) })),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  definePageMeta: vi.fn(),
  useRoute: vi.fn(() => ({ path: '/accounts', name: 'accounts', params: {}, query: {}, hash: '' })),
}))

import AccountsPage from '../../app/pages/accounts.vue'
import { useFetch } from '#app'

const mockAccounts = [
  { id: 2, name: 'Maybank', type: 'bank', balance_cents: 200000, is_active: true },
]
const mockDebts: any[] = []
const mockHoldings = [
  { id: 20, name: 'AIA Assurance Account', institution: 'AIA', kind: 'investment', current_value_cents: 6352297, liquid: 1, note: null },
]

let mounted: ReturnType<typeof mount>[] = []

function mountAccounts() {
  const impl = (url: string) => {
    if (url === '/api/accounts') return Promise.resolve({ data: ref(mockAccounts), refresh: vi.fn(), error: ref(null) })
    if (url === '/api/debts') return Promise.resolve({ data: ref(mockDebts), refresh: vi.fn(), error: ref(null) })
    if (url === '/api/holdings') return Promise.resolve({ data: ref(mockHoldings), refresh: vi.fn(), error: ref(null) })
    return Promise.resolve({ data: ref(null), refresh: vi.fn(), error: ref(null) })
  }
  vi.mocked(useFetch).mockImplementation(impl as any)
  const div = document.createElement('div')
  document.body.appendChild(div)
  const w = mount(
    defineComponent({ render() { return h(Suspense, null, { default: () => h(AccountsPage) }) } }),
    { attachTo: div },
  )
  mounted.push(w)
  return w
}

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { for (const w of mounted) w.unmount(); mounted = [] })

describe('useFocusTrap — Accounts holdings sheet', () => {
  it('moves focus INSIDE the dialog on open (the Name input)', async () => {
    const w = mountAccounts()
    await flushPromises()
    await w.find('.accts-add-btn').trigger('click')
    await flushPromises()
    await nextTick()
    const name = w.find('#holding-name').element as HTMLInputElement
    expect(document.activeElement).toBe(name)
  })

  it('traps Tab: from the last focusable, Tab wraps to the first', async () => {
    const w = mountAccounts()
    await flushPromises()
    await w.find('.accts-add-btn').trigger('click')
    await flushPromises()
    await nextTick()

    const dialog = w.find('[role="dialog"]').element as HTMLElement
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    )
    expect(focusables.length).toBeGreaterThan(1)
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    // Put focus on the LAST element, then press Tab → should wrap to FIRST.
    last.focus()
    expect(document.activeElement).toBe(last)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await nextTick()
    expect(document.activeElement).toBe(first)
  })

  it('traps Shift+Tab: from the first focusable, Shift+Tab wraps to the last', async () => {
    const w = mountAccounts()
    await flushPromises()
    await w.find('.accts-add-btn').trigger('click')
    await flushPromises()
    await nextTick()

    const dialog = w.find('[role="dialog"]').element as HTMLElement
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    )
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    first.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await nextTick()
    expect(document.activeElement).toBe(last)
  })

  it('Escape closes the sheet', async () => {
    const w = mountAccounts()
    await flushPromises()
    await w.find('.accts-add-btn').trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('restores focus to the trigger element on close', async () => {
    const w = mountAccounts()
    await flushPromises()
    const trigger = w.find('.accts-add-btn').element as HTMLButtonElement
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    await w.find('.accts-add-btn').trigger('click')
    await flushPromises()
    await nextTick()
    // focus is now inside the dialog
    expect(document.activeElement).not.toBe(trigger)

    // Close via Escape → focus must return to the trigger.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    await nextTick()
    expect(document.activeElement).toBe(trigger)
  })

  it('marks the background inert while open and clears it on close', async () => {
    const w = mountAccounts()
    await flushPromises()
    await w.find('.accts-add-btn').trigger('click')
    await flushPromises()
    await nextTick()

    const dialog = w.find('[role="dialog"]').element as HTMLElement
    const parent = dialog.parentElement!
    const siblings = Array.from(parent.children).filter((c) => c !== dialog) as HTMLElement[]
    // At least one sibling exists (the page content) and is inerted.
    expect(siblings.length).toBeGreaterThan(0)
    expect(siblings.every((s) => s.hasAttribute('inert'))).toBe(true)
    expect(siblings.every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    await nextTick()
    // inert cleared after close
    expect(siblings.some((s) => s.hasAttribute('inert'))).toBe(false)
  })
})

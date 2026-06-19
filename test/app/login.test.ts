// test/app/login.test.ts
// Login page unit tests — mounts the page in happy-dom, stubs #app and $fetch.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, Suspense } from 'vue'

// ─── #app mock ────────────────────────────────────────────────────────────────
// vi.mock is hoisted above variable declarations, so mockNavigateTo cannot be
// referenced inside the factory. Use vi.fn() directly and retrieve it after import.
vi.mock('#app', () => ({
  useFetch: vi.fn(async () => ({ data: { value: null }, refresh: vi.fn() })),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  defineNuxtRouteMiddleware: vi.fn((fn: any) => fn),
}))

// Import AFTER mocks (Vitest hoists vi.mock)
import LoginPage from '../../app/pages/login.vue'
import * as nuxtApp from '#app'

// ─── Helper: mount inside <Suspense> ──────────────────────────────────────────
function mountLogin() {
  return mount(
    defineComponent({
      render() { return h(Suspense, null, { default: () => h(LoginPage) }) },
    }),
  )
}

// ─── Helper: make $fetch throw with a given status code ──────────────────────
function makeFetchError(status: number) {
  const err: any = new Error('HTTP Error')
  err.response = { status }
  err.status = status
  err.statusCode = status
  return err
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('$fetch', vi.fn())
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Login page', () => {
  it('renders username and password fields', async () => {
    const w = mountLogin()
    await flushPromises()
    expect(w.find('input[type="text"]').exists()).toBe(true)
    expect(w.find('input[type="password"]').exists()).toBe(true)
  })

  it('submits credentials and redirects on success', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ ok: true }))
    const w = mountLogin()
    await flushPromises()

    await w.find('input[type="text"]').setValue('admin')
    await w.find('input[type="password"]').setValue('secret')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(nuxtApp.navigateTo).toHaveBeenCalledWith('/')
  })

  it('shows error on 401', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(makeFetchError(401)))
    const w = mountLogin()
    await flushPromises()

    await w.find('input[type="text"]').setValue('admin')
    await w.find('input[type="password"]').setValue('wrong')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(w.text()).toContain('Invalid username or password')
  })

  it('shows rate-limit message on 429', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(makeFetchError(429)))
    const w = mountLogin()
    await flushPromises()

    await w.find('input[type="text"]').setValue('admin')
    await w.find('input[type="password"]').setValue('anything')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(w.text()).toContain('Too many attempts')
  })

  it('disables submit button while submitting', async () => {
    // Return a never-resolving promise to keep the inflight state
    let resolveSubmit!: (v: any) => void
    const pending = new Promise((resolve) => { resolveSubmit = resolve })
    vi.stubGlobal('$fetch', vi.fn().mockReturnValue(pending))

    const w = mountLogin()
    await flushPromises()

    await w.find('input[type="text"]').setValue('admin')
    await w.find('input[type="password"]').setValue('secret')

    // Trigger submit but do NOT await
    w.find('form').trigger('submit')
    // Allow the synchronous part of handleSubmit to run (sets submitting=true)
    await w.vm.$nextTick()

    const btn = w.find('button[type="submit"]')
    expect(btn.attributes('disabled')).toBeDefined()

    // Clean up — resolve the promise so the component can settle
    resolveSubmit({ ok: true })
    await flushPromises()
  })
})

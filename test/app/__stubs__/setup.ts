// test/app/__stubs__/setup.ts
// Global setup for happy-dom tests. Provides Nuxt compiler macros that Nuxt's vite
// plugin would normally strip/inject at build time, but which appear as globals at runtime.
import { vi } from 'vitest'

// definePageMeta is a Nuxt compiler macro — no-op in tests.
if (typeof globalThis.definePageMeta === 'undefined') {
  // @ts-ignore
  globalThis.definePageMeta = vi.fn()
}

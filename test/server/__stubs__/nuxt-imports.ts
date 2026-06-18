// test/server/__stubs__/nuxt-imports.ts
// Minimal shim for Nuxt's #imports auto-import module for server-side unit tests.
// Provides the runtime functions used by server utilities (push.ts etc.)
export function useRuntimeConfig() {
  return {
    vapidPrivateKey: '',
    vapidSubject: '',
    smtpUrl: '',          // empty → sendMail no-ops in tests
    runDueSecret: '',     // override in tests via vi.mock('#imports')
    public: { vapidPublicKey: '' },
  }
}

// H3 helpers used by server event handlers — no-ops in unit tests unless mocked.
export function defineEventHandler(fn: Function) { return fn }
export function createError({ statusCode, statusMessage }: { statusCode: number; statusMessage: string }) {
  const err = new Error(statusMessage) as any
  err.statusCode = statusCode
  return err
}
export function getHeader(_event: any, _name: string): string | undefined { return undefined }

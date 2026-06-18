// test/server/__stubs__/nuxt-imports.ts
// Minimal shim for Nuxt's #imports auto-import module for server-side unit tests.
// Provides the runtime functions used by server utilities (push.ts etc.)
export function useRuntimeConfig() {
  return {
    vapidPrivateKey: '',
    vapidSubject: '',
    smtpUrl: '',          // empty → sendMail no-ops in tests
    public: { vapidPublicKey: '' },
  }
}

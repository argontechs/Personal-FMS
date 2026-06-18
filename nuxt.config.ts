import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  ssr: false,
  modules: ['@vite-pwa/nuxt'],
  runtimeConfig: {
    vapidPrivateKey: '',
    vapidSubject: '',
    runDueSecret: '',
    sessionPassword: '',
    public: {
      // RUNTIME config — populated from env NUXT_PUBLIC_VAPID_PUBLIC_KEY, never import.meta.env
      vapidPublicKey: '',
    },
  },
  nitro: {
    preset: 'node-server',
    compressPublicAssets: true,
    experimental: { tasks: true },
    scheduledTasks: {
      // FLAT names ↔ FLAT files (server/tasks/<name>.ts). Colon = nested dir = silent no-fire.
      '0 6 * * *': ['post-recurring'],   // daily, post-MYT-midnight income/bills/loans + interest accrual
      '*/5 * * * *': ['notify-dispatch'], // bill reminders + payday prompts (gated in code by MYT time)
    },
  },
  pwa: {
    strategies: 'injectManifest',
    // With Nuxt 4's srcDir='app/', vite root is already <project>/app.
    // srcDir here is relative to vite root, so '.' resolves correctly.
    srcDir: '.',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    injectManifest: { swSrc: 'sw.ts' },
  },
})

import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  ssr: false,
  modules: ['@vite-pwa/nuxt'],
  css: ['~/assets/css/tokens.css'],
  runtimeConfig: {
    vapidPrivateKey: '',          // env NUXT_VAPID_PRIVATE_KEY
    vapidSubject: 'mailto:yongwei1127@gmail.com',
    runDueSecret: '',
    sessionPassword: '',
    smtpUrl: '',                  // env NUXT_SMTP_URL — VPS SMTP connection string
    public: {
      // RUNTIME config — populated from env NUXT_PUBLIC_VAPID_PUBLIC_KEY, never import.meta.env
      vapidPublicKey: '',         // env NUXT_PUBLIC_VAPID_PUBLIC_KEY
    },
  },
  nitro: {
    preset: 'node-server',
    compressPublicAssets: true,
    experimental: { tasks: true },
    scheduledTasks: {
      // FLAT names ↔ FLAT files (server/tasks/<name>.ts). Colon = nested dir = silent no-fire.
      '0 6 * * *': ['post-recurring'],    // daily, post-MYT-midnight income/bills/loans + interest accrual
      '30 6 * * *': ['daily-snapshot'],   // daily, just after post-recurring — Trends history (net worth/debt/card/EF/liquid)
      '*/5 * * * *': ['notify-dispatch'], // bill reminders + payday prompts (gated in code by MYT time)
      '0 9 * * 1': ['weekly-attention'],  // Monday 09:00 MYT — email fallback if push channel dies
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
    // SW is built in production only — running it under `nuxt dev` trips the
    // injectManifest rollup-input resolution and isn't needed for local dev.
    devOptions: { enabled: false },
  },
})

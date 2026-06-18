// app/plugins/offline-flush.client.ts
// Wires registerAutoFlush to the real window on client-side hydration.
// The .client suffix ensures this plugin never runs during SSR.
import { defineNuxtPlugin } from '#app'
import { registerAutoFlush } from '~/composables/useOfflineQueue'

export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return
  registerAutoFlush(window)
})

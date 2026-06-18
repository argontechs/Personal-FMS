// app/sw.ts — service worker stub (required by @vite-pwa/nuxt injectManifest)
// Full implementation follows in Phase 2+.
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

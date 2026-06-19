/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare let self: ServiceWorkerGlobalScope

// injectManifest entry point — Workbox precaches the app shell (offline quick-log).
precacheAndRoute(self.__WB_MANIFEST || [])

// ---------------------------------------------------------------------------
// Pure helpers — exported so unit tests can import without a SW runtime.
// ---------------------------------------------------------------------------

export const READ_API_CACHE = 'fms-read-api-v1'

/**
 * Predicate: should this request be runtime-cached as a read API response?
 * - GET only (never cache POST/PATCH/DELETE — those go through the offline write-queue).
 * - Must be under /api/.
 * - Excludes /api/auth/** and /api/internal/** (auth/session/login + internal cron triggers
 *   must never be cached — we must never serve a stale 401/session or replay an internal call).
 * Pure + exported so it can be unit-tested without a SW runtime.
 */
export function isCacheableApiGet(pathname: string, method: string): boolean {
  if (method !== 'GET') return false
  if (!pathname.startsWith('/api/')) return false
  if (pathname.startsWith('/api/auth/')) return false
  if (pathname.startsWith('/api/internal/')) return false
  return true
}

// ---------------------------------------------------------------------------
// Runtime read-cache: NetworkFirst for GET /api reads.
// Online → always fresh from network (cache updated as a side effect).
// Offline / network timeout → fall back to the last-known cached response,
// so the dashboard/activity/accounts show last-synced data instead of blank.
// Only successful (200) responses are cached; a cached 401/403/500 is never served.
// ---------------------------------------------------------------------------
registerRoute(
  ({ url, request }) => isCacheableApiGet(url.pathname, request.method),
  new NetworkFirst({
    cacheName: READ_API_CACHE,
    networkTimeoutSeconds: 4,
    plugins: [
      // Only ever write 200 responses to the cache (drops opaque/4xx/5xx).
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 64,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

export function handlePush(data: any): { title: string; options: NotificationOptions } {
  if (!data || typeof data.title !== 'string') {
    return {
      title: 'Money',
      options: { body: 'You have an update.', tag: 'generic', data: { url: '/' } },
    }
  }
  return {
    title: data.title,
    options: {
      body: data.body ?? '',
      tag: data.tag ?? 'generic',
      data: { url: data.url ?? '/' },
      actions: Array.isArray(data.actions) ? data.actions : undefined,
      renotify: true,
    },
  }
}

export function resolveClickUrl(notificationData: any): string {
  return notificationData && typeof notificationData.url === 'string'
    ? notificationData.url
    : '/'
}

export function buildResubscribeBody(sub: PushSubscription): {
  endpoint: string
  keys: { p256dh: string; auth: string }
} {
  const json = sub.toJSON()
  return {
    endpoint: json.endpoint!,
    keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
  }
}

// ---------------------------------------------------------------------------
// Service worker event listeners
// ---------------------------------------------------------------------------

self.addEventListener('push', (event: PushEvent) => {
  let data: any = null
  try {
    data = event.data ? event.data.json() : null
  } catch {
    data = null
  }
  const { title, options } = handlePush(data)
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const url = resolveClickUrl(event.notification.data)
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if ('focus' in c) {
            ;(c as WindowClient).navigate(url)
            return (c as WindowClient).focus()
          }
        }
        return self.clients.openWindow(url)
      }),
  )
})

self.addEventListener('pushsubscriptionchange', (event: any) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription?.options ?? { userVisibleOnly: true })
      .then((sub) =>
        fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(buildResubscribeBody(sub)),
        }),
      ),
  )
})

/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// injectManifest entry point — Workbox precaches the app shell (offline quick-log).
precacheAndRoute(self.__WB_MANIFEST || [])

// ---------------------------------------------------------------------------
// Pure helpers — exported so unit tests can import without a SW runtime.
// ---------------------------------------------------------------------------

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

import webpush from 'web-push'
import { useRuntimeConfig } from '#imports'

export type PushPayload = {
  title: string
  body: string
  url: string
  tag: string
  actions?: { action: string; title: string }[]
}

let configured = false
export function getWebPush(): typeof webpush {
  if (!configured) {
    const cfg = useRuntimeConfig()
    if (cfg.vapidPrivateKey && cfg.vapidSubject && cfg.public.vapidPublicKey) {
      webpush.setVapidDetails(cfg.vapidSubject, cfg.public.vapidPublicKey, cfg.vapidPrivateKey)
    } else {
      console.warn('[webpush] VAPID keys not configured; push notifications will not work until keys are set')
    }
    configured = true
  }
  return webpush
}

export async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
  ttlSeconds = 3600,
): Promise<{ ok: true } | { ok: false; statusCode?: number }> {
  const wp = getWebPush()
  try {
    await wp.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: ttlSeconds },
    )
    return { ok: true }
  } catch (e: any) {
    return { ok: false, statusCode: e?.statusCode }
  }
}

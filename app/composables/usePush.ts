// app/composables/usePush.ts
import { ref, computed, type Ref, type ComputedRef } from 'vue'

export function detectIosNonStandalone(ua: string, standalone: boolean): boolean {
  const isIos = /iPhone|iPad|iPod/.test(ua)
  return isIos && !standalone
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function usePush() {
  const supported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator

  const permission: Ref<NotificationPermission | 'unsupported'> = ref(
    supported ? Notification.permission : 'unsupported',
  )

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true)

  const isStandalone: ComputedRef<boolean> = computed(() => standalone)
  const isIosNonStandalone: ComputedRef<boolean> = computed(() =>
    detectIosNonStandalone(ua, standalone),
  )
  // On iOS, only offer "enable" once standalone; everywhere else offer directly.
  const showInstallBanner: ComputedRef<boolean> = computed(
    () => isIosNonStandalone.value && permission.value !== 'granted',
  )

  // canEnable: true when push is supported AND we're not gated by iOS install requirement
  const canEnable: ComputedRef<boolean> = computed(
    () => supported && !isIosNonStandalone.value,
  )

  /**
   * enable() — MUST be called from a user-gesture handler (button click).
   * iOS requires Notification.requestPermission() originates from a user gesture.
   */
  async function enable(): Promise<{ ok: boolean; reason?: string }> {
    if (!supported) return { ok: false, reason: 'unsupported' }
    // iOS standalone gate: require PWA installed to Home Screen before offering push.
    if (isIosNonStandalone.value) return { ok: false, reason: 'install-first' }

    // Request permission — must be called from a user-gesture context.
    const perm = await Notification.requestPermission()
    permission.value = perm
    if (perm !== 'granted') return { ok: false, reason: 'denied' }

    const reg = await navigator.serviceWorker.ready
    // VAPID public key from runtime config (base64url → Uint8Array for applicationServerKey).
    const cfg = useRuntimeConfig()
    const key = cfg.public.vapidPublicKey as string | undefined
    if (!key) return { ok: false, reason: 'no-vapid-key' }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    })

    const json = sub.toJSON()
    // POST subscription to the gated subscribe endpoint (Task 4.2).
    await $fetch('/api/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
      },
    })

    // Send a confirmation canary push (Task 4.6).
    await sendCanary()
    return { ok: true }
  }

  async function sendCanary(): Promise<void> {
    await $fetch('/api/push/canary', { method: 'POST' })
  }

  return {
    permission,
    isStandalone,
    isIosNonStandalone,
    showInstallBanner,
    canEnable,
    enable,
    sendCanary,
  }
}

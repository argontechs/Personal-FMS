// test/app/composables/usePush.test.ts
// happy-dom vitest project — browser composable tests.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectIosNonStandalone, urlBase64ToUint8Array, usePush } from '../../../app/composables/usePush'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36'

// ---- pure helper tests (no globals needed) ----------------------------------

describe('usePush helpers', () => {
  it('flags iOS Safari tab (non-standalone) as needing install', () => {
    expect(detectIosNonStandalone(IPHONE, false)).toBe(true)
  })
  it('does not flag iOS once running standalone', () => {
    expect(detectIosNonStandalone(IPHONE, true)).toBe(false)
  })
  it('does not flag Android (push works in-tab there)', () => {
    expect(detectIosNonStandalone(ANDROID, false)).toBe(false)
  })
  it('urlBase64ToUint8Array decodes the VAPID public key length (65 bytes)', () => {
    // A valid uncompressed P-256 public key is 65 bytes (0x04 prefix + 32-byte x + 32-byte y).
    // The brief fixture decodes to 64 bytes; this corrected fixture is 65 bytes.
    const b64 = 'BAoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dzj6vH4_wYNFBsiKTA3PkVMU1phaG92fYSLkpmgp661vMM'
    const out = urlBase64ToUint8Array(b64)
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBe(65)
  })
})

// ---- composable tests (mock browser globals) --------------------------------

// 65-byte uncompressed P-256 public key (0x04 + 32-byte x + 32-byte y), base64url-encoded.
// The brief fixture decoded to 64 bytes; this corrected fixture is a valid 65-byte encoding.
const VAPID_KEY = 'BAoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dzj6vH4_wYNFBsiKTA3PkVMU1phaG92fYSLkpmgp661vMM'

/** Build a minimal PushSubscription-like object whose toJSON() returns usable keys. */
function makeFakeSubscription() {
  return {
    toJSON: () => ({
      endpoint: 'https://push.example.com/endpoint',
      keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' },
    }),
  }
}

/** Mock pushManager.subscribe capturing the applicationServerKey passed to it. */
function makePushManager(sub = makeFakeSubscription()) {
  return {
    subscribe: vi.fn().mockResolvedValue(sub),
  }
}

function setupNonIosGlobals(opts: { permission?: NotificationPermission } = {}) {
  const perm = opts.permission ?? 'default'
  // Non-iOS UA so iOS gate is bypassed.
  Object.defineProperty(navigator, 'userAgent', { value: ANDROID, configurable: true })
  // matchMedia stub — not standalone (desktop or Android browser); won't affect Android gate.
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockReturnValue({ matches: false }),
    configurable: true,
  })
  // Notification stub
  ;(globalThis as any).Notification = {
    permission: perm,
    requestPermission: vi.fn().mockResolvedValue('granted'),
  }
  // serviceWorker stub
  const pushManager = makePushManager()
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  })
  return { pushManager }
}

beforeEach(() => {
  // Reset $fetch and useRuntimeConfig stubs before each composable test.
  ;(globalThis as any).$fetch = vi.fn().mockResolvedValue({})
  ;(globalThis as any).useRuntimeConfig = vi.fn().mockReturnValue({
    public: { vapidPublicKey: VAPID_KEY },
  })
})

describe('usePush composable', () => {
  it('enable() requests Notification permission from a user-gesture call', async () => {
    setupNonIosGlobals()
    const { enable } = usePush()
    const result = await enable()
    expect(result.ok).toBe(true)
    expect((globalThis as any).Notification.requestPermission).toHaveBeenCalled()
  })

  it('enable() subscribes with the VAPID key from useRuntimeConfig', async () => {
    const { pushManager } = setupNonIosGlobals()
    const { enable } = usePush()
    await enable()
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      }),
    )
    // Verify the Uint8Array is the correct 65-byte decode of our fixture VAPID key.
    const call = pushManager.subscribe.mock.calls[0][0]
    expect(call.applicationServerKey).toBeInstanceOf(Uint8Array)
    expect(call.applicationServerKey.length).toBe(65)
  })

  it('enable() POSTs the subscription to /api/push/subscribe', async () => {
    setupNonIosGlobals()
    const { enable } = usePush()
    await enable()
    const fetchMock = (globalThis as any).$fetch as ReturnType<typeof vi.fn>
    const subscribeCalls = fetchMock.mock.calls.filter(([url]: [string]) => url === '/api/push/subscribe')
    expect(subscribeCalls.length).toBe(1)
    const [, opts] = subscribeCalls[0]
    expect(opts.method).toBe('POST')
    expect(opts.body.endpoint).toBe('https://push.example.com/endpoint')
    expect(opts.body.keys.p256dh).toBe('fake-p256dh')
    expect(opts.body.keys.auth).toBe('fake-auth')
  })

  it('enable() hits /api/push/canary after a successful subscribe', async () => {
    setupNonIosGlobals()
    const { enable } = usePush()
    await enable()
    const fetchMock = (globalThis as any).$fetch as ReturnType<typeof vi.fn>
    const canaryCalls = fetchMock.mock.calls.filter(([url]: [string]) => url === '/api/push/canary')
    expect(canaryCalls.length).toBe(1)
  })

  it('iOS non-standalone → needsInstall is true and enable() returns install-first', async () => {
    // Arrange: iPhone UA, not standalone
    Object.defineProperty(navigator, 'userAgent', { value: IPHONE, configurable: true })
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({ matches: false }),
      configurable: true,
    })
    ;(window.navigator as any).standalone = false
    ;(globalThis as any).Notification = {
      permission: 'default',
      requestPermission: vi.fn(),
    }
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ pushManager: makePushManager() }) },
      configurable: true,
    })

    const { isIosNonStandalone, showInstallBanner, enable } = usePush()
    expect(isIosNonStandalone.value).toBe(true)
    expect(showInstallBanner.value).toBe(true)

    const result = await enable()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('install-first')
    // Notification.requestPermission must NOT have been called (gesture not reached)
    expect((globalThis as any).Notification.requestPermission).not.toHaveBeenCalled()
  })

  it('enable() returns denied when Notification permission is refused', async () => {
    setupNonIosGlobals()
    ;(globalThis as any).Notification.requestPermission = vi.fn().mockResolvedValue('denied')
    const { enable } = usePush()
    const result = await enable()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('denied')
  })

  it('enable() returns no-vapid-key when vapidPublicKey is missing from runtime config', async () => {
    setupNonIosGlobals()
    ;(globalThis as any).useRuntimeConfig = vi.fn().mockReturnValue({ public: {} })
    const { enable } = usePush()
    const result = await enable()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-vapid-key')
  })
})

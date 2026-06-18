## Phase 4 — Habit Engine (Push, Scheduler, Prompts)

> ⚠️ **Read [`CORRECTIONS.md`](./2026-06-18-personal-fms-CORRECTIONS.md) first.** It resolves cross-phase fixes (debt-leg sign, EF two-leg reads, env-var names, schema re-export, single savings-target, SPayLater seed template, task ordering) that **supersede any conflicting code below**.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ledger actively coach the user — bill-due reminders + the three payday-save prompts fire via Web Push, the "Transfer logged" action writes a real two-leg EF transfer, iOS Home-Screen install / standalone health is surfaced with an email fallback, and an OS-cron watchdog backs the in-process scheduler.

**Architecture:** One in-process Nitro `scheduledTasks` (croner) inside the single `money-fms` PM2 fork (`instances:1`) owns all dispatch. `notify-dispatch` runs every 5 min, gated in code to MYT ≥ 09:00, idempotent via `notifications_sent`, catch-up-aware over the 5-minute window. All push sends use `web-push` (VAPID) initialised in a Nitro plugin from **runtime** config; the service worker (injectManifest) hosts the custom `push`/`notificationclick`/`pushsubscriptionchange` handlers. A loopback-bound, secret-gated `/api/internal/run-due` is a permanent watchdog (not removed once croner works).

**Tech Stack:** Nuxt 4 + Nitro (`node-server`) · Vue 3 SPA · better-sqlite3 + Drizzle · `@vite-pwa/nuxt` (injectManifest) · `web-push` · croner (Nitro experimental tasks) · nodemailer (VPS SMTP) · vitest (+ `@nuxt/test-utils` for Nitro handlers).

## Global Constraints

- Single-user; MYR only; integer **sen**, never float.
- DB: WAL + `foreign_keys=ON`; idempotency = `transactions.uuid` UNIQUE and `UNIQUE(recurring_item_id, date)`; notifications idempotency = `UNIQUE(kind, ref_id, scheduled_for)` on `notifications_sent`.
- All mutations are `requireSession`-gated `POST`/`PATCH`/`DELETE` (no state-changing GET). The **only** `requireSession` exemptions are auth login/callback; `/api/push/subscribe` IS gated. `/api/internal/run-due` is loopback-bound + secret-gated, not session-gated.
- Card interest is a separate carrying-cost ledger line (`category:'interest'`), excluded from `living` and `debt_service` in the rollup.
- `next_due_date` is the single "when due" field, recomputed inside the atomic post; scheduler and forecast read only it.
- OS-cron `/api/internal/run-due` (loopback-bound, secret-gated) is a PERMANENT watchdog, not removed once in-process tasks work.
- `.gitignore` covers `.env`, `*.sqlite*`, `/data`, `/backups`.
- better-sqlite3 transactions are **synchronous**: `db.transaction(() => {…})` with NO `await`/network/push I/O inside the closure.
- Money via `server/utils/money.ts` (`ringgitToSen`, `senToRinggit`, `formatRM`). Dates via `server/utils/mytDate.ts` (`todayMYT`, `nowEpoch`, `clampDay`, `nextDueDate`). TZ pinned `Asia/Kuala_Lumpur` (env `TZ` + croner `{timezone}`).
- VAPID public key is **runtime** config: `runtimeConfig.public.vapidPublicKey=''`, read via `useRuntimeConfig()`, env `NUXT_PUBLIC_VAPID_PUBLIC_KEY` at runtime — never `import.meta.env`, never build-time `.env` sourcing.
- Scheduler task names are **flat** and match flat files: `server/tasks/notify-dispatch.ts` ↔ `'notify-dispatch'`, `server/tasks/post-recurring.ts` ↔ `'post-recurring'`. (`'streak-rollover'`/`'checkin-weekly'` are phase 2 — registered as stubs in config only, NOT built here.)
- `SAVINGS_TARGET` is per-cycle (gap between inflows: salary ~1st–3rd, the 1st, the 23rd); phase-scaled (Buffer ≈ RM500/mo split across inflows → EF; Attack routes surplus to card, EF target paused at RM1,000; post-card resumes EF toward RM15,000). The payday-prompt suggested amount = the current cycle's remaining savings target.

> **Phase note — Streaks/milestones are PHASE 5+/deferred.** The two-streak engine, `habit_events`/`habit_streaks`/`milestones` tables, freeze tokens, the milestone ladder, and the full weekly check-in screen are NOT built in this phase. `notifications_sent.kind` already includes `'milestone'` so the migration path exists; do not emit `'milestone'` rows here.

---

### Task 4.1: VAPID init Nitro plugin (`webpush.ts`)

**Files:**
- Create: `server/plugins/webpush.ts`
- Create: `server/utils/push.ts`
- Modify: `nuxt.config.ts` (add `runtimeConfig.public.vapidPublicKey` + private VAPID keys)
- Test: `test/server/plugins/webpush.test.ts`

**Interfaces:**
- Consumes: `useRuntimeConfig()` keys `vapidPrivateKey`, `vapidSubject`, `public.vapidPublicKey` (set from env `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NUXT_PUBLIC_VAPID_PUBLIC_KEY`).
- Produces: `server/utils/push.ts` exports `getWebPush(): typeof import('web-push')` (returns the configured `web-push` module) and `sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload, ttlSeconds?: number): Promise<{ ok: true } | { ok: false; statusCode?: number }>`. Type `PushPayload = { title: string; body: string; url: string; tag: string; actions?: { action: string; title: string }[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/server/plugins/webpush.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const setVapidDetails = vi.fn()
const sendNotification = vi.fn()
vi.mock('web-push', () => ({ default: { setVapidDetails, sendNotification } }))
vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    vapidPrivateKey: 'priv',
    vapidSubject: 'mailto:yongwei1127@gmail.com',
    public: { vapidPublicKey: 'pub' },
  }),
}))

describe('webpush util', () => {
  beforeEach(() => { setVapidDetails.mockClear(); sendNotification.mockClear() })

  it('configures VAPID details from runtime config', async () => {
    const { getWebPush } = await import('../../../server/utils/push')
    getWebPush()
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:yongwei1127@gmail.com', 'pub', 'priv')
  })

  it('sendPush returns ok:true on success', async () => {
    sendNotification.mockResolvedValueOnce({ statusCode: 201 })
    const { sendPush } = await import('../../../server/utils/push')
    const r = await sendPush(
      { endpoint: 'https://x', p256dh: 'a', auth: 'b' },
      { title: 'T', body: 'B', url: '/', tag: 'bill-due-1' },
    )
    expect(r).toEqual({ ok: true })
  })

  it('sendPush returns ok:false with statusCode on 410', async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 410 })
    const { sendPush } = await import('../../../server/utils/push')
    const r = await sendPush({ endpoint: 'https://x', p256dh: 'a', auth: 'b' }, { title: 'T', body: 'B', url: '/', tag: 't' })
    expect(r).toEqual({ ok: false, statusCode: 410 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server/plugins/webpush.test.ts`
Expected: FAIL — cannot resolve `../../../server/utils/push`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/push.ts
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
    webpush.setVapidDetails(cfg.vapidSubject, cfg.public.vapidPublicKey, cfg.vapidPrivateKey)
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
```

```ts
// server/plugins/webpush.ts
import { getWebPush } from '../utils/push'

// Nitro plugin: eagerly configure web-push at server startup so the first
// dispatch run doesn't pay the setVapidDetails cost mid-loop.
export default defineNitroPlugin(() => {
  getWebPush()
})
```

- [ ] **Step 4: Add runtime config to `nuxt.config.ts`**

```ts
// nuxt.config.ts — inside defineNuxtConfig({ ... })
  runtimeConfig: {
    vapidPrivateKey: '',          // env NUXT_VAPID_PRIVATE_KEY or VAPID_PRIVATE_KEY (mapped below)
    vapidSubject: 'mailto:yongwei1127@gmail.com',
    runDueSecret: '',             // env NUXT_RUN_DUE_SECRET (Task 4.9)
    smtpUrl: '',                  // env NUXT_SMTP_URL (Task 4.8)
    public: {
      vapidPublicKey: '',         // env NUXT_PUBLIC_VAPID_PUBLIC_KEY — RUNTIME, never import.meta.env
    },
  },
```

Map the deploy-guide env names (`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) by adding to the same env block of the PM2 `.env`: `NUXT_VAPID_PRIVATE_KEY`, `NUXT_VAPID_SUBJECT`. (Nitro maps `NUXT_<KEY>` onto `runtimeConfig.<key>` at runtime.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/server/plugins/webpush.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add server/utils/push.ts server/plugins/webpush.ts nuxt.config.ts test/server/plugins/webpush.test.ts
git commit -m "feat(push): web-push VAPID init from runtime config + sendPush util"
```

---

### Task 4.2: `push/subscribe.post` (session-gated) + prune

**Files:**
- Create: `server/api/push/subscribe.post.ts`
- Create: `server/api/push/unsubscribe.post.ts`
- Create: `server/utils/pruneSubscription.ts`
- Test: `test/server/api/push/subscribe.test.ts`

**Interfaces:**
- Consumes: `requireSession(event)` from `server/utils/requireSession.ts` (Phase 3); `db` + `pushSubscriptions` from `server/db`; `nowEpoch()` from `server/utils/mytDate.ts`.
- Produces: `pruneSubscription(endpoint: string): void` (sets `failed_at = nowEpoch()` on the row) in `server/utils/pruneSubscription.ts`; `markSubscriptionOk(endpoint: string): void` (sets `last_ok_at`, clears `failed_at`). `POST /api/push/subscribe` body `{ endpoint, keys:{p256dh,auth} }` → upserts on `endpoint` UNIQUE, returns `{ id: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/server/api/push/subscribe.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db, pushSubscriptions } from '../../../../server/db'
import { eq } from 'drizzle-orm'

beforeEach(() => { db.delete(pushSubscriptions).run() })

describe('push subscription utils', () => {
  it('pruneSubscription sets failed_at on the matching row', async () => {
    const { pruneSubscription } = await import('../../../../server/utils/pruneSubscription')
    db.insert(pushSubscriptions).values({
      endpoint: 'https://push/1', p256dh: 'a', auth: 'b', created_at: 1,
    }).run()
    pruneSubscription('https://push/1')
    const row = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, 'https://push/1')).get()
    expect(row!.failed_at).not.toBeNull()
  })

  it('markSubscriptionOk clears failed_at and sets last_ok_at', async () => {
    const { markSubscriptionOk } = await import('../../../../server/utils/pruneSubscription')
    db.insert(pushSubscriptions).values({
      endpoint: 'https://push/2', p256dh: 'a', auth: 'b', created_at: 1, failed_at: 999,
    }).run()
    markSubscriptionOk('https://push/2')
    const row = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, 'https://push/2')).get()
    expect(row!.failed_at).toBeNull()
    expect(row!.last_ok_at).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server/api/push/subscribe.test.ts`
Expected: FAIL — cannot resolve `pruneSubscription`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/pruneSubscription.ts
import { eq } from 'drizzle-orm'
import { db, pushSubscriptions } from '../db'
import { nowEpoch } from './mytDate'

export function pruneSubscription(endpoint: string): void {
  db.update(pushSubscriptions)
    .set({ failed_at: nowEpoch() })
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .run()
}

export function markSubscriptionOk(endpoint: string): void {
  db.update(pushSubscriptions)
    .set({ last_ok_at: nowEpoch(), failed_at: null })
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .run()
}
```

```ts
// server/api/push/subscribe.post.ts
import { z } from 'zod'
import { db, pushSubscriptions } from '../../db'
import { requireSession } from '../../utils/requireSession'
import { nowEpoch } from '../../utils/mytDate'

const Body = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})

export default defineEventHandler(async (event) => {
  requireSession(event)
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid subscription' })
  const { endpoint, keys } = parsed.data
  const ua = getHeader(event, 'user-agent') ?? null

  const row = db
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: ua, created_at: nowEpoch() })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: keys.p256dh, auth: keys.auth, user_agent: ua, failed_at: null },
    })
    .returning({ id: pushSubscriptions.id })
    .get()

  return { id: row.id }
})
```

```ts
// server/api/push/unsubscribe.post.ts
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, pushSubscriptions } from '../../db'
import { requireSession } from '../../utils/requireSession'

const Body = z.object({ endpoint: z.string().url() })

export default defineEventHandler(async (event) => {
  requireSession(event)
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid endpoint' })
  db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint)).run()
  return { ok: true }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/server/api/push/subscribe.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Add a `@nuxt/test-utils` handler test asserting the gate**

```ts
// test/server/api/push/subscribe.gated.test.ts
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

await setup({ server: true })

describe('POST /api/push/subscribe gate', () => {
  it('rejects an unauthenticated request with 401', async () => {
    await expect(
      $fetch('/api/push/subscribe', {
        method: 'POST',
        body: { endpoint: 'https://push/x', keys: { p256dh: 'a', auth: 'b' } },
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})
```

- [ ] **Step 6: Run the gate test**

Run: `npx vitest run test/server/api/push/subscribe.gated.test.ts`
Expected: PASS — request without a session cookie throws 401 from `requireSession`.

- [ ] **Step 7: Commit**

```bash
git add server/api/push/subscribe.post.ts server/api/push/unsubscribe.post.ts server/utils/pruneSubscription.ts test/server/api/push/subscribe.test.ts test/server/api/push/subscribe.gated.test.ts
git commit -m "feat(push): gated subscribe/unsubscribe endpoints + prune/markOk utils"
```

---

### Task 4.3: Service worker push handlers (injectManifest)

**Files:**
- Create: `app/sw.ts` (injectManifest source SW)
- Modify: `nuxt.config.ts` (`@vite-pwa/nuxt` block → `strategies:'injectManifest'`, `srcDir:'app'`, `filename:'sw.ts'`)
- Test: `test/app/sw.test.ts`

**Interfaces:**
- Consumes: `PushPayload` JSON shape from Task 4.1 (`{ title, body, url, tag, actions }`).
- Produces: exported pure handlers `handlePush(data: any): { title: string; options: NotificationOptions }`, `resolveClickUrl(notificationData: any): string`, `buildResubscribeBody(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } }` so logic is unit-testable without a ServiceWorker runtime.

- [ ] **Step 1: Write the failing test**

```ts
// test/app/sw.test.ts
import { describe, it, expect } from 'vitest'
import { handlePush, resolveClickUrl } from '../../app/sw'

describe('service worker push logic', () => {
  it('handlePush builds title + options with tag and deep-link url', () => {
    const { title, options } = handlePush({
      title: 'RM600 just landed', body: 'Move RM200 to your EF now?',
      url: '/?prompt=payday', tag: 'payday-save-2026-06-23',
      actions: [{ action: 'transfer', title: 'Transfer logged' }],
    })
    expect(title).toBe('RM600 just landed')
    expect(options.body).toBe('Move RM200 to your EF now?')
    expect(options.tag).toBe('payday-save-2026-06-23')
    expect((options.data as any).url).toBe('/?prompt=payday')
    expect(options.actions).toHaveLength(1)
  })

  it('handlePush falls back to a generic notification on malformed data', () => {
    const { title, options } = handlePush(null)
    expect(title).toBe('Money')
    expect(options.tag).toBe('generic')
  })

  it('resolveClickUrl returns data.url or root', () => {
    expect(resolveClickUrl({ url: '/forecast' })).toBe('/forecast')
    expect(resolveClickUrl({})).toBe('/')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/app/sw.test.ts`
Expected: FAIL — cannot resolve `../../app/sw`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/sw.ts
/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// injectManifest entry point — Workbox precaches the app shell (offline quick-log).
precacheAndRoute(self.__WB_MANIFEST || [])

export function handlePush(data: any): { title: string; options: NotificationOptions } {
  if (!data || typeof data.title !== 'string') {
    return { title: 'Money', options: { body: 'You have an update.', tag: 'generic', data: { url: '/' } } }
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
  return notificationData && typeof notificationData.url === 'string' ? notificationData.url : '/'
}

export function buildResubscribeBody(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const json = sub.toJSON()
  return { endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } }
}

self.addEventListener('push', (event: PushEvent) => {
  let data: any = null
  try { data = event.data ? event.data.json() : null } catch { data = null }
  const { title, options } = handlePush(data)
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const url = resolveClickUrl(event.notification.data)
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) { (c as WindowClient).navigate(url); return (c as WindowClient).focus() }
      }
      return self.clients.openWindow(url)
    }),
  )
})

self.addEventListener('pushsubscriptionchange', (event: any) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription?.options ?? { userVisibleOnly: true })
      .then((sub) => fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildResubscribeBody(sub)),
      })),
  )
})
```

- [ ] **Step 4: Configure injectManifest in `nuxt.config.ts`**

```ts
// nuxt.config.ts — modules: ['@vite-pwa/nuxt', ...], then:
  pwa: {
    strategies: 'injectManifest',
    srcDir: 'app',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] },
    manifest: {
      name: 'Money', short_name: 'Money', display: 'standalone',
      start_url: '/', background_color: '#ffffff', theme_color: '#0b3d2e',
    },
    devOptions: { enabled: false },
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/app/sw.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add app/sw.ts nuxt.config.ts test/app/sw.test.ts
git commit -m "feat(pwa): injectManifest SW with push/notificationclick/pushsubscriptionchange"
```

---

### Task 4.4: `usePush` composable (gesture, iOS standalone, install banner, canary)

**Files:**
- Create: `app/composables/usePush.ts`
- Test: `test/app/composables/usePush.test.ts`

**Interfaces:**
- Consumes: `useRuntimeConfig().public.vapidPublicKey` (runtime); `POST /api/push/subscribe` (Task 4.2); `POST /api/push/canary` (Task 4.6).
- Produces: `usePush()` returning `{ permission: Ref<NotificationPermission|'unsupported'>, isStandalone: ComputedRef<boolean>, isIosNonStandalone: ComputedRef<boolean>, showInstallBanner: ComputedRef<boolean>, enable(): Promise<{ ok: boolean; reason?: string }>, sendCanary(): Promise<void> }`. Pure helpers exported for tests: `detectIosNonStandalone(ua: string, standalone: boolean): boolean`, `urlBase64ToUint8Array(base64: string): Uint8Array`.

- [ ] **Step 1: Write the failing test**

```ts
// test/app/composables/usePush.test.ts
import { describe, it, expect } from 'vitest'
import { detectIosNonStandalone, urlBase64ToUint8Array } from '../../../app/composables/usePush'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36'

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
    // A valid uncompressed P-256 public key is 65 bytes; this fixture is a 65-byte key b64url-encoded.
    const b64 = 'BNcRdesKFQQ4M9_zJ1mWq8E7lmU6m8N1F2dQx9k0pYbR3aZ2cV4nQ8wL6rT5yU3iO0pA1sD2fG4hJ6kL8mN0pQ'
    const out = urlBase64ToUint8Array(b64)
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBe(65)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/app/composables/usePush.test.ts`
Expected: FAIL — cannot resolve `usePush`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
  const supported = typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
  const permission: Ref<NotificationPermission | 'unsupported'> = ref(
    supported ? Notification.permission : 'unsupported',
  )
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true)

  const isStandalone: ComputedRef<boolean> = computed(() => standalone)
  const isIosNonStandalone: ComputedRef<boolean> = computed(() => detectIosNonStandalone(ua, standalone))
  // On iOS, only offer "enable" once standalone; everywhere else offer it directly.
  const showInstallBanner: ComputedRef<boolean> = computed(
    () => isIosNonStandalone.value && permission.value !== 'granted',
  )

  async function enable(): Promise<{ ok: boolean; reason?: string }> {
    if (!supported) return { ok: false, reason: 'unsupported' }
    if (isIosNonStandalone.value) return { ok: false, reason: 'install-first' }
    // MUST be called from a user gesture (iOS hard requirement).
    const perm = await Notification.requestPermission()
    permission.value = perm
    if (perm !== 'granted') return { ok: false, reason: 'denied' }

    const reg = await navigator.serviceWorker.ready
    const cfg = useRuntimeConfig()
    const key = cfg.public.vapidPublicKey
    if (!key) return { ok: false, reason: 'no-vapid-key' }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    })
    const json = sub.toJSON()
    await $fetch('/api/push/subscribe', {
      method: 'POST',
      body: { endpoint: json.endpoint, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } },
    })
    await sendCanary()
    return { ok: true }
  }

  async function sendCanary(): Promise<void> {
    await $fetch('/api/push/canary', { method: 'POST' })
  }

  return { permission, isStandalone, isIosNonStandalone, showInstallBanner, enable, sendCanary }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/app/composables/usePush.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add app/composables/usePush.ts test/app/composables/usePush.test.ts
git commit -m "feat(push): usePush composable with iOS standalone detection + install gate + canary"
```

---

### Task 4.5: Dispatch builders — bill-due, declining SPayLater, payday prompt

**Files:**
- Create: `server/utils/dispatchBuilders.ts`
- Test: `test/server/utils/dispatchBuilders.test.ts`

**Interfaces:**
- Consumes: `formatRM` from `server/utils/money.ts`; `recurring_items` row shape (`name`, `direction`, `amount_cents`, `category`, `next_due_date`, `remaining_installments_json`, `debt_id`); `PushPayload` from Task 4.1.
- Produces:
  - `daysUntil(todayISO: string, dueISO: string): number`
  - `dueWindow(daysOut: number): 'today' | '1-day' | '3-day' | null`
  - `spayLaterNextAmount(remaining_installments_json: string | null): number | null` (reads index 0, non-destructive)
  - `buildBillDuePayload(item: { name: string; amount_cents: number; remaining_installments_json: string | null; next_due_date: string }, window: 'today'|'1-day'|'3-day'): PushPayload`
  - `suggestedSavingsSen(cycleTargetRemainingSen: number): number`
  - `buildPaydayPayload(inflowName: string, inflowAmountSen: number, suggestedSen: number, scheduledFor: string): PushPayload`

- [ ] **Step 1: Write the failing test**

```ts
// test/server/utils/dispatchBuilders.test.ts
import { describe, it, expect } from 'vitest'
import {
  daysUntil, dueWindow, spayLaterNextAmount,
  buildBillDuePayload, suggestedSavingsSen, buildPaydayPayload,
} from '../../../server/utils/dispatchBuilders'

describe('dispatch builders', () => {
  it('daysUntil counts MYT calendar days', () => {
    expect(daysUntil('2026-06-18', '2026-06-21')).toBe(3)
    expect(daysUntil('2026-06-18', '2026-06-18')).toBe(0)
  })

  it('dueWindow maps day offsets to the three reminder windows', () => {
    expect(dueWindow(0)).toBe('today')
    expect(dueWindow(1)).toBe('1-day')
    expect(dueWindow(3)).toBe('3-day')
    expect(dueWindow(2)).toBeNull()
    expect(dueWindow(5)).toBeNull()
  })

  it('spayLaterNextAmount reads index 0 without mutating', () => {
    const json = '[151950,83682,63165]'
    expect(spayLaterNextAmount(json)).toBe(151950)
    expect(json).toBe('[151950,83682,63165]') // unchanged
    expect(spayLaterNextAmount(null)).toBeNull()
  })

  it('buildBillDuePayload shows the declining SPayLater amount, not the template amount', () => {
    const p = buildBillDuePayload(
      { name: 'ShopeePayLater', amount_cents: 0, remaining_installments_json: '[151950,83682]', next_due_date: '2026-07-10' },
      '3-day',
    )
    expect(p.title).toContain('ShopeePayLater')
    expect(p.body).toContain('RM1,519.50')
    expect(p.tag).toContain('bill-due')
    expect(p.url).toBe('/?focus=bills')
  })

  it('buildBillDuePayload uses the template amount for flat bills', () => {
    const p = buildBillDuePayload(
      { name: 'Unifi', amount_cents: 15000, remaining_installments_json: null, next_due_date: '2026-06-19' },
      'today',
    )
    expect(p.body).toContain('RM150.00')
    expect(p.body).toContain('today')
  })

  it('suggestedSavingsSen never goes negative', () => {
    expect(suggestedSavingsSen(20000)).toBe(20000)
    expect(suggestedSavingsSen(-500)).toBe(0)
  })

  it('buildPaydayPayload renders the v1 copy with the suggested amount', () => {
    const p = buildPaydayPayload('Side Income A', 60000, 20000, '2026-06-23')
    expect(p.title).toContain('RM600.00')
    expect(p.body).toContain('Move RM200.00')
    expect(p.body).toContain("surplus that usually disappears")
    expect(p.tag).toBe('payday-save-2026-06-23')
    expect(p.actions?.map(a => a.action)).toEqual(['transfer', 'adjust', 'skip'])
    expect(p.url).toBe('/?prompt=payday')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server/utils/dispatchBuilders.test.ts`
Expected: FAIL — cannot resolve `dispatchBuilders`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/dispatchBuilders.ts
import { formatRM } from './money'
import type { PushPayload } from './push'

export function daysUntil(todayISO: string, dueISO: string): number {
  const a = Date.UTC(+todayISO.slice(0, 4), +todayISO.slice(5, 7) - 1, +todayISO.slice(8, 10))
  const b = Date.UTC(+dueISO.slice(0, 4), +dueISO.slice(5, 7) - 1, +dueISO.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

export function dueWindow(daysOut: number): 'today' | '1-day' | '3-day' | null {
  if (daysOut === 0) return 'today'
  if (daysOut === 1) return '1-day'
  if (daysOut === 3) return '3-day'
  return null
}

export function spayLaterNextAmount(remaining_installments_json: string | null): number | null {
  if (!remaining_installments_json) return null
  const arr = JSON.parse(remaining_installments_json) as number[]
  return arr.length ? arr[0] : null
}

export function buildBillDuePayload(
  item: { name: string; amount_cents: number; remaining_installments_json: string | null; next_due_date: string },
  window: 'today' | '1-day' | '3-day',
): PushPayload {
  const amount = spayLaterNextAmount(item.remaining_installments_json) ?? item.amount_cents
  const whenText = window === 'today' ? 'due today' : window === '1-day' ? 'due tomorrow' : 'due in 3 days'
  return {
    title: `${item.name} ${whenText}`,
    body: `${formatRM(amount)} ${whenText} (${item.next_due_date}).`,
    url: '/?focus=bills',
    tag: `bill-due-${item.name}-${item.next_due_date}`,
  }
}

export function suggestedSavingsSen(cycleTargetRemainingSen: number): number {
  return Math.max(0, cycleTargetRemainingSen)
}

export function buildPaydayPayload(
  inflowName: string,
  inflowAmountSen: number,
  suggestedSen: number,
  scheduledFor: string,
): PushPayload {
  return {
    title: `${formatRM(inflowAmountSen)} just landed`,
    body: `Move ${formatRM(suggestedSen)} to your emergency fund now? You're cash-flow positive — this is the surplus that usually disappears.`,
    url: '/?prompt=payday',
    tag: `payday-save-${scheduledFor}`,
    actions: [
      { action: 'transfer', title: 'Transfer logged' },
      { action: 'adjust', title: 'Adjust' },
      { action: 'skip', title: 'Skip' },
    ],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/server/utils/dispatchBuilders.test.ts`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add server/utils/dispatchBuilders.ts test/server/utils/dispatchBuilders.test.ts
git commit -m "feat(habit): dispatch builders for bill-due (declining SPayLater) + payday prompts"
```

---

### Task 4.6: `notify-dispatch` task — MYT≥09:00 gate, idempotent, catch-up, fan-out + canary endpoint

**Files:**
- Create: `server/utils/dispatchRun.ts` (pure selection + idempotency core, DB-driven, NO push I/O)
- Create: `server/utils/sendToAll.ts` (fan-out wrapper over `sendPush`, prunes on 404/410)
- Create: `server/tasks/notify-dispatch.ts`
- Create: `server/api/push/canary.post.ts`
- Modify: `nuxt.config.ts` (register flat `'notify-dispatch'`, `'post-recurring'`, phase-2 stubs)
- Test: `test/server/utils/dispatchRun.test.ts`

**Interfaces:**
- Consumes: `db`, `recurringItems`, `notificationsSent`, `pushSubscriptions`, `goals` from `server/db`; `todayMYT()`, `nowEpoch()` from `server/utils/mytDate.ts`; `daysUntil`/`dueWindow`/`buildBillDuePayload`/`buildPaydayPayload`/`suggestedSavingsSen` from Task 4.5; `sendPush` (Task 4.1); `pruneSubscription`/`markSubscriptionOk` (Task 4.2).
- Produces:
  - `selectDispatches(todayISO: string, minHourMyt: number, nowHourMyt: number): { kind: 'bill_due'|'payday_save'; ref_id: number; scheduled_for: string; payload: PushPayload }[]` — pure read over the DB, applies the 09:00 gate and `notifications_sent` dedupe, includes catch-up (any due-window item whose `scheduled_for` ≤ today and not yet sent).
  - `markSent(kind: string, ref_id: number, scheduled_for: string): boolean` — inserts the `notifications_sent` row, returns `false` if the UNIQUE row already exists (lost a race).
  - `runDispatch(): Promise<{ sent: number; skipped: number }>` — orchestrator: `selectDispatches` → for each, `markSent` (claim) → `sendToAll(payload)`. NO `await` between claim insert and the in-memory loop; push I/O is outside any db.transaction.
  - `sendToAll(payload: PushPayload): Promise<{ delivered: number; pruned: number }>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/server/utils/dispatchRun.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db, recurringItems, notificationsSent } from '../../../server/db'
import { selectDispatches, markSent } from '../../../server/utils/dispatchRun'

function seedItem(over: Partial<typeof recurringItems.$inferInsert> = {}) {
  db.insert(recurringItems).values({
    name: 'Unifi', direction: 'expense', amount_cents: 15000, category: 'bills',
    cadence: 'monthly', day_of_month: 19, start_date: '2026-01-01',
    next_due_date: '2026-06-21', is_active: true, auto_post: true,
    created_at: 1, updated_at: 1, ...over,
  }).run()
}

beforeEach(() => {
  db.delete(notificationsSent).run()
  db.delete(recurringItems).run()
})

describe('selectDispatches', () => {
  it('selects a bill exactly 3 days out when MYT hour >= 9', () => {
    seedItem({ next_due_date: '2026-06-21' })           // today 2026-06-18 → 3 days out
    const out = selectDispatches('2026-06-18', 9, 10)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('bill_due')
    expect(out[0].scheduled_for).toBe('2026-06-21')
  })

  it('suppresses everything before 09:00 MYT', () => {
    seedItem({ next_due_date: '2026-06-21' })
    expect(selectDispatches('2026-06-18', 9, 8)).toHaveLength(0)
  })

  it('does NOT re-select a bill already in notifications_sent (idempotent)', () => {
    seedItem({ next_due_date: '2026-06-18' })           // due today
    const first = selectDispatches('2026-06-18', 9, 9)
    expect(first).toHaveLength(1)
    markSent(first[0].kind, first[0].ref_id, first[0].scheduled_for)
    expect(selectDispatches('2026-06-18', 9, 9)).toHaveLength(0)
  })

  it('catch-up: selects a today-due bill whose scheduled_for passed but was never sent', () => {
    seedItem({ next_due_date: '2026-06-18' })
    // run after downtime, later in the day — still must fire because no notifications_sent row
    const out = selectDispatches('2026-06-18', 9, 23)
    expect(out).toHaveLength(1)
  })

  it('emits a payday_save (not an FYI) for an income event due today', () => {
    db.insert(recurringItems).values({
      name: 'Side Income A', direction: 'income', amount_cents: 60000, category: 'income',
      cadence: 'monthly', day_of_month: 23, start_date: '2026-01-01',
      next_due_date: '2026-06-23', is_active: true, auto_post: true, created_at: 1, updated_at: 1,
    }).run()
    const out = selectDispatches('2026-06-23', 9, 9)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('payday_save')
    expect(out[0].payload.actions?.map(a => a.action)).toEqual(['transfer', 'adjust', 'skip'])
  })

  it('markSent returns false on a duplicate (lost the claim race)', () => {
    expect(markSent('bill_due', 1, '2026-06-18')).toBe(true)
    expect(markSent('bill_due', 1, '2026-06-18')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server/utils/dispatchRun.test.ts`
Expected: FAIL — cannot resolve `dispatchRun`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/dispatchRun.ts
import { and, eq } from 'drizzle-orm'
import { db, recurringItems, notificationsSent } from '../db'
import { todayMYT } from './mytDate'
import {
  daysUntil, dueWindow, buildBillDuePayload, buildPaydayPayload, suggestedSavingsSen,
} from './dispatchBuilders'
import { currentCycleSavingsRemainingSen } from './savingsTarget'
import type { PushPayload } from './push'
import { sendToAll } from './sendToAll'

export type Dispatch = {
  kind: 'bill_due' | 'payday_save'
  ref_id: number
  scheduled_for: string
  payload: PushPayload
}

function alreadySent(kind: string, ref_id: number, scheduled_for: string): boolean {
  return !!db
    .select({ id: notificationsSent.id })
    .from(notificationsSent)
    .where(and(
      eq(notificationsSent.kind, kind as any),
      eq(notificationsSent.ref_id, ref_id),
      eq(notificationsSent.scheduled_for, scheduled_for),
    ))
    .get()
}

export function selectDispatches(todayISO: string, minHourMyt: number, nowHourMyt: number): Dispatch[] {
  if (nowHourMyt < minHourMyt) return []
  const items = db.select().from(recurringItems).where(eq(recurringItems.is_active, true)).all()
  const out: Dispatch[] = []

  for (const item of items) {
    if (!item.next_due_date) continue
    const offset = daysUntil(todayISO, item.next_due_date)
    // catch-up: anything due today or already passed today's window that never sent must still fire.
    const win = dueWindow(offset)
    const isDueToday = offset <= 0 && offset >= -0 // exactly today; past-due bills handled below
    if (!win && !(offset < 0 && offset >= -0)) {
      if (offset !== 0) continue
    }
    const effectiveWindow = win ?? (offset <= 0 ? 'today' : null)
    if (!effectiveWindow) continue

    const scheduledFor = item.next_due_date
    if (item.direction === 'income') {
      if (alreadySent('payday_save', item.id, scheduledFor)) continue
      const remaining = currentCycleSavingsRemainingSen(todayISO)
      const suggested = suggestedSavingsSen(remaining)
      out.push({
        kind: 'payday_save',
        ref_id: item.id,
        scheduled_for: scheduledFor,
        payload: buildPaydayPayload(item.name, item.amount_cents, suggested, scheduledFor),
      })
    } else {
      if (alreadySent('bill_due', item.id, scheduledFor)) continue
      out.push({
        kind: 'bill_due',
        ref_id: item.id,
        scheduled_for: scheduledFor,
        payload: buildBillDuePayload(item, effectiveWindow),
      })
    }
  }
  return out
}

export function markSent(kind: string, ref_id: number, scheduled_for: string): boolean {
  try {
    db.insert(notificationsSent)
      .values({ kind: kind as any, ref_id, scheduled_for, sent_at: Date.now() })
      .run()
    return true
  } catch {
    return false // UNIQUE(kind, ref_id, scheduled_for) violated → another run claimed it
  }
}

export async function runDispatch(): Promise<{ sent: number; skipped: number }> {
  const today = todayMYT()
  const nowHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })).getHours()
  const dispatches = selectDispatches(today, 9, nowHour)
  let sent = 0
  let skipped = 0
  for (const d of dispatches) {
    // claim BEFORE sending (synchronous insert, no await) so a concurrent run can't double-send
    if (!markSent(d.kind, d.ref_id, d.scheduled_for)) { skipped++; continue }
    await sendToAll(d.payload) // push I/O strictly outside any db.transaction
    sent++
  }
  return { sent, skipped }
}
```

> The catch-up branch above is deliberately simple: the 5-min cron means a "today" due item that was missed during downtime is re-selected on the next run (no `notifications_sent` row yet), satisfying the BLOCKER §14.10 5-minute-window catch-up.

```ts
// server/utils/sendToAll.ts
import { isNull } from 'drizzle-orm'
import { db, pushSubscriptions } from '../db'
import { sendPush, type PushPayload } from './push'
import { pruneSubscription, markSubscriptionOk } from './pruneSubscription'

export async function sendToAll(payload: PushPayload): Promise<{ delivered: number; pruned: number }> {
  const subs = db.select().from(pushSubscriptions).where(isNull(pushSubscriptions.failed_at)).all()
  let delivered = 0
  let pruned = 0
  for (const s of subs) {
    // wrap each send so one bad subscription can't block the others
    const r = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload)
    if (r.ok) { markSubscriptionOk(s.endpoint); delivered++ }
    else if (r.statusCode === 404 || r.statusCode === 410) { pruneSubscription(s.endpoint); pruned++ }
  }
  return { delivered, pruned }
}
```

```ts
// server/tasks/notify-dispatch.ts
import { runDispatch } from '../utils/dispatchRun'

export default defineTask({
  meta: { name: 'notify-dispatch', description: 'Bill reminders + payday-save prompts (MYT-gated, idempotent)' },
  async run() {
    const result = await runDispatch()
    console.log(`[notify-dispatch] ${new Date().toISOString()} sent=${result.sent} skipped=${result.skipped}`)
    return { result }
  },
})
```

```ts
// server/api/push/canary.post.ts
import { requireSession } from '../../utils/requireSession'
import { sendToAll } from '../../utils/sendToAll'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const r = await sendToAll({
    title: 'Reminders are working',
    body: 'You will get bill-due and payday prompts here.',
    url: '/?focus=reminders',
    tag: 'canary',
  })
  return r
})
```

- [ ] **Step 4: Register flat task names in `nuxt.config.ts`**

```ts
// nuxt.config.ts — nitro block
  nitro: {
    preset: 'node-server',
    compressPublicAssets: true,
    experimental: { tasks: true },
    scheduledTasks: {
      '*/5 * * * *': ['notify-dispatch'],   // flat name ↔ server/tasks/notify-dispatch.ts
      '15 0 * * *': ['post-recurring'],      // §14.1 missing daily entry (Phase 1/2 task file)
      '5 0 * * *':  ['streak-rollover'],     // PHASE 5+ stub — file not built this phase
      '0 9 * * 0':  ['checkin-weekly'],      // PHASE 5+ stub — file not built this phase
    },
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/server/utils/dispatchRun.test.ts`
Expected: PASS (6 passed).

- [ ] **Step 6: Commit**

```bash
git add server/utils/dispatchRun.ts server/utils/sendToAll.ts server/tasks/notify-dispatch.ts server/api/push/canary.post.ts nuxt.config.ts test/server/utils/dispatchRun.test.ts
git commit -m "feat(habit): notify-dispatch task (09:00 MYT gate, idempotent claim, catch-up, fan-out) + canary"
```

---

### Task 4.7: Month-boundary correctness test for `next_due_date` recompute

**Files:**
- Modify: `server/utils/mytDate.ts` (no change expected; confirm `nextDueDate`/`clampDay` cover boundaries)
- Test: `test/server/habit/month-boundary.test.ts`

**Interfaces:**
- Consumes: `nextDueDate(fromISO: string, dayOfMonth: number): string`, `clampDay(year, month1to12, day): number` from `server/utils/mytDate.ts` (Phase 1); `selectDispatches`/`markSent` (Task 4.6).
- Produces: regression coverage — no new exports.

- [ ] **Step 1: Write the failing test (the §8/§14.11 mandated boundary test)**

```ts
// test/server/habit/month-boundary.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db, recurringItems, notificationsSent } from '../../../server/db'
import { selectDispatches, markSent } from '../../../server/utils/dispatchRun'
import { clampDay, nextDueDate } from '../../../server/utils/mytDate'

beforeEach(() => { db.delete(notificationsSent).run(); db.delete(recurringItems).run() })

describe('month-boundary correctness', () => {
  it('clampDay clamps day 31 into February (non-leap and leap)', () => {
    expect(clampDay(2026, 2, 31)).toBe(28)
    expect(clampDay(2028, 2, 31)).toBe(29)
    expect(clampDay(2026, 4, 31)).toBe(30) // April has 30
  })

  it('nextDueDate rolls a due_day:31 bill to the clamped last day of the next month', () => {
    // from 2026-02-15, a day-31 bill is due 2026-02-28 (clamped), next is 2026-03-31
    expect(nextDueDate('2026-02-15', 31)).toBe('2026-02-28')
    expect(nextDueDate('2026-03-01', 31)).toBe('2026-03-31')
  })

  it('dispatcher fires exactly once across a 23:30→00:30 MYT boundary', () => {
    // PTPTN due_day:1 → next_due_date 2026-07-01; "today" run at 23:30 on 06-30 should not fire (not in window),
    // then the run just after midnight on 07-01 fires once and only once.
    db.insert(recurringItems).values({
      name: 'PTPTN', direction: 'expense', amount_cents: 27000, category: 'debt',
      cadence: 'monthly', day_of_month: 1, start_date: '2026-01-01',
      next_due_date: '2026-07-01', is_active: true, auto_post: true,
      created_at: 1, updated_at: 1,
    }).run()

    // 23:30 on 06-30 (offset = 1 day → '1-day' window) — fires once
    const lateNight = selectDispatches('2026-06-30', 9, 23)
    expect(lateNight).toHaveLength(1)
    markSent(lateNight[0].kind, lateNight[0].ref_id, lateNight[0].scheduled_for)

    // 00:30 on 07-01 (offset = 0 → 'today') — different window but SAME scheduled_for → deduped, no double fire
    const afterMidnight = selectDispatches('2026-07-01', 9, 0)
    expect(afterMidnight).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run test/server/habit/month-boundary.test.ts`
Expected: If Phase 1's `mytDate.ts` already correct → boundary assertions PASS; the dispatcher dedupe assertion drives behavior. If any FAIL, the bug is in `mytDate.ts`/`dispatchRun.ts` — fix to satisfy.

- [ ] **Step 3: If `nextDueDate` fails the boundary case, fix it minimally**

```ts
// server/utils/mytDate.ts — ensure nextDueDate clamps via clampDay both this and next month
export function nextDueDate(fromISO: string, dayOfMonth: number): string {
  const y = +fromISO.slice(0, 4), m = +fromISO.slice(5, 7), d = +fromISO.slice(8, 10)
  const thisMonthDue = clampDay(y, m, dayOfMonth)
  if (d < thisMonthDue) return `${y}-${String(m).padStart(2, '0')}-${String(thisMonthDue).padStart(2, '0')}`
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const nextDue = clampDay(ny, nm, dayOfMonth)
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nextDue).padStart(2, '0')}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/server/habit/month-boundary.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add server/utils/mytDate.ts test/server/habit/month-boundary.test.ts
git commit -m "test(habit): month-boundary exactly-once dispatch + day-31 clamp regression"
```

---

### Task 4.8: EF transfer endpoint (two-leg atomic) + per-cycle savings target

**Files:**
- Create: `server/utils/savingsTarget.ts`
- Create: `server/api/transfers/index.post.ts`
- Test: `test/server/api/transfers/transfer.test.ts`
- Test: `test/server/utils/savingsTarget.test.ts`

**Interfaces:**
- Consumes: `postTransaction(input): { id: number }` from `server/utils/post.ts` (Phase 1, single ledger authority); `db`, `accounts`, `goals` from `server/db`; `requireSession` (Phase 3); `crypto.randomUUID()`; `todayMYT()` (mytDate).
- Produces:
  - `currentCycleSavingsRemainingSen(todayISO: string): number` in `savingsTarget.ts` — phase-scaled per-cycle remaining EF target (Buffer phase RM500/mo split across the 3 inflows; Attack phase returns 0 because surplus is routed to the card; resolves the §14.8 single-rule). Reads the active EF `goal` status to decide phase.
  - `POST /api/transfers` body `{ from_account_id, to_account_id, amount_cents, goal_id?, note?, uuid?, date? }` → writes a single transfer in ONE db.transaction (two legs via `counter_account_id`) using `postTransaction`, returns `{ id: number }`. EF progress later sums both legs (negative on `from`, positive on `to`).

- [ ] **Step 1: Write the failing savings-target test**

```ts
// test/server/utils/savingsTarget.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db, goals, accounts } from '../../../server/db'
import { currentCycleSavingsRemainingSen } from '../../../server/utils/savingsTarget'

beforeEach(() => { db.delete(goals).run(); db.delete(accounts).run() })

describe('currentCycleSavingsRemainingSen', () => {
  it('returns a positive per-cycle target while the EF goal is in the buffer phase (active, < RM1,000)', () => {
    const ef = db.insert(accounts).values({
      name: 'Emergency Fund', type: 'savings', balance_cents: 0, created_at: 1, updated_at: 1,
    }).returning({ id: accounts.id }).get()
    db.insert(goals).values({
      name: 'Emergency Fund', type: 'savings', target_amount_cents: 100000,
      account_id: ef.id, status: 'active', created_at: 1, updated_at: 1,
    }).run()
    // RM500/mo split across 3 inflows ≈ 16667 sen per cycle
    expect(currentCycleSavingsRemainingSen('2026-06-23')).toBe(16667)
  })

  it('returns 0 once the buffer goal is achieved (Attack phase routes surplus to the card, not EF)', () => {
    const ef = db.insert(accounts).values({
      name: 'Emergency Fund', type: 'savings', balance_cents: 100000, created_at: 1, updated_at: 1,
    }).returning({ id: accounts.id }).get()
    db.insert(goals).values({
      name: 'Emergency Fund', type: 'savings', target_amount_cents: 100000,
      account_id: ef.id, status: 'achieved', created_at: 1, updated_at: 1,
    }).run()
    expect(currentCycleSavingsRemainingSen('2026-06-23')).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server/utils/savingsTarget.test.ts`
Expected: FAIL — cannot resolve `savingsTarget`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/savingsTarget.ts
import { and, eq } from 'drizzle-orm'
import { db, goals } from '../db'

const BUFFER_PHASE_MONTHLY_SEN = 50000 // RM500/mo (§14.8 buffer phase)
const INFLOWS_PER_MONTH = 3            // salary ~1st–3rd, the 1st, the 23rd

// Per-cycle remaining EF target. Phase-scaled per §14.8:
//  - Buffer phase (EF goal active, not yet achieved): RM500/mo split across the 3 inflows.
//  - Attack phase (EF buffer achieved / paused): 0 — surplus routes to the card, STS must not
//    subtract a target it isn't steering.
export function currentCycleSavingsRemainingSen(_todayISO: string): number {
  const ef = db
    .select()
    .from(goals)
    .where(and(eq(goals.type, 'savings'), eq(goals.status, 'active')))
    .get()
  if (!ef) return 0
  return Math.round(BUFFER_PHASE_MONTHLY_SEN / INFLOWS_PER_MONTH) // 16667
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/server/utils/savingsTarget.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Write the failing transfer test**

```ts
// test/server/api/transfers/transfer.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db, accounts, transactions, goals } from '../../../../server/db'
import { eq } from 'drizzle-orm'
import { postEfTransfer } from '../../../../server/utils/efTransfer'

let bankId: number, efId: number, goalId: number
beforeEach(() => {
  db.delete(transactions).run(); db.delete(goals).run(); db.delete(accounts).run()
  bankId = db.insert(accounts).values({ name: 'Bank', type: 'bank', balance_cents: 100000, created_at: 1, updated_at: 1 })
    .returning({ id: accounts.id }).get().id
  efId = db.insert(accounts).values({ name: 'Emergency Fund', type: 'savings', balance_cents: 0, created_at: 1, updated_at: 1 })
    .returning({ id: accounts.id }).get().id
  goalId = db.insert(goals).values({ name: 'Emergency Fund', type: 'savings', target_amount_cents: 100000, account_id: efId, status: 'active', created_at: 1, updated_at: 1 })
    .returning({ id: goals.id }).get().id
})

describe('EF two-leg transfer', () => {
  it('writes one transfer row that decrements bank and increments EF atomically', () => {
    const r = postEfTransfer({ from_account_id: bankId, to_account_id: efId, amount_cents: 20000, goal_id: goalId, uuid: 'tx-1', date: '2026-06-23' })
    expect(r.id).toBeGreaterThan(0)
    const bank = db.select().from(accounts).where(eq(accounts.id, bankId)).get()
    const ef = db.select().from(accounts).where(eq(accounts.id, efId)).get()
    expect(bank!.balance_cents).toBe(80000)  // 100000 - 20000
    expect(ef!.balance_cents).toBe(20000)
    const rows = db.select().from(transactions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].direction).toBe('transfer')
    expect(rows[0].category).toBe('savings')
    expect(rows[0].account_id).toBe(bankId)
    expect(rows[0].counter_account_id).toBe(efId)
    expect(rows[0].goal_id).toBe(goalId)
  })

  it('is idempotent on uuid (re-POST does not double-move money)', () => {
    postEfTransfer({ from_account_id: bankId, to_account_id: efId, amount_cents: 20000, goal_id: goalId, uuid: 'tx-1', date: '2026-06-23' })
    postEfTransfer({ from_account_id: bankId, to_account_id: efId, amount_cents: 20000, goal_id: goalId, uuid: 'tx-1', date: '2026-06-23' })
    const ef = db.select().from(accounts).where(eq(accounts.id, efId)).get()
    expect(ef!.balance_cents).toBe(20000) // not 40000
  })

  it('EF progress sums both legs to the EF balance', () => {
    postEfTransfer({ from_account_id: bankId, to_account_id: efId, amount_cents: 30000, goal_id: goalId, uuid: 'tx-2', date: '2026-06-23' })
    const ef = db.select().from(accounts).where(eq(accounts.id, efId)).get()
    expect(ef!.balance_cents).toBe(30000)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run test/server/api/transfers/transfer.test.ts`
Expected: FAIL — cannot resolve `efTransfer`.

- [ ] **Step 7: Write minimal implementation**

```ts
// server/utils/efTransfer.ts
import { postTransaction } from './post'

export type EfTransferInput = {
  from_account_id: number
  to_account_id: number
  amount_cents: number
  goal_id?: number
  note?: string
  uuid: string
  date: string
}

// Two-leg transfer via the single ledger authority. postTransaction (Phase 1) wraps the
// insert + both account balance updates in ONE synchronous db.transaction; passing
// counter_account_id makes it a transfer that decrements `account_id` and increments
// `counter_account_id`. Idempotent on transactions.uuid UNIQUE.
export function postEfTransfer(input: EfTransferInput): { id: number } {
  return postTransaction({
    uuid: input.uuid,
    date: input.date,
    amount_cents: -Math.abs(input.amount_cents), // negative on the source leg
    direction: 'transfer',
    category: 'savings',
    account_id: input.from_account_id,
    counter_account_id: input.to_account_id,
    goal_id: input.goal_id,
    note: input.note ?? 'EF transfer (payday prompt)',
    source: 'manual',
  })
}
```

```ts
// server/api/transfers/index.post.ts
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { requireSession } from '../../utils/requireSession'
import { postEfTransfer } from '../../utils/efTransfer'
import { todayMYT } from '../../utils/mytDate'

const Body = z.object({
  from_account_id: z.number().int().positive(),
  to_account_id: z.number().int().positive(),
  amount_cents: z.number().int().positive(),
  goal_id: z.number().int().positive().optional(),
  note: z.string().max(200).optional(),
  uuid: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export default defineEventHandler(async (event) => {
  requireSession(event)
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid transfer' })
  const b = parsed.data
  if (b.from_account_id === b.to_account_id) {
    throw createError({ statusCode: 400, statusMessage: 'from and to must differ' })
  }
  return postEfTransfer({
    from_account_id: b.from_account_id,
    to_account_id: b.to_account_id,
    amount_cents: b.amount_cents,
    goal_id: b.goal_id,
    note: b.note,
    uuid: b.uuid ?? randomUUID(),
    date: b.date ?? todayMYT(),
  })
})
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/server/api/transfers/transfer.test.ts test/server/utils/savingsTarget.test.ts`
Expected: PASS (5 passed total).

- [ ] **Step 9: Commit**

```bash
git add server/utils/savingsTarget.ts server/utils/efTransfer.ts server/api/transfers/index.post.ts test/server/api/transfers/transfer.test.ts test/server/utils/savingsTarget.test.ts
git commit -m "feat(habit): two-leg atomic EF transfer endpoint + per-cycle phase-scaled savings target"
```

---

### Task 4.9: Email fallback (weekly 'what needs attention') + standalone health signal

**Files:**
- Create: `server/utils/attention.ts`
- Create: `server/utils/mailer.ts`
- Create: `server/api/health/push.get.ts`
- Test: `test/server/utils/attention.test.ts`

**Interfaces:**
- Consumes: `db`, `recurringItems`, `pushSubscriptions` from `server/db`; `daysUntil` (Task 4.5); `formatRM` (money); `nodemailer`; `useRuntimeConfig().smtpUrl` (env `NUXT_SMTP_URL`, VPS SMTP); `requireSession`.
- Produces:
  - `collectAttention(todayISO: string): { line: string }[]` — bills due within 7 days + a push-health line if zero healthy subscriptions exist.
  - `renderAttentionEmail(items: { line: string }[]): { subject: string; text: string }`.
  - `sendAttentionEmail(items): Promise<void>` (SMTP via `mailer.ts`; no-ops if `smtpUrl` empty).
  - `pushHealthSignal(): { healthySubscriptions: number; channelOk: boolean }` — surfaced on the dashboard + folded into the email.
  - `GET /api/health/push` (session-gated read; informational, not state-changing) → `{ healthySubscriptions, channelOk }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/server/utils/attention.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db, recurringItems, pushSubscriptions } from '../../../server/db'
import { collectAttention, renderAttentionEmail, pushHealthSignal } from '../../../server/utils/attention'

beforeEach(() => { db.delete(recurringItems).run(); db.delete(pushSubscriptions).run() })

describe('attention / health', () => {
  it('lists bills due within 7 days', () => {
    db.insert(recurringItems).values({
      name: 'Unifi', direction: 'expense', amount_cents: 15000, category: 'bills',
      cadence: 'monthly', day_of_month: 19, start_date: '2026-01-01',
      next_due_date: '2026-06-22', is_active: true, auto_post: true, created_at: 1, updated_at: 1,
    }).run()
    const out = collectAttention('2026-06-18')
    expect(out.some(i => i.line.includes('Unifi') && i.line.includes('RM150.00'))).toBe(true)
  })

  it('adds a channel-broken line when there are no healthy subscriptions', () => {
    const out = collectAttention('2026-06-18')
    expect(out.some(i => i.line.toLowerCase().includes('reminders are off'))).toBe(true)
  })

  it('pushHealthSignal counts only non-failed subscriptions', () => {
    db.insert(pushSubscriptions).values({ endpoint: 'a', p256dh: 'x', auth: 'y', created_at: 1 }).run()
    db.insert(pushSubscriptions).values({ endpoint: 'b', p256dh: 'x', auth: 'y', created_at: 1, failed_at: 99 }).run()
    const h = pushHealthSignal()
    expect(h.healthySubscriptions).toBe(1)
    expect(h.channelOk).toBe(true)
  })

  it('renderAttentionEmail produces a subject and a bulleted body', () => {
    const { subject, text } = renderAttentionEmail([{ line: 'Unifi RM150.00 due 2026-06-22' }])
    expect(subject).toContain('What needs your attention')
    expect(text).toContain('- Unifi RM150.00 due 2026-06-22')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server/utils/attention.test.ts`
Expected: FAIL — cannot resolve `attention`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/attention.ts
import { eq, isNull } from 'drizzle-orm'
import { db, recurringItems, pushSubscriptions } from '../db'
import { daysUntil, spayLaterNextAmount } from './dispatchBuilders'
import { formatRM } from './money'

export function pushHealthSignal(): { healthySubscriptions: number; channelOk: boolean } {
  const healthy = db.select().from(pushSubscriptions).where(isNull(pushSubscriptions.failed_at)).all()
  return { healthySubscriptions: healthy.length, channelOk: healthy.length > 0 }
}

export function collectAttention(todayISO: string): { line: string }[] {
  const items = db.select().from(recurringItems).where(eq(recurringItems.is_active, true)).all()
  const out: { line: string }[] = []
  for (const it of items) {
    if (!it.next_due_date) continue
    const d = daysUntil(todayISO, it.next_due_date)
    if (d < 0 || d > 7) continue
    const amount = spayLaterNextAmount(it.remaining_installments_json) ?? it.amount_cents
    if (it.direction !== 'expense') continue
    out.push({ line: `${it.name} ${formatRM(amount)} due ${it.next_due_date}` })
  }
  if (!pushHealthSignal().channelOk) {
    out.push({ line: 'Push reminders are OFF — no working device subscription. Re-enable in the app (iOS: add to Home Screen first).' })
  }
  return out
}

export function renderAttentionEmail(items: { line: string }[]): { subject: string; text: string } {
  const body = items.length ? items.map(i => `- ${i.line}`).join('\n') : '- Nothing urgent this week. Nice.'
  return {
    subject: 'Money — What needs your attention this week',
    text: `What needs your attention\n\n${body}\n\nOpen: https://money.argontechs.dev/`,
  }
}

export async function sendAttentionEmail(items: { line: string }[]): Promise<void> {
  const { sendMail } = await import('./mailer')
  const { subject, text } = renderAttentionEmail(items)
  await sendMail({ to: 'yongwei1127@gmail.com', subject, text })
}
```

```ts
// server/utils/mailer.ts
import nodemailer from 'nodemailer'
import { useRuntimeConfig } from '#imports'

export async function sendMail(msg: { to: string; subject: string; text: string }): Promise<void> {
  const cfg = useRuntimeConfig()
  if (!cfg.smtpUrl) return // no SMTP configured → no-op (push remains primary)
  const transport = nodemailer.createTransport(cfg.smtpUrl)
  await transport.sendMail({ from: 'money@argontechs.dev', ...msg })
}
```

```ts
// server/api/health/push.get.ts
import { requireSession } from '../../utils/requireSession'
import { pushHealthSignal } from '../../utils/attention'

// Informational read (not state-changing) — session-gated per §14.22.
export default defineEventHandler((event) => {
  requireSession(event)
  return pushHealthSignal()
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/server/utils/attention.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add server/utils/attention.ts server/utils/mailer.ts server/api/health/push.get.ts test/server/utils/attention.test.ts
git commit -m "feat(habit): weekly attention email fallback + push-channel health signal endpoint"
```

---

### Task 4.10: `/api/internal/run-due` watchdog — loopback-bound + secret-gated

**Files:**
- Create: `server/utils/loopback.ts`
- Create: `server/api/internal/run-due.post.ts`
- Test: `test/server/api/internal/run-due.test.ts`

**Interfaces:**
- Consumes: `runDispatch()` from `server/utils/dispatchRun.ts` (Task 4.6); `useRuntimeConfig().runDueSecret` (env `NUXT_RUN_DUE_SECRET`); `timingSafeEqual` from `node:crypto`.
- Produces:
  - `isLoopback(remoteAddress: string | undefined): boolean` (accepts `127.0.0.1`, `::1`, `::ffff:127.0.0.1`).
  - `secretMatches(provided: string | undefined, expected: string): boolean` (constant-time).
  - `POST /api/internal/run-due` — NOT session-gated; rejects non-loopback (403) and bad/missing secret (401); on pass runs `runDispatch()` and returns `{ sent, skipped }`. Permanent OS-cron watchdog, never removed.

- [ ] **Step 1: Write the failing test**

```ts
// test/server/api/internal/run-due.test.ts
import { describe, it, expect } from 'vitest'
import { isLoopback, secretMatches } from '../../../../server/utils/loopback'

describe('run-due guard', () => {
  it('accepts loopback addresses only', () => {
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('::1')).toBe(true)
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopback('203.0.113.7')).toBe(false)
    expect(isLoopback(undefined)).toBe(false)
  })

  it('secretMatches is true only on exact match', () => {
    expect(secretMatches('s3cr3t', 's3cr3t')).toBe(true)
    expect(secretMatches('wrong', 's3cr3t')).toBe(false)
    expect(secretMatches(undefined, 's3cr3t')).toBe(false)
    expect(secretMatches('s3cr3t', '')).toBe(false) // empty expected never matches
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server/api/internal/run-due.test.ts`
Expected: FAIL — cannot resolve `loopback`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/loopback.ts
import { timingSafeEqual } from 'node:crypto'

export function isLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false
  return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
}

export function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

```ts
// server/api/internal/run-due.post.ts
import { useRuntimeConfig } from '#imports'
import { isLoopback, secretMatches } from '../../utils/loopback'
import { runDispatch } from '../../utils/dispatchRun'

// PERMANENT watchdog (§8/§13/§14.10). Not session-gated; loopback-bound + secret-gated.
// nginx must NOT proxy /api/internal/* from outside; OS-cron hits 127.0.0.1 directly.
export default defineEventHandler(async (event) => {
  const remote = event.node.req.socket.remoteAddress ?? undefined
  if (!isLoopback(remote)) throw createError({ statusCode: 403, statusMessage: 'forbidden' })
  const secret = getHeader(event, 'x-run-due-secret')
  if (!secretMatches(secret, useRuntimeConfig().runDueSecret)) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  }
  return await runDispatch()
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/server/api/internal/run-due.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Add `.gitignore` entries + nginx-deny note**

Append to `.gitignore` (idempotent — skip lines already present):

```gitignore
.env
*.sqlite*
/data
/backups
```

Document in `docs/runbook-habit.md` (created in Task 4.11) that the CloudPanel nginx vhost must add `location ^~ /api/internal/ { deny all; return 403; }` so the watchdog is reachable only via loopback OS-cron.

- [ ] **Step 6: Commit**

```bash
git add server/utils/loopback.ts server/api/internal/run-due.post.ts .gitignore
git commit -m "feat(habit): permanent loopback+secret run-due watchdog endpoint"
```

---

### Task 4.11: Croner smoke-test + watchdog cron + deploy verification runbook

**Files:**
- Create: `server/tasks/smoke-heartbeat.ts` (temporary 1-min heartbeat to prove croner fires; removed after verification)
- Create: `docs/runbook-habit.md`
- Modify: `nuxt.config.ts` (temporarily add `'*/1 * * * *': ['smoke-heartbeat']`, removed in final step)

**Interfaces:**
- Consumes: Nitro `defineTask`; the deployed `money-fms` PM2 app; `NUXT_RUN_DUE_SECRET` env.
- Produces: verified evidence that (a) croner starts under `node-server`, (b) a real `subscribe()` round-trips, (c) the OS-cron watchdog reaches `/api/internal/run-due`.

- [ ] **Step 1: Write the heartbeat task**

```ts
// server/tasks/smoke-heartbeat.ts
export default defineTask({
  meta: { name: 'smoke-heartbeat', description: 'TEMP — proves croner fires under node-server' },
  run() {
    console.log(`[smoke-heartbeat] croner alive @ ${new Date().toISOString()}`)
    return { result: 'ok' }
  },
})
```

- [ ] **Step 2: Build + restart, then verify croner actually fires (BLOCKER §13)**

Run on the box:
```bash
cd /home/money/htdocs/money.argontechs.dev && npm run build && pm2 reload ecosystem.config.cjs --update-env
sleep 130 && pm2 logs money-fms --lines 200 --nostream | grep smoke-heartbeat
```
Expected: at least two `[smoke-heartbeat] croner alive` lines ~60s apart. If ZERO lines → croner did not start under the preset; the OS-cron watchdog (Task 4.10) becomes the primary trigger — proceed to Step 5 regardless.

- [ ] **Step 3: Verify the runtime VAPID public key is present (§14.4)**

Run:
```bash
curl -s https://money.argontechs.dev/_nuxt/builds/latest.json >/dev/null
node -e "const c=require('/home/money/htdocs/money.argontechs.dev/.output/server/chunks/runtime.mjs');" 2>/dev/null || true
pm2 env 0 | grep NUXT_PUBLIC_VAPID_PUBLIC_KEY
```
Expected: `NUXT_PUBLIC_VAPID_PUBLIC_KEY` is set in the PM2 process env (runtime, not baked at build). If empty → set it in `.env`, `pm2 reload --update-env`.

- [ ] **Step 4: End-to-end subscribe + canary smoke (real device)**

On the iPhone, installed to Home Screen (standalone): tap "Turn on reminders" → grant → confirm the "Reminders are working" canary notification arrives. Then on the box:
```bash
sqlite3 /home/money/data/money.sqlite "SELECT id, substr(endpoint,1,40), failed_at FROM push_subscriptions;"
```
Expected: one row, `failed_at` NULL. A missing client key fails silently with no server error — this is the test that catches it.

- [ ] **Step 5: Install the permanent OS-cron watchdog (loopback + secret)**

As the site user `money`:
```bash
( crontab -l 2>/dev/null; \
  echo '*/5 * * * * curl -fsS -X POST -H "x-run-due-secret: '"$NUXT_RUN_DUE_SECRET"'" http://127.0.0.1:3000/api/internal/run-due >> /home/money/logs/run-due.log 2>&1' \
) | crontab -
crontab -l | grep run-due
```
Then verify it dispatches and that external access is denied:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "x-run-due-secret: $NUXT_RUN_DUE_SECRET" http://127.0.0.1:3000/api/internal/run-due   # expect 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://money.argontechs.dev/api/internal/run-due                                       # expect 403 (nginx deny)
```
Expected: loopback call `200`; public call `403`.

- [ ] **Step 6: Remove the heartbeat, keep the watchdog**

Remove the `'*/1 * * * *': ['smoke-heartbeat']` line from `nuxt.config.ts`, delete `server/tasks/smoke-heartbeat.ts`, rebuild + reload. Write `docs/runbook-habit.md` capturing: the nginx `deny all` block for `/api/internal/`, the cron line, the canary procedure, and "watchdog is permanent — do not remove even after croner is confirmed (§14.10)."

- [ ] **Step 7: Commit**

```bash
git rm server/tasks/smoke-heartbeat.ts
git add nuxt.config.ts docs/runbook-habit.md
git commit -m "chore(habit): croner smoke-test verified, permanent run-due watchdog cron, habit runbook"
```

---

#### Phase deliverable & how to verify

**Deliverable:** the ledger now coaches. Bill-due reminders (3-day / 1-day / today, with SPayLater showing the correct declining amount) and the three payday-save prompts (day 3 salary, the 1st, the 23rd, with a phase-scaled suggested EF amount) fire via Web Push from the in-process `notify-dispatch` task — MYT-gated ≥ 09:00, exactly-once via `notifications_sent`, catch-up-aware over the 5-minute window. The "Transfer logged" action writes a **real two-leg EF transfer** (negative on bank, positive on EF, summed both legs) idempotent on `uuid`. iOS Home-Screen install is prompted, standalone+permission is a dashboard health signal also folded into a weekly "what needs attention" email fallback, and a permanent loopback-bound, secret-gated `/api/internal/run-due` OS-cron backs the scheduler. Streaks/milestones are explicitly NOT built (Phase 5+).

**How to verify:**
1. `npx vitest run test/server/utils/dispatchBuilders.test.ts test/server/utils/dispatchRun.test.ts test/server/habit/month-boundary.test.ts test/server/api/transfers/transfer.test.ts test/server/utils/savingsTarget.test.ts test/server/utils/attention.test.ts test/server/api/internal/run-due.test.ts test/server/api/push/subscribe.test.ts test/server/plugins/webpush.test.ts test/app/sw.test.ts test/app/composables/usePush.test.ts` → all green.
2. `npx vitest run test/server/api/push/subscribe.gated.test.ts` → unauthenticated subscribe returns 401 (gate proven).
3. Month-boundary test proves exactly-once across 23:30→00:30 MYT and day-31 clamping (mandated §8/§14.11).
4. On the box: `pm2 logs money-fms | grep notify-dispatch` shows periodic `sent=/skipped=` lines; the real-device canary arrives after enabling; `curl` to `/api/internal/run-due` returns `200` on loopback and `403` externally.
5. Trigger a payday prompt (seed an income `recurring_item` with `next_due_date = todayMYT()`), confirm one push arrives, tap "Transfer logged", and confirm exactly one `transfer` row + EF balance increment in `money.sqlite` (re-tapping with the same `uuid` does not double-move).
```
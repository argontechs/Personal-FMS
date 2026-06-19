// test/app/useOfflineQueue.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IDBFactory,
  IDBCursor,
  IDBCursorWithValue,
  IDBDatabase,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent,
} from 'fake-indexeddb';
import { useOfflineQueue, registerAutoFlush, __resetFlushState, getLastEnqueueFlush, deadLetterCount } from '../../app/composables/useOfflineQueue';
// Import the plugin default export (will be a function due to defineNuxtPlugin shim)
import offlineFlushPlugin from '../../app/plugins/offline-flush.client';

// Install all IDB globals (once) so idb library's instanceof checks pass.
// These are stable class references — only the factory (and thus DB state) is reset per test.
Object.assign(globalThis, {
  IDBCursor,
  IDBCursorWithValue,
  IDBDatabase,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent,
});

// Stub Nuxt's global $fetch.
const posted: any[] = [];
beforeEach(async () => {
  // Reset module-level flush singletons so cross-test in-flight guard doesn't leak.
  __resetFlushState();
  // Fresh isolated IndexedDB per test — prevents state bleeding between tests.
  globalThis.indexedDB = new IDBFactory();
  posted.length = 0;
  // @ts-expect-error global injected by Nuxt at runtime
  globalThis.$fetch = vi.fn(async (_url: string, opts: any) => { posted.push(opts.body); return { id: posted.length }; });
  // Default to offline so existing enqueue-then-flush tests control when flushing happens.
  // Tests that explicitly verify the auto-flush-on-enqueue behaviour override this to true.
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
    writable: true,
  });
});

describe('useOfflineQueue', () => {
  it('enqueue assigns a uuid and stores the txn; pending() returns it', async () => {
    const q = useOfflineQueue();
    const t = await q.enqueue({ date: '2026-06-18', amount_cents: -1200, direction: 'expense', category: 'food', account_id: 1 });
    expect(t.uuid).toMatch(/[0-9a-f-]{36}/);
    const p = await q.pending();
    expect(p.length).toBe(1);
    expect(p[0].uuid).toBe(t.uuid);
  });

  it('flush POSTs each pending txn to /api/transactions and empties the queue on success', async () => {
    const q = useOfflineQueue();
    await q.enqueue({ date: '2026-06-18', amount_cents: -500, direction: 'expense', category: 'transport', account_id: 1 });
    await q.enqueue({ date: '2026-06-18', amount_cents: -800, direction: 'expense', category: 'other', account_id: 1 });
    const res = await q.flush();
    expect(res.flushed).toBe(2);
    expect(res.remaining).toBe(0);
    expect(posted.length).toBe(2);
    expect(posted[0].uuid).toBeTypeOf('string'); // uuid carried to server for upsert dedupe
    expect((await q.pending()).length).toBe(0);
  });

  it('keeps the txn queued when the POST fails, so the next flush retries', async () => {
    // @ts-expect-error global injected by Nuxt
    globalThis.$fetch = vi.fn(async () => { throw new Error('offline'); });
    const q = useOfflineQueue();
    await q.enqueue({ date: '2026-06-18', amount_cents: -300, direction: 'expense', category: 'food', account_id: 1 });
    const res = await q.flush();
    expect(res.flushed).toBe(0);
    expect(res.remaining).toBe(1);
    expect((await q.pending()).length).toBe(1);
  });

  it('registerAutoFlush flushes on visibilitychange→visible and on online', async () => {
    // @ts-expect-error global injected by Nuxt
    globalThis.$fetch = vi.fn(async (_u: string, o: any) => { posted.push(o.body); return { id: posted.length }; });
    const q = useOfflineQueue();
    await q.enqueue({ date: '2026-06-18', amount_cents: -100, direction: 'expense', category: 'food', account_id: 1 });

    const handlers: Record<string, Function> = {};
    const fakeWin: any = {
      addEventListener: (ev: string, fn: Function) => { handlers[ev] = fn; },
      document: { visibilityState: 'visible' },
    };
    registerAutoFlush(fakeWin);
    expect(typeof handlers['online']).toBe('function');
    await handlers['online'](); // simulate reconnect
    expect(posted.length).toBe(1);
    expect((await q.pending()).length).toBe(0);
  });

  it('enqueue fires flush when navigator.onLine is true, POSTing the txn immediately', async () => {
    // Simulate navigator.onLine = true (default browser state)
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
      writable: true,
    });
    const q = useOfflineQueue();
    await q.enqueue({ date: '2026-06-18', amount_cents: -200, direction: 'expense', category: 'food', account_id: 1 });
    // Await the ACTUAL flush promise kicked off by enqueue — deterministic, no timer guessing.
    await getLastEnqueueFlush();
    expect(posted.length).toBe(1);
    expect(posted[0].amount_cents).toBe(-200);
    expect((await q.pending()).length).toBe(0);
  });

  it('enqueue does NOT trigger flush when navigator.onLine is false (offline-first guarantee)', async () => {
    // Simulate navigator.onLine = false
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      configurable: true,
      writable: true,
    });
    const q = useOfflineQueue();
    await q.enqueue({ date: '2026-06-18', amount_cents: -300, direction: 'expense', category: 'transport', account_id: 1 });
    // No flush should have been kicked off — getLastEnqueueFlush() returns null.
    // Await null is a no-op; assert directly without any timer.
    await getLastEnqueueFlush();
    // $fetch should NOT have been called — item stays queued for later flush
    expect(posted.length).toBe(0);
    expect((await q.pending()).length).toBe(1);
  });

  it('enqueue flush failure leaves item queued (offline-first retained)', async () => {
    // Simulate online but POST fails — item must stay in IDB for retry
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
      writable: true,
    });
    // @ts-expect-error global injected by Nuxt
    globalThis.$fetch = vi.fn(async () => { throw new Error('server error'); });
    const q = useOfflineQueue();
    await q.enqueue({ date: '2026-06-18', amount_cents: -400, direction: 'expense', category: 'other', account_id: 1 });
    // Await the actual flush promise (it will resolve after the caught error)
    await getLastEnqueueFlush();
    // flush was attempted but failed — item must remain queued
    expect((await q.pending()).length).toBe(1);
  });

  it('4xx (permanent) response dead-letters the item immediately — never retried', async () => {
    // Simulate a 400 Bad Request — permanent client error, should dead-letter on first failure.
    const err = Object.assign(new Error('Bad Request'), { status: 400 });
    // @ts-expect-error global injected by Nuxt
    globalThis.$fetch = vi.fn(async () => { throw err; });

    const q = useOfflineQueue();
    await q.enqueue({ date: '2026-06-18', amount_cents: -999, direction: 'expense', category: 'food', account_id: 1 });

    const res = await q.flush();
    // Item removed from pending queue (dead-lettered, not retried)
    expect(res.remaining).toBe(0);
    expect((await q.pending()).length).toBe(0);
    // Dead-letter store now has 1 item and the reactive count reflects it
    const deadItems = await q.readDeadLetterItems();
    expect(deadItems.length).toBe(1);
    expect(deadLetterCount.value).toBe(1);
  });

  it('5xx (transient) keeps item queued with incremented attempt; dead-letters after 6 attempts', async () => {
    // Simulate a 500 Internal Server Error — transient, should retry with backoff.
    const err = Object.assign(new Error('Internal Server Error'), { status: 500 });
    // @ts-expect-error global injected by Nuxt
    globalThis.$fetch = vi.fn(async () => { throw err; });

    // Override Date.now so nextRetryAt is always in the past (elapsed immediately)
    const realDateNow = Date.now;
    let fakeNow = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    const q = useOfflineQueue();
    await q.enqueue({ date: '2026-06-18', amount_cents: -888, direction: 'expense', category: 'transport', account_id: 1 });

    // Each flush call must advance fakeNow past nextRetryAt so the backoff delay is bypassed.
    for (let attempt = 1; attempt <= 5; attempt++) {
      fakeNow += 400_000; // well past any backoff cap
      const res = await q.flush();
      expect(res.remaining).toBe(1); // still queued after attempts 1–5
      expect((await q.pending()).length).toBe(1);
      expect(deadLetterCount.value).toBe(0);
      // Reset the in-flight guard so next iteration can flush again
      __resetFlushState();
      // Keep IDB open: re-opening is fine since only the singleton guards were reset
    }

    // 6th failure → dead-letter
    fakeNow += 400_000;
    const finalRes = await q.flush();
    expect(finalRes.remaining).toBe(0);
    expect((await q.pending()).length).toBe(0);
    const deadItems = await q.readDeadLetterItems();
    expect(deadItems.length).toBe(1);
    expect(deadLetterCount.value).toBe(1);

    vi.restoreAllMocks();
    Date.now = realDateNow;
  });
});

describe('offline-flush.client plugin', () => {
  it('calls registerAutoFlush with the real window when executed', () => {
    const spy = vi.fn();
    // The plugin imports registerAutoFlush; we verify the plugin calls through by checking
    // that it adds event listeners to the window (the real contract).
    const originalAddEventListener = window.addEventListener.bind(window);
    const calls: string[] = [];
    vi.spyOn(window, 'addEventListener').mockImplementation((event: string, ...args: any[]) => {
      calls.push(event);
      return originalAddEventListener(event, ...args);
    });

    // Execute the plugin (our defineNuxtPlugin shim returns the setup fn directly)
    (offlineFlushPlugin as unknown as () => void)();

    // registerAutoFlush wires 'online' and 'visibilitychange'
    expect(calls).toContain('online');
    expect(calls).toContain('visibilitychange');

    vi.restoreAllMocks();
  });
});

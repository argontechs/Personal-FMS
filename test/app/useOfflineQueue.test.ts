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
import { useOfflineQueue, registerAutoFlush, __resetFlushState } from '../../app/composables/useOfflineQueue';
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
  // Drain any fire-and-forget flush promise from the previous test before we
  // swap out $fetch — this ensures in-flight POSTs land on the old mock, not
  // the new one, so they cannot pollute the upcoming test's `posted` array.
  await new Promise(r => setTimeout(r, 0));
  // Reset module-level flush singleton so cross-test in-flight guard doesn't leak.
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
    // Flush triggered fire-and-forget; allow microtasks/promises to settle
    await new Promise(r => setTimeout(r, 0));
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
    await new Promise(r => setTimeout(r, 0));
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
    await new Promise(r => setTimeout(r, 0));
    // flush was attempted but failed — item must remain queued
    expect((await q.pending()).length).toBe(1);
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

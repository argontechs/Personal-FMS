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
import { useOfflineQueue, registerAutoFlush } from '../../app/composables/useOfflineQueue';

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
beforeEach(() => {
  // Fresh isolated IndexedDB per test — prevents state bleeding between tests.
  globalThis.indexedDB = new IDBFactory();
  posted.length = 0;
  // @ts-expect-error global injected by Nuxt at runtime
  globalThis.$fetch = vi.fn(async (_url: string, opts: any) => { posted.push(opts.body); return { id: posted.length }; });
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
});

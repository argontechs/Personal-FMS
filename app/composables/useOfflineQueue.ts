// app/composables/useOfflineQueue.ts
import { openDB, type IDBPDatabase } from 'idb';

export interface QueuedTxn {
  uuid: string;
  date: string;
  amount_cents: number;
  direction: 'income' | 'expense';
  category: 'food' | 'transport' | 'other';
  account_id: number;
  note?: string;
}

const DB_NAME = 'money-fms';
const STORE = 'pending_txns';

// Simple in-flight guard: prevents concurrent flush calls from double-posting.
let flushInFlight: Promise<{ flushed: number; remaining: number }> | null = null;

async function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'uuid' }); // uuid is the idempotency key
      }
    },
  });
}

export function useOfflineQueue() {
  async function enqueue(input: Omit<QueuedTxn, 'uuid'> & { uuid?: string }): Promise<QueuedTxn> {
    const txn: QueuedTxn = { ...input, uuid: input.uuid ?? crypto.randomUUID() };
    const db = await getDb();
    await db.put(STORE, txn); // put = upsert; re-enqueue of the same uuid is a no-op write
    return txn;
  }

  async function pending(): Promise<QueuedTxn[]> {
    const db = await getDb();
    return db.getAll(STORE);
  }

  async function flush(): Promise<{ flushed: number; remaining: number }> {
    // If a flush is already in progress, piggyback on it — don't double-POST.
    if (flushInFlight) return flushInFlight;
    flushInFlight = (async () => {
      const db = await getDb();
      const items: QueuedTxn[] = await db.getAll(STORE);
      let flushed = 0;
      for (const item of items) {
        try {
          await (globalThis as any).$fetch('/api/transactions', { method: 'POST', body: { ...item, source: 'manual' } });
          await db.delete(STORE, item.uuid); // only remove after the server acks (idempotent on uuid)
          flushed++;
        } catch {
          // leave it queued; next flush (app open / reconnect) retries. Server upsert dedupes.
        }
      }
      const remaining = (await db.getAll(STORE)).length;
      return { flushed, remaining };
    })().finally(() => { flushInFlight = null; });
    return flushInFlight;
  }

  return { enqueue, pending, flush };
}

// Wire flush-on-open / flush-on-reconnect. Pass a custom window in tests; defaults to globalThis.window.
export function registerAutoFlush(win: any = (globalThis as any).window): void {
  if (!win) return;
  const { flush } = useOfflineQueue();
  // Returns the flush promise so callers (and tests) can await it if needed.
  const tryFlush = () => flush().catch(() => {});
  win.addEventListener('online', tryFlush);
  win.addEventListener('visibilitychange', () => {
    const vis = win.document?.visibilityState ?? (globalThis as any).document?.visibilityState;
    if (vis === 'visible') tryFlush();
  });
  // Progressive enhancement: Background Sync where supported; no-ops on iOS (the confirmed device).
  tryFlush(); // flush-on-open
}

// app/composables/useOfflineQueue.ts
import { ref, type Ref } from 'vue';
import { openDB, type IDBPDatabase } from 'idb';

export interface QueuedTxn {
  uuid: string;
  date: string;
  amount_cents: number;
  direction: 'income' | 'expense';
  category: 'food' | 'transport' | 'fuel' | 'groceries' | 'shopping' | 'bills' | 'other' | 'income';
  account_id: number;
  note?: string;
}

/** Internal shape stored in IDB — extends QueuedTxn with retry metadata. */
interface QueuedTxnInternal extends QueuedTxn {
  attempts: number;       // how many failed flush attempts so far
  nextRetryAt: number;    // epoch-ms: don't flush before this timestamp
}

const DB_NAME = 'money-fms';
const STORE = 'pending_txns';
const DEAD_LETTER_STORE = 'dead_txns';
const MAX_ATTEMPTS = 6;

// Simple in-flight guard: prevents concurrent flush calls from double-posting.
let flushInFlight: Promise<{ flushed: number; remaining: number }> | null = null;

// Tracks the most-recent flush promise kicked off by enqueue's fire-and-forget path.
// Tests can await getLastEnqueueFlush() for deterministic assertions; production
// callers never need this — they fire-and-forget via enqueue() as before.
let lastEnqueueFlush: Promise<{ flushed: number; remaining: number }> | null = null;

/** Reactive count of dead-lettered items. Updated after every flush. */
export const deadLetterCount: Ref<number> = ref(0);

async function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'uuid' }); // uuid is the idempotency key
        }
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(DEAD_LETTER_STORE)) {
          db.createObjectStore(DEAD_LETTER_STORE, { keyPath: 'uuid' });
        }
      }
    },
  });
}

/**
 * Returns true for transient errors that should be retried:
 * network failures (no status), 5xx, 408 (Request Timeout), 429 (Too Many Requests).
 * Returns false for permanent 4xx errors (except 408/429) → dead-letter.
 */
function isTransient(error: unknown): boolean {
  const status = (error as any)?.status ?? (error as any)?.statusCode ?? (error as any)?.response?.status;
  if (status === undefined || status === null) {
    // Network error (no HTTP response) — always transient
    return true;
  }
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  // 4xx (400–407, 410–428, 430–499) = permanent client error
  return false;
}

/**
 * Simple exponential backoff: cap at ~5 minutes (300_000 ms).
 * attempt 1 → 2s, 2 → 4s, 3 → 8s, 4 → 16s, 5 → 32s, 6 → dead-letter
 */
function nextRetryDelay(attempt: number): number {
  return Math.min(2_000 * Math.pow(2, attempt - 1), 300_000);
}

/** Refresh the reactive dead-letter count from IDB. */
async function refreshDeadLetterCount(db: IDBPDatabase): Promise<void> {
  const count = await db.count(DEAD_LETTER_STORE);
  deadLetterCount.value = count;
}

export function useOfflineQueue() {
  async function enqueue(input: Omit<QueuedTxn, 'uuid'> & { uuid?: string }): Promise<QueuedTxn> {
    const txn: QueuedTxnInternal = {
      ...input,
      uuid: input.uuid ?? crypto.randomUUID(),
      attempts: 0,
      nextRetryAt: 0,
    };
    const db = await getDb();
    await db.put(STORE, txn); // put = upsert; re-enqueue of the same uuid is a no-op write
    // Best-effort immediate sync: write to IDB first (offline-first guaranteed above),
    // then attempt flush. If the network is down or the POST fails the item stays queued
    // and will be retried on the next reconnect / app-open via registerAutoFlush.
    if ((globalThis as any).navigator?.onLine !== false) {
      // Store the promise so tests can await it deterministically.
      // Production callers ignore the return value of enqueue — fire-and-forget is preserved.
      lastEnqueueFlush = flush().catch(() => {
        /* leave queued; registerAutoFlush will retry */
        return { flushed: 0, remaining: -1 };
      });
    }
    // Return the public QueuedTxn shape (strip internal retry fields)
    const { attempts: _a, nextRetryAt: _n, ...publicTxn } = txn;
    return publicTxn;
  }

  async function pending(): Promise<QueuedTxn[]> {
    const db = await getDb();
    const rows = (await db.getAll(STORE)) as QueuedTxnInternal[];
    // Strip internal fields before exposing
    return rows.map(({ attempts: _a, nextRetryAt: _n, ...t }) => t);
  }

  async function flush(): Promise<{ flushed: number; remaining: number }> {
    // If a flush is already in progress, piggyback on it — don't double-POST.
    if (flushInFlight) return flushInFlight;
    flushInFlight = (async () => {
      const db = await getDb();
      const items: QueuedTxnInternal[] = await db.getAll(STORE);
      const now = Date.now();
      let flushed = 0;
      for (const item of items) {
        // Backoff: skip items that aren't due for retry yet
        if (item.nextRetryAt > now) continue;

        try {
          await (globalThis as any).$fetch('/api/transactions', {
            method: 'POST',
            body: { ...item, source: 'manual', attempts: undefined, nextRetryAt: undefined },
          });
          await db.delete(STORE, item.uuid); // only remove after server acks (idempotent on uuid)
          flushed++;
        } catch (err: unknown) {
          if (isTransient(err)) {
            // Transient: increment attempts + backoff, or dead-letter after cap
            const newAttempts = (item.attempts ?? 0) + 1;
            if (newAttempts >= MAX_ATTEMPTS) {
              // Exceeded retry cap → move to dead-letter
              await db.put(DEAD_LETTER_STORE, { ...item, attempts: newAttempts, deadLetteredAt: Date.now() });
              await db.delete(STORE, item.uuid);
            } else {
              const updatedItem: QueuedTxnInternal = {
                ...item,
                attempts: newAttempts,
                nextRetryAt: Date.now() + nextRetryDelay(newAttempts),
              };
              await db.put(STORE, updatedItem);
            }
          } else {
            // Permanent 4xx → dead-letter immediately, no more retries
            await db.put(DEAD_LETTER_STORE, { ...item, deadLetteredAt: Date.now() });
            await db.delete(STORE, item.uuid);
          }
        }
      }
      await refreshDeadLetterCount(db);
      const remaining = (await db.getAll(STORE)).length;
      return { flushed, remaining };
    })().finally(() => { flushInFlight = null; });
    return flushInFlight;
  }

  /** Returns all dead-lettered items (items that will never be retried automatically). */
  async function readDeadLetterItems(): Promise<(QueuedTxn & { deadLetteredAt: number })[]> {
    const db = await getDb();
    return db.getAll(DEAD_LETTER_STORE);
  }

  /**
   * Retry: moves all dead-lettered items back to the pending queue (reset attempts + nextRetryAt)
   * then immediately attempts a flush. Updates deadLetterCount when done.
   */
  async function retryDeadLetters(): Promise<void> {
    const db = await getDb();
    const items: (QueuedTxnInternal & { deadLetteredAt?: number })[] = await db.getAll(DEAD_LETTER_STORE);
    if (!items.length) return;
    for (const item of items) {
      const { deadLetteredAt: _d, ...base } = item;
      await db.put(STORE, { ...base, attempts: 0, nextRetryAt: 0 });
      await db.delete(DEAD_LETTER_STORE, item.uuid);
    }
    deadLetterCount.value = 0;
    await flush();
  }

  /**
   * Discard: silently removes all dead-lettered items. Updates deadLetterCount when done.
   */
  async function discardDeadLetters(): Promise<void> {
    const db = await getDb();
    const items: QueuedTxnInternal[] = await db.getAll(DEAD_LETTER_STORE);
    for (const item of items) {
      await db.delete(DEAD_LETTER_STORE, item.uuid);
    }
    deadLetterCount.value = 0;
  }

  return { enqueue, pending, flush, readDeadLetterItems, retryDeadLetters, discardDeadLetters };
}

/** Test-only: resets the module-level singletons between test cases. */
export function __resetFlushState() {
  flushInFlight = null;
  lastEnqueueFlush = null;
  deadLetterCount.value = 0;
}

/**
 * Test-only: returns the flush promise that the last enqueue() kicked off (if any).
 * Await this to deterministically wait for the online-path flush to complete without
 * relying on setTimeout(0) timers that can race under concurrent worker load.
 */
export function getLastEnqueueFlush() { return lastEnqueueFlush; }

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

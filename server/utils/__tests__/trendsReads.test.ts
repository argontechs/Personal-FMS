// server/utils/__tests__/trendsReads.test.ts
// Unit tests for the trends read aggregations against a fresh in-memory DB.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db, sqlite } from '../../db/index';
import { transactions, snapshots } from '../../db/schema';
import { runMigrations } from '../../db/migrate';
import { snapshotSeries, spendByCategory, spendSinceISO } from '../trendsReads';

beforeAll(() => {
  runMigrations(sqlite);
});

const now = Date.now();
let uuidSeq = 0;
function tx(date: string, category: string, amountCents: number, direction: 'expense' | 'income' = 'expense') {
  db.insert(transactions).values({
    uuid: `t-${uuidSeq++}`, date, amount_cents: amountCents, direction: direction as any,
    category: category as any, source: 'manual' as any, created_at: now,
  }).run();
}

describe('spendSinceISO', () => {
  it('returns the first day of the month N-1 months back', () => {
    expect(spendSinceISO('2026-06-19', 4)).toBe('2026-03-01'); // Mar, Apr, May, Jun
    expect(spendSinceISO('2026-06-19', 1)).toBe('2026-06-01'); // current month only
  });
  it('rolls across a year boundary', () => {
    expect(spendSinceISO('2026-02-15', 4)).toBe('2025-11-01'); // Nov 25, Dec 25, Jan 26, Feb 26
  });
});

describe('spendByCategory', () => {
  beforeEach(() => {
    db.delete(transactions).run();
  });

  it('sums |amount| per category, descending, expenses only', () => {
    tx('2026-06-10', 'food', -3000);
    tx('2026-06-12', 'food', -2000);
    tx('2026-06-11', 'transport', -8000);
    const rows = spendByCategory(db, '2026-06-01');
    expect(rows).toEqual([
      { category: 'transport', amountCents: 8000 },
      { category: 'food', amountCents: 5000 },
    ]);
  });

  it('excludes income / savings / interest / adjustment / debt categories', () => {
    tx('2026-06-10', 'food', -3000);
    tx('2026-06-10', 'income', 500000, 'income');
    tx('2026-06-10', 'interest', -11101);
    tx('2026-06-10', 'debt', -50000);
    tx('2026-06-10', 'savings', -16667);
    const rows = spendByCategory(db, '2026-06-01');
    expect(rows).toEqual([{ category: 'food', amountCents: 3000 }]);
  });

  it('excludes rows before the window start', () => {
    tx('2026-05-31', 'food', -9999);
    tx('2026-06-01', 'food', -1000);
    const rows = spendByCategory(db, '2026-06-01');
    expect(rows).toEqual([{ category: 'food', amountCents: 1000 }]);
  });
});

describe('snapshotSeries', () => {
  beforeEach(() => {
    db.delete(snapshots).run();
    for (const d of ['2026-06-17', '2026-06-18', '2026-06-19']) {
      db.insert(snapshots).values({
        date: d, net_worth_cents: 100, total_debt_cents: 200, card_balance_cents: 300,
        ef_balance_cents: 400, liquid_cents: 500, created_at: now,
      }).run();
    }
  });

  it('returns the full series ascending by date when no window given', () => {
    const rows = snapshotSeries(db);
    expect(rows.map((r) => r.date)).toEqual(['2026-06-17', '2026-06-18', '2026-06-19']);
    expect(rows[0].netWorthCents).toBe(100);
  });

  it('windows rows on/after sinceISO inclusive', () => {
    const rows = snapshotSeries(db, '2026-06-18');
    expect(rows.map((r) => r.date)).toEqual(['2026-06-18', '2026-06-19']);
  });
});

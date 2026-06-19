// test/server/tasks/daily-snapshot.test.ts
// Integration test for the daily-snapshot logic against a fresh in-memory DB.
// Proves:
//   (a) runDailySnapshot writes exactly ONE row per date and is idempotent (re-run overwrites).
//   (b) net_worth = liquid + holdings − debts, with the canonical card/EF/liquid reads.
//   (c) first run on an empty table still writes today's snapshot.
//   (d) the task file exports a valid defineTask with the flat meta.name 'daily-snapshot'.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db, sqlite } from '../../../server/db/index';
import { accounts, debts, holdings, snapshots } from '../../../server/db/schema';
import { runMigrations } from '../../../server/db/migrate';
import { runDailySnapshot } from '../../../server/utils/dailySnapshot';
import { computeSnapshotMetrics } from '../../../server/utils/snapshotReads';
import { eq } from 'drizzle-orm';

// Nitro's defineTask is an identity wrapper outside the runtime.
(globalThis as any).defineTask = <T>(def: T): T => def;

beforeAll(() => {
  runMigrations(sqlite);
});

const now = Date.now();

function seedFixture() {
  // Liquid asset accounts: bank 200000 + cash 50000 + ewallet 10000 + savings(EF) 45000 = 305000
  db.insert(accounts).values({ name: 'Bank', type: 'bank' as any, balance_cents: 200000, created_at: now, updated_at: now }).run();
  db.insert(accounts).values({ name: 'Cash', type: 'cash' as any, balance_cents: 50000, created_at: now, updated_at: now }).run();
  db.insert(accounts).values({ name: 'TNG', type: 'ewallet' as any, balance_cents: 10000, created_at: now, updated_at: now }).run();
  db.insert(accounts).values({ name: 'EF', type: 'savings' as any, balance_cents: 45000, created_at: now, updated_at: now }).run();
  // Card account is NOT counted as a liquid asset (negative balance, type='card').
  db.insert(accounts).values({ name: 'Card', type: 'card' as any, balance_cents: -740076, created_at: now, updated_at: now }).run();

  // Debts: revolving card 740076 + an installment 124201 = total 864277
  db.insert(debts).values({
    name: 'Card', type: 'revolving' as any, balance_cents: 740076, rate_type: 'apr' as any,
    apr_bps: 1800, payoff_baseline_cents: 740076, created_at: now, updated_at: now,
  }).run();
  db.insert(debts).values({
    name: 'SLoan1', type: 'installment' as any, balance_cents: 124201, rate_type: 'flat' as any,
    created_at: now, updated_at: now,
  }).run();

  // Holdings: 100000 + 6352297 = 6452297
  db.insert(holdings).values({ name: 'ASN', institution: 'ASNB', kind: 'savings' as any, current_value_cents: 100000, liquid: true as any, created_at: now, updated_at: now }).run();
  db.insert(holdings).values({ name: 'AIA', institution: 'AIA', kind: 'investment' as any, current_value_cents: 6352297, liquid: true as any, created_at: now, updated_at: now }).run();
}

// Expected canonical figures from the fixture:
//   liquid    = 305000
//   holdings  = 6452297
//   debts     = 864277
//   net worth = 305000 + 6452297 − 864277 = 5893020
//   card      = 740076
//   EF        = 45000
const EXPECT = {
  liquid: 305000,
  holdings: 6452297,
  totalDebt: 864277,
  netWorth: 5893020,
  card: 740076,
  ef: 45000,
};

describe('daily-snapshot — metrics + upsert', () => {
  beforeEach(() => {
    db.delete(snapshots).run();
    db.delete(holdings).run();
    db.delete(debts).run();
    db.delete(accounts).run();
    seedFixture();
  });

  it('computeSnapshotMetrics: net worth = liquid + holdings − debts', () => {
    const m = computeSnapshotMetrics(db);
    expect(m.liquidCents).toBe(EXPECT.liquid);
    expect(m.totalDebtCents).toBe(EXPECT.totalDebt);
    expect(m.cardBalanceCents).toBe(EXPECT.card);
    expect(m.efBalanceCents).toBe(EXPECT.ef);
    expect(m.netWorthCents).toBe(EXPECT.netWorth);
    expect(m.netWorthCents).toBe(m.liquidCents + EXPECT.holdings - m.totalDebtCents);
  });

  it('writes today\'s snapshot on the FIRST run against an empty table', () => {
    expect(db.select().from(snapshots).all()).toHaveLength(0);
    const res = runDailySnapshot('2026-06-19', db);
    const rows = db.select().from(snapshots).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-06-19');
    expect(rows[0].net_worth_cents).toBe(EXPECT.netWorth);
    expect(res.netWorthCents).toBe(EXPECT.netWorth);
  });

  it('persists every metric column', () => {
    runDailySnapshot('2026-06-19', db);
    const row = db.select().from(snapshots).all()[0];
    expect(row.total_debt_cents).toBe(EXPECT.totalDebt);
    expect(row.card_balance_cents).toBe(EXPECT.card);
    expect(row.ef_balance_cents).toBe(EXPECT.ef);
    expect(row.liquid_cents).toBe(EXPECT.liquid);
  });

  it('is idempotent — running twice for the same date keeps ONE row', () => {
    runDailySnapshot('2026-06-19', db);
    runDailySnapshot('2026-06-19', db);
    runDailySnapshot('2026-06-19', db);
    expect(db.select().from(snapshots).all()).toHaveLength(1);
  });

  it('re-run for the same date OVERWRITES the metrics in place (not a new row)', () => {
    runDailySnapshot('2026-06-19', db);
    // Pay down the card by 100000 → debts shrink, net worth rises by 100000.
    db.update(debts).set({ balance_cents: 640076 }).where(eq(debts.type, 'revolving')).run();
    runDailySnapshot('2026-06-19', db);
    const rows = db.select().from(snapshots).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].card_balance_cents).toBe(640076);
    expect(rows[0].net_worth_cents).toBe(EXPECT.netWorth + 100000);
  });

  it('writes a SEPARATE row for a different date', () => {
    runDailySnapshot('2026-06-19', db);
    runDailySnapshot('2026-06-20', db);
    const rows = db.select().from(snapshots).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.date).sort()).toEqual(['2026-06-19', '2026-06-20']);
  });
});

describe('server/tasks/daily-snapshot.ts — defineTask contract', () => {
  it('exports a task object with flat meta.name "daily-snapshot"', async () => {
    const mod = await import('../../../server/tasks/daily-snapshot.ts');
    expect(mod.default).toBeDefined();
    expect(mod.default.meta?.name).toBe('daily-snapshot');
    expect(typeof mod.default.run).toBe('function');
  });
});

// test/server/utils/post.test.ts
// DATABASE_URL must be :memory: (set in vitest env) so the module-level db singleton is in-memory.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db, sqlite } from '../../../server/db/index';
import { accounts, debts, transactions, recurringItems } from '../../../server/db/schema';
import { postTransaction, recomputeBalances } from '../../../server/utils/post';
import { runMigrations } from '../../../server/db/migrate';
import { eq } from 'drizzle-orm';

// Ensure tables exist (no-op if already applied).
beforeAll(() => {
  runMigrations(sqlite);
});

function freshAccount(name: string, type: string, balance = 0, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  const [row] = db.insert(accounts).values({
    name, type: type as any, balance_cents: balance, created_at: now, updated_at: now, ...extra,
  }).returning().all();
  return row.id as number;
}

describe('postTransaction', () => {
  beforeEach(() => {
    db.delete(transactions).run();
    db.delete(recurringItems).run();
    db.delete(accounts).run();
    db.delete(debts).run();
  });

  it('debits the funding account by the (negative) amount on an expense', () => {
    const bank = freshAccount('Bank', 'bank', 100000);
    const { id } = postTransaction({
      uuid: 'tx-1', date: '2026-06-18', amount_cents: -3000, direction: 'expense',
      category: 'food', account_id: bank, source: 'manual',
    });
    expect(typeof id).toBe('number');
    const acc = db.select().from(accounts).where(eq(accounts.id, bank)).get();
    expect(acc!.balance_cents).toBe(97000);
  });

  it('writes both legs of a transfer: debit account_id, credit counter_account_id', () => {
    const bank = freshAccount('Bank', 'bank', 100000);
    const ef = freshAccount('Emergency Fund', 'savings', 0);
    postTransaction({
      uuid: 'tf-1', date: '2026-06-18', amount_cents: -30000, direction: 'transfer',
      category: 'savings', account_id: bank, counter_account_id: ef, source: 'manual',
    });
    const bankRow = db.select().from(accounts).where(eq(accounts.id, bank)).get();
    const efRow = db.select().from(accounts).where(eq(accounts.id, ef)).get();
    expect(bankRow!.balance_cents).toBe(70000);
    expect(efRow!.balance_cents).toBe(30000);
    // exactly one transactions row (two-leg modelled via counter_account_id, not two rows)
    expect(db.select().from(transactions).all().length).toBe(1);
  });

  function freshDebt(name: string, balance: number, extra: Record<string, unknown> = {}) {
    const now = Date.now();
    const [row] = db.insert(debts).values({
      name, type: 'revolving' as any, balance_cents: balance, rate_type: 'apr' as any,
      created_at: now, updated_at: now, ...extra,
    }).returning().all();
    return row.id as number;
  }

  it('decrements debt balance on a debt payment (negative amount)', () => {
    const bank = freshAccount('Bank', 'bank', 100000);
    const card = freshDebt('Credit Card', 740076);
    postTransaction({
      uuid: 'pay-1', date: '2026-06-18', amount_cents: -50000, direction: 'expense',
      category: 'debt', account_id: bank, debt_id: card, source: 'manual',
    });
    const debtRow = db.select().from(debts).where(eq(debts.id, card)).get();
    // A1: debt += amount_cents → 740076 + (−50000) = 690076
    expect(debtRow!.balance_cents).toBe(690076);
  });

  it('increments debt balance on an interest accrual (positive amount, category interest)', () => {
    const cardAcct = freshAccount('Credit Card', 'card', -740076);
    const card = freshDebt('Credit Card', 740076);
    postTransaction({
      uuid: 'int-1', date: '2026-06-15', amount_cents: 11101, direction: 'expense',
      category: 'interest', account_id: cardAcct, debt_id: card, source: 'auto',
    });
    const debtRow = db.select().from(debts).where(eq(debts.id, card)).get();
    // A1: debt += amount_cents → 740076 + 11101 = 751177
    expect(debtRow!.balance_cents).toBe(751177);
    const acct = db.select().from(accounts).where(eq(accounts.id, cardAcct)).get();
    // card account: balance += -amount_cents → -740076 + (−11101) = -751177
    expect(acct!.balance_cents).toBe(-751177);
  });

  it('keeps card account balance equal to the negative of the card debt after interest', () => {
    const cardAcct = freshAccount('Credit Card', 'card', -740076, { credit_limit_cents: 798740 });
    const card = freshDebt('Credit Card', 740076);
    postTransaction({
      uuid: 'int-2', date: '2026-06-15', amount_cents: 11101, direction: 'expense',
      category: 'interest', account_id: cardAcct, debt_id: card, source: 'auto',
    });
    const acct = db.select().from(accounts).where(eq(accounts.id, cardAcct)).get();
    const debtRow = db.select().from(debts).where(eq(debts.id, card)).get();
    expect(acct!.balance_cents).toBe(-debtRow!.balance_cents);
  });

  it('decrements remaining_occurrences and recomputes next_due_date when recurring_item_id is set', () => {
    const bank = freshAccount('Bank', 'bank', 100000);
    const now = Date.now();
    const [item] = db.insert(recurringItems).values({
      name: 'SLoan 1', direction: 'expense' as any, amount_cents: 17743,
      cadence: 'monthly' as any, day_of_month: 12, category: 'debt',
      funding_account_id: bank, auto_post: true, start_date: '2026-06-12',
      remaining_occurrences: 8, next_due_date: '2026-06-12', is_active: true,
      created_at: now, updated_at: now,
    }).returning().all();

    postTransaction({
      uuid: 'sl1-jun', date: '2026-06-12', amount_cents: -17743, direction: 'expense',
      category: 'debt', account_id: bank, source: 'auto', recurring_item_id: item.id as number,
    });

    const after = db.select().from(recurringItems).where(eq(recurringItems.id, item.id as number)).get();
    expect(after!.remaining_occurrences).toBe(7);
    expect(after!.last_posted_date).toBe('2026-06-12');
    expect(after!.next_due_date).toBe('2026-07-12');
  });

  it('recomputeBalances rebuilds account and debt balances from ledger rows', () => {
    const bank = freshAccount('Bank', 'bank', 999999);    // deliberately wrong
    const cardAcct = freshAccount('Credit Card', 'card', 12345); // deliberately wrong
    const card = freshDebt('Credit Card', 555);           // deliberately wrong
    // Real history: salary in, food out, card interest, card payment.
    postTransaction({ uuid: 'r1', date: '2026-06-03', amount_cents: 581950, direction: 'income', category: 'income', account_id: bank, source: 'auto' });
    postTransaction({ uuid: 'r2', date: '2026-06-04', amount_cents: -3000, direction: 'expense', category: 'food', account_id: bank, source: 'manual' });
    postTransaction({ uuid: 'r3', date: '2026-06-15', amount_cents: 11101, direction: 'expense', category: 'interest', account_id: cardAcct, debt_id: card, source: 'auto' });
    postTransaction({ uuid: 'r4', date: '2026-06-05', amount_cents: -50000, direction: 'expense', category: 'debt', account_id: bank, debt_id: card, source: 'manual' });

    // Corrupt balances, then rebuild.
    db.update(accounts).set({ balance_cents: 0 }).run();
    db.update(debts).set({ balance_cents: 0 }).run();
    recomputeBalances();

    const bankRow = db.select().from(accounts).where(eq(accounts.id, bank)).get();
    const cardAcctRow = db.select().from(accounts).where(eq(accounts.id, cardAcct)).get();
    const cardDebt = db.select().from(debts).where(eq(debts.id, card)).get();
    // bank: SUM(amount_cents) = 581950 - 3000 - 50000 = 528950
    expect(bankRow!.balance_cents).toBe(528950);
    // cardAcct (card type): -(SUM of amount_cents) = -(11101) = -11101
    expect(cardAcctRow!.balance_cents).toBe(-11101);
    // A2: debt = SUM(+amount_cents) = 11101 + (−50000) = −38899
    expect(cardDebt!.balance_cents).toBe(11101 - 50000); // −38899
  });
});

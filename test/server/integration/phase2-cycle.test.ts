// test/server/integration/phase2-cycle.test.ts
// Phase-2 capstone integration test — exercises the full ledger/recurring/interest
// cycle end-to-end against a fresh in-memory DB.
//
// Fixtures follow the seed pattern: all accounts and debts start at balance_cents=0;
// opening balances are established via postTransaction (so recomputeBalances can
// reconstruct every balance from the ledger alone — no "hidden" seeded balances).
//
// Scenario:
//   Bank account    (opening balance 0 — no opening row needed)
//   Card account    (opening balance -740076 via ob-card adjustment row)
//   Card debt       (opening balance 740076 via ob-card adjustment row)
//   Net Salary      (income 581950, due 3rd)
//   SLoan 1         (expense 17743, due 12th, remaining 8, debt_id → card debt)
//
// runPostRecurring('2026-06-15') covers:
//   – Salary due 3rd  → posts +581950 to bank
//   – SLoan1 due 12th → posts -17743 from bank, -17743 to card debt
//   – Interest day 15 → computes on post-SLoan1 card debt balance (722333+740076=1462409? no—)
//
// After opening-balance row (ob-card) the card debt balance = 740076.
// After SLoan1 (-17743): card debt = 740076 - 17743 = 722333.
// Interest = floor(722333 × 1800 / 120000) = 10834.
// After interest (+10834): card debt = 733167.
//
// Card account after opening row: -740076.
// SLoan1 does NOT touch card account (account_id=bank).
// Interest acct leg (card type, amount=+10834): acctDelta = -10834 → -740076 - 10834 = -750910.
//
// recomputeBalances() derives all balances from ledger alone → must match live values.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db, sqlite } from '../../../server/db/index';
import { accounts, debts, recurringItems, transactions } from '../../../server/db/schema';
import { runPostRecurring } from '../../../server/utils/postRecurring';
import { recomputeBalances, postTransaction } from '../../../server/utils/post';
import { runMigrations } from '../../../server/db/migrate';
import { eq } from 'drizzle-orm';

// Ensure tables exist before any test runs.
beforeAll(() => {
  runMigrations(sqlite);
});

describe('phase 2 full cycle', () => {
  let bankId: number;
  let cardAcctId: number;
  let cardDebtId: number;

  beforeEach(() => {
    db.delete(transactions).run();
    db.delete(recurringItems).run();
    db.delete(debts).run();
    db.delete(accounts).run();

    const now = Date.now();

    // All accounts and debts start at 0; opening balances posted via postTransaction
    // so recomputeBalances() can reconstruct them from the ledger alone.
    const [bank] = db.insert(accounts).values({
      name: 'Bank',
      type: 'bank' as any,
      balance_cents: 0,
      created_at: now,
      updated_at: now,
    }).returning().all();

    const [cardAcct] = db.insert(accounts).values({
      name: 'Credit Card',
      type: 'card' as any,
      balance_cents: 0,
      credit_limit_cents: 798740,
      created_at: now,
      updated_at: now,
    }).returning().all();

    const [cardDebt] = db.insert(debts).values({
      name: 'Credit Card',
      type: 'revolving' as any,
      balance_cents: 0,
      rate_type: 'apr' as any,
      apr_bps: 1800,
      statement_day: 15,
      due_day: 5,
      bt_status: 'none' as any,
      linked_account_id: cardAcct.id,
      created_at: now,
      updated_at: now,
    }).returning().all();

    bankId = bank.id as number;
    cardAcctId = cardAcct.id as number;
    cardDebtId = cardDebt.id as number;

    // Opening-balance row: card account and card debt both start at 740076 outstanding.
    // Card account (type=card): acctDelta = -740076 → balance = -740076.
    // Card debt:                debt.balance += 740076 → balance = 740076.
    postTransaction({
      uuid: 'ob-card',
      date: '2026-06-01',
      amount_cents: 740076,
      direction: 'expense',
      category: 'adjustment',
      account_id: cardAcctId,
      debt_id: cardDebtId,
      source: 'adjustment',
      note: 'Opening balance',
    });

    // Salary template (income, bank) due 3rd.
    // SLoan 1 (expense, bank → card debt) due 12th, remaining 8 occurrences.
    db.insert(recurringItems).values([
      {
        name: 'Net Salary',
        direction: 'income' as any,
        amount_cents: 581950,
        cadence: 'monthly' as any,
        day_of_month: 3,
        category: 'income',
        funding_account_id: bankId,
        auto_post: true,
        is_active: true,
        start_date: '2026-06-01',
        next_due_date: '2026-06-03',
        created_at: now,
        updated_at: now,
      },
      {
        name: 'SLoan 1',
        direction: 'expense' as any,
        amount_cents: 17743,
        cadence: 'monthly' as any,
        day_of_month: 12,
        category: 'debt',
        funding_account_id: bankId,
        debt_id: cardDebtId,
        auto_post: true,
        is_active: true,
        start_date: '2026-06-01',
        next_due_date: '2026-06-12',
        remaining_occurrences: 8,
        created_at: now,
        updated_at: now,
      },
    ]).run();
  });

  it('posts salary + loan + interest, decrements occurrence, and recompute matches live balances', () => {
    // -----------------------------------------------------------------------
    // Run for 2026-06-15 — covers salary (3rd), SLoan1 (12th), interest (15th).
    // -----------------------------------------------------------------------
    const r = runPostRecurring('2026-06-15');
    expect(r.posted).toBe(2);   // salary + SLoan1 (both next_due_date ≤ 2026-06-15)
    expect(r.interest).toBe(1); // statement_day = 15

    // -----------------------------------------------------------------------
    // Verify live balance reads after the cycle.
    //
    // Bank: starts 0, +581950 (salary), -17743 (SLoan1) = 564207
    //
    // Card debt sequence (ledger SUM):
    //   ob-card:  +740076
    //   SLoan1:   -17743  → running 722333
    //   Interest: floor(722333 × 1800 / 120000) = floor(10834.995) = 10834
    //             → 722333 + 10834 = 733167
    //   ledger SUM = 740076 - 17743 + 10834 = 733167
    //
    // Card account (SUM: -(primary) per recompute, type=card):
    //   ob-card:  amount=+740076 → acctDelta = -740076
    //   SLoan1:   NO card-account leg (account_id=bank)
    //   Interest: amount=+10834  → acctDelta = -10834
    //   card.balance = -(740076 + 10834) = -750910
    // -----------------------------------------------------------------------
    const bankLive     = db.select().from(accounts).where(eq(accounts.id, bankId)).get()!.balance_cents;
    const cardDebtLive = db.select().from(debts).where(eq(debts.id, cardDebtId)).get()!.balance_cents;
    const cardAcctLive = db.select().from(accounts).where(eq(accounts.id, cardAcctId)).get()!.balance_cents;

    expect(bankLive).toBe(564207);    // 0 + 581950 - 17743
    expect(cardDebtLive).toBe(733167); // 740076 - 17743 + 10834
    expect(cardAcctLive).toBe(-750910); // -(740076 + 10834); SLoan1 does not touch card account

    // -----------------------------------------------------------------------
    // SLoan 1 meta: occurrence decremented, next_due_date advanced.
    // -----------------------------------------------------------------------
    const sl1 = db.select().from(recurringItems).where(eq(recurringItems.name, 'SLoan 1')).get()!;
    expect(sl1.remaining_occurrences).toBe(7);    // was 8, decremented by 1
    expect(sl1.next_due_date).toBe('2026-07-12'); // advanced to next month

    // -----------------------------------------------------------------------
    // recomputeBalances parity: corrupt balances, then recompute from ledger.
    // Must produce byte-identical values to the live reads above.
    // -----------------------------------------------------------------------
    db.update(accounts).set({ balance_cents: 999999, updated_at: Date.now() }).where(eq(accounts.id, bankId)).run();
    db.update(accounts).set({ balance_cents: 999999, updated_at: Date.now() }).where(eq(accounts.id, cardAcctId)).run();
    db.update(debts).set({ balance_cents: 999999, updated_at: Date.now() }).where(eq(debts.id, cardDebtId)).run();

    recomputeBalances();

    expect(db.select().from(accounts).where(eq(accounts.id, bankId)).get()!.balance_cents).toBe(bankLive);
    expect(db.select().from(debts).where(eq(debts.id, cardDebtId)).get()!.balance_cents).toBe(cardDebtLive);
    expect(db.select().from(accounts).where(eq(accounts.id, cardAcctId)).get()!.balance_cents).toBe(cardAcctLive);

    // -----------------------------------------------------------------------
    // Idempotency: re-running post-recurring on the same date posts nothing new.
    // next_due_date is already advanced to July; interest UUID exists for 2026-06.
    // -----------------------------------------------------------------------
    const r2 = runPostRecurring('2026-06-15');
    expect(r2.posted).toBe(0);    // next_due_date advanced to July — nothing due on 15th
    expect(r2.interest).toBe(0);  // interest UUID `interest-<id>-2026-06` already exists

    // Ledger row count must not increase after rerun: ob-card + salary + SLoan1 + interest = 4.
    const txCount = db.select().from(transactions).all().length;
    expect(txCount).toBe(4); // opening + salary + SLoan1 + interest (no duplicates)
  });
});

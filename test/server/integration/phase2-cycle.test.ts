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
//   SLoan1 debt     (opening balance 141944 via ob-sl1 debt-only row)
//   Net Salary      (income 581950, due 3rd)
//   SLoan 1         (expense 17743, due 12th, remaining 8, debt_id → sloan1DebtId)
//
// runPostRecurring('2026-06-15') covers:
//   – Salary due 3rd  → posts +581950 to bank
//   – SLoan1 due 12th → posts -17743 from bank, -17743 to SLoan1 debt (NOT card debt)
//   – Interest day 15 → computes on card debt balance (740076 unchanged by SLoan1)
//
// Card debt is unchanged by SLoan1 (SLoan1 routes to its own installment debt).
// Interest = floor(740076 × 1800 / 120000) = floor(11101.14) = 11101.
// After interest (+11101): card debt = 740076 + 11101 = 751177.
//
// Card account after ob-card row: -740076.
// SLoan1 does NOT touch card account (account_id=bank).
// Interest acct leg (card type, amount=+11101): acctDelta = -11101 → -740076 - 11101 = -751177.
//
// After recomputeBalances() with mirror guard:
//   cardAccount.balance_cents = -(cardDebt.balance_cents) = -751177  ✓
//
// SLoan1 debt: ob-sl1 = +141944, SLoan1 payment = -17743 → 141944 - 17743 = 124201.

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
  let sloan1DebtId: number;

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

    // SLoan 1 has its own installment debt — it does NOT route through the card debt.
    const [sloan1Debt] = db.insert(debts).values({
      name: 'SLoan 1',
      type: 'installment' as any,
      balance_cents: 0,
      rate_type: 'none' as any,
      scheduled_payment_cents: 17743,
      due_day: 12,
      payments_total: 8,
      created_at: now,
      updated_at: now,
    }).returning().all();

    bankId      = bank.id      as number;
    cardAcctId  = cardAcct.id  as number;
    cardDebtId  = cardDebt.id  as number;
    sloan1DebtId = sloan1Debt.id as number;

    // Back-link card account → card debt (mirrors seed.ts line 113).
    // recomputeBalances() uses this to derive cardAccount.balance = -cardDebt.balance.
    db.update(accounts).set({ debt_id: cardDebtId }).where(eq(accounts.id, cardAcctId)).run();

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

    // SLoan1 debt opening balance (debt-only row; no cash account involved).
    // 8 remaining payments × 17743 = 141944.
    postTransaction({
      uuid: 'ob-sl1',
      date: '2026-06-01',
      amount_cents: 141944,
      direction: 'expense',
      category: 'adjustment',
      account_id: null,
      debt_id: sloan1DebtId,
      source: 'adjustment',
      note: 'Opening balance',
    });

    // Salary template (income, bank) due 3rd.
    // SLoan 1 (expense, bank → SLoan1 debt) due 12th, remaining 8 occurrences.
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
        debt_id: sloan1DebtId, // routes to SLoan1's own installment debt, NOT card debt
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
    // SLoan1 debt sequence:
    //   ob-sl1:  +141944
    //   SLoan1 payment: -17743 → 141944 - 17743 = 124201
    //
    // Card debt sequence (ledger SUM):
    //   ob-card:  +740076
    //   SLoan1:   NO card-debt leg (debt_id=sloan1DebtId, not cardDebtId)
    //   Interest: floor(740076 × 1800 / 120000) = floor(11101.14) = 11101
    //             → 740076 + 11101 = 751177
    //   ledger SUM = 740076 + 11101 = 751177
    //
    // Card account (live, posted by postTransaction):
    //   ob-card:  amount=+740076 → acctDelta = -740076
    //   SLoan1:   NO card-account leg (account_id=bank)
    //   Interest: amount=+11101  → acctDelta = -11101
    //   card.balance = -(740076 + 11101) = -751177
    // -----------------------------------------------------------------------
    const bankLive      = db.select().from(accounts).where(eq(accounts.id, bankId)).get()!.balance_cents;
    const cardDebtLive  = db.select().from(debts).where(eq(debts.id, cardDebtId)).get()!.balance_cents;
    const cardAcctLive  = db.select().from(accounts).where(eq(accounts.id, cardAcctId)).get()!.balance_cents;
    const sloan1DebtLive = db.select().from(debts).where(eq(debts.id, sloan1DebtId)).get()!.balance_cents;

    expect(bankLive).toBe(564207);       // 0 + 581950 - 17743
    expect(cardDebtLive).toBe(751177);   // 740076 + 11101 (SLoan1 does NOT touch card debt)
    expect(cardAcctLive).toBe(-751177);  // -(740076 + 11101); SLoan1 does not touch card account
    expect(sloan1DebtLive).toBe(124201); // 141944 - 17743

    // SLoan1 does NOT touch card debt — card debt balance unchanged by SLoan1 payment.
    // (Only the interest accrual on statement day 15 changes the card debt.)

    // -----------------------------------------------------------------------
    // SLoan 1 meta: occurrence decremented, next_due_date advanced.
    // -----------------------------------------------------------------------
    const sl1 = db.select().from(recurringItems).where(eq(recurringItems.name, 'SLoan 1')).get()!;
    expect(sl1.remaining_occurrences).toBe(7);    // was 8, decremented by 1
    expect(sl1.next_due_date).toBe('2026-07-12'); // advanced to next month

    // -----------------------------------------------------------------------
    // recomputeBalances parity: corrupt balances, then recompute from ledger.
    // Must produce byte-identical values to the live reads above.
    // For the card account: recompute uses the mirror guard → balance = -cardDebt.balance.
    // -----------------------------------------------------------------------
    db.update(accounts).set({ balance_cents: 999999, updated_at: Date.now() }).where(eq(accounts.id, bankId)).run();
    db.update(accounts).set({ balance_cents: 999999, updated_at: Date.now() }).where(eq(accounts.id, cardAcctId)).run();
    db.update(debts).set({ balance_cents: 999999, updated_at: Date.now() }).where(eq(debts.id, cardDebtId)).run();
    db.update(debts).set({ balance_cents: 999999, updated_at: Date.now() }).where(eq(debts.id, sloan1DebtId)).run();

    recomputeBalances();

    expect(db.select().from(accounts).where(eq(accounts.id, bankId)).get()!.balance_cents).toBe(bankLive);
    expect(db.select().from(debts).where(eq(debts.id, cardDebtId)).get()!.balance_cents).toBe(cardDebtLive);
    expect(db.select().from(debts).where(eq(debts.id, sloan1DebtId)).get()!.balance_cents).toBe(sloan1DebtLive);
    // Mirror guard: card account balance = -(card debt balance) after recompute.
    expect(db.select().from(accounts).where(eq(accounts.id, cardAcctId)).get()!.balance_cents).toBe(-cardDebtLive);
    expect(db.select().from(accounts).where(eq(accounts.id, cardAcctId)).get()!.balance_cents).toBe(cardAcctLive);

    // -----------------------------------------------------------------------
    // Idempotency: re-running post-recurring on the same date posts nothing new.
    // next_due_date is already advanced to July; interest UUID exists for 2026-06.
    // -----------------------------------------------------------------------
    const r2 = runPostRecurring('2026-06-15');
    expect(r2.posted).toBe(0);    // next_due_date advanced to July — nothing due on 15th
    expect(r2.interest).toBe(0);  // interest UUID `interest-<id>-2026-06` already exists

    // Ledger row count must not increase after rerun:
    // ob-card + ob-sl1 + salary + SLoan1 + interest = 5.
    const txCount = db.select().from(transactions).all().length;
    expect(txCount).toBe(5); // 2 opening + salary + SLoan1 + interest (no duplicates)
  });

  it('card account mirrors card debt after a bank→card-debt payment via recomputeBalances', () => {
    // -----------------------------------------------------------------------
    // Post a manual card payment: bank pays 50000 against the card debt.
    // Wiring: account_id=bank (bank decreases), debt_id=card (debt decreases),
    // direction=expense, amount_cents=-50000 (negative = payment/credit).
    // -----------------------------------------------------------------------
    postTransaction({
      uuid: 'card-pay-01',
      date: '2026-06-10',
      amount_cents: -50000,  // negative amount → bank.balance += -50000; debt.balance += -50000
      direction: 'expense',
      category: 'debt',
      account_id: bankId,
      debt_id: cardDebtId,
      source: 'manual',
      note: 'Card payment',
    });

    // After ob-card (+740076) and payment (-50000):
    //   cardDebt.balance = 740076 - 50000 = 690076
    //   cardAcct.balance = -(740076) + 0 = -740076  (no card-account leg in payment)
    //
    // After recomputeBalances() with mirror guard:
    //   cardDebt (from ledger): 740076 + (-50000) = 690076
    //   cardAcct (mirror):      -(690076) = -690076
    //
    // This proves the mirror guard corrects the divergence caused by routing a
    // payment through bank→card-debt without a card-account leg.

    // Corrupt both to force a full recompute.
    db.update(accounts).set({ balance_cents: 999999, updated_at: Date.now() }).where(eq(accounts.id, cardAcctId)).run();
    db.update(debts).set({ balance_cents: 999999, updated_at: Date.now() }).where(eq(debts.id, cardDebtId)).run();

    recomputeBalances();

    const cardDebtAfter = db.select().from(debts).where(eq(debts.id, cardDebtId)).get()!.balance_cents;
    const cardAcctAfter = db.select().from(accounts).where(eq(accounts.id, cardAcctId)).get()!.balance_cents;

    expect(cardDebtAfter).toBe(690076);  // 740076 - 50000
    expect(cardAcctAfter).toBe(-690076); // mirror: -(card debt balance)
    // Mirror invariant: cardAccount.balance_cents === −cardDebt.balance_cents
    expect(cardAcctAfter).toBe(-cardDebtAfter);
  });
});

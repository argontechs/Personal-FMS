// server/utils/post.ts
import { db as defaultDb } from '../db/index';
import { accounts, debts, transactions, recurringItems } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { nowEpoch, nextDueDate } from './mytDate';

export interface PostInput {
  uuid: string;
  date: string;            // MYT YYYY-MM-DD
  amount_cents: number;    // + income/credit, − expense/debit
  direction: 'income' | 'expense' | 'transfer';
  category: 'food' | 'transport' | 'bills' | 'debt' | 'income' | 'savings' | 'interest' | 'adjustment' | 'other';
  // null is allowed ONLY for debt-only adjustment rows (opening-balance ledger entries for
  // debts that have no linked cash account). When null the account leg is skipped entirely.
  account_id: number | null;
  counter_account_id?: number | null;
  debt_id?: number | null;
  goal_id?: number | null;
  note?: string | null;
  source: 'auto' | 'manual' | 'adjustment';
  recurring_item_id?: number | null;
  is_estimate?: boolean;
}

export function postTransaction(input: PostInput, db: BetterSQLite3Database<Record<string, unknown>> = defaultDb): { id: number } {
  return db.transaction((tx) => {
    const created = nowEpoch();

    // Insert ledger row; UUID UNIQUE constraint handles idempotency.
    // account_id is nullable for debt-only adjustment rows (opening-balance entries for debts
    // that have no linked cash account).
    const [row] = tx.insert(transactions).values({
      uuid: input.uuid,
      date: input.date,
      amount_cents: input.amount_cents,
      direction: input.direction,
      category: input.category,
      account_id: input.account_id ?? null,
      counter_account_id: input.counter_account_id ?? null,
      debt_id: input.debt_id ?? null,
      goal_id: input.goal_id ?? null,
      note: input.note ?? null,
      source: input.source,
      recurring_item_id: input.recurring_item_id ?? null,
      is_estimate: input.is_estimate ?? false,
      created_at: created,
    }).returning({ id: transactions.id }).all();

    // --- Primary account leg ---
    // Convention: amount_cents is the signed cash effect (+income/−expense) for non-card accounts.
    // Card accounts store outstanding debt as a NEGATIVE balance; interest/charges (positive
    // amount_cents) must make the balance MORE negative, so we negate for card type.
    // When account_id is null (debt-only opening row) the account leg is skipped entirely.
    if (input.account_id != null) {
    const acct = tx.select().from(accounts).where(eq(accounts.id, input.account_id)).get();
    const isCard = acct?.type === 'card';
    // E2: final form — no scratch/Math.sign line.
    const acctDelta = isCard ? -input.amount_cents : input.amount_cents;
    tx.update(accounts)
      .set({ balance_cents: sql`${accounts.balance_cents} + ${acctDelta}`, updated_at: created })
      .where(eq(accounts.id, input.account_id)).run();
    }

    // --- Counter-account leg (A3: transfers write one row, two balance updates) ---
    // counter receives −amount_cents so a transfer of amount=−30000 credits the counter by +30000.
    if (input.counter_account_id != null) {
      tx.update(accounts)
        .set({ balance_cents: sql`${accounts.balance_cents} - ${input.amount_cents}`, updated_at: created })
        .where(eq(accounts.id, input.counter_account_id)).run();
    }

    // --- Debt leg (A1: debt.balance_cents += amount_cents) ---
    // Payment (negative amount) shrinks debt; interest accrual (positive amount) grows it.
    // Sanity: payment −50000 on 740076 → 740076 + (−50000) = 690076 ✓
    //         interest +11101 on 740076 → 740076 + 11101 = 751177 ✓
    if (input.debt_id != null) {
      tx.update(debts)
        .set({ balance_cents: sql`${debts.balance_cents} + ${input.amount_cents}`, updated_at: created })
        .where(eq(debts.id, input.debt_id)).run();
    }

    // --- Recurring-item leg: decrement occurrence counter + advance next_due_date ---
    if (input.recurring_item_id != null) {
      const item = tx.select().from(recurringItems)
        .where(eq(recurringItems.id, input.recurring_item_id)).get();
      if (item) {
        const dom = item.day_of_month ?? Number(input.date.slice(8, 10));
        // Advance one day past the posting date so nextDueDate rolls to the NEXT occurrence,
        // not the same-day occurrence (e.g. posting on the 12th → next due is the 12th of next month).
        const [py, pm, pd] = input.date.split('-').map(Number);
        const dayAfter = new Date(Date.UTC(py, pm - 1, pd + 1));
        const dayAfterISO = `${dayAfter.getUTCFullYear()}-${String(dayAfter.getUTCMonth() + 1).padStart(2, '0')}-${String(dayAfter.getUTCDate()).padStart(2, '0')}`;
        const recomputed = nextDueDate(dayAfterISO, dom);
        tx.update(recurringItems).set({
          remaining_occurrences: item.remaining_occurrences == null
            ? null
            : Math.max(0, item.remaining_occurrences - 1),
          last_posted_date: input.date,
          next_due_date: recomputed,
          updated_at: created,
        }).where(eq(recurringItems.id, input.recurring_item_id)).run();
      }
    }

    return { id: row.id as number };
  });
}

export function recomputeBalances(db: BetterSQLite3Database<Record<string, unknown>> = defaultDb): void {
  db.transaction((tx) => {
    const now = nowEpoch();

    // --- Step 1: Recompute non-card account balances from ledger ---
    // Non-card: balance = SUM(amount_cents WHERE account_id=A) + SUM(-amount_cents WHERE counter_account_id=A)
    // Card accounts with a linked debt_id are handled in Step 3 (mirror); card accounts
    // without a debt_id fall back to ledger-sum here so they are always written.
    const accs = tx.select().from(accounts).all();
    for (const a of accs) {
      const isCard = a.type === 'card';
      // Card accounts that have a debt back-link are mirrored in Step 3 — skip for now.
      if (isCard && a.debt_id != null) continue;

      const primary = tx.select({ s: sql<number>`coalesce(sum(${transactions.amount_cents}), 0)` })
        .from(transactions).where(eq(transactions.account_id, a.id)).get();
      const counter = tx.select({ s: sql<number>`coalesce(sum(-${transactions.amount_cents}), 0)` })
        .from(transactions).where(eq(transactions.counter_account_id, a.id)).get();
      const primarySum = Number(primary?.s ?? 0);
      const counterSum = Number(counter?.s ?? 0);
      // A3: card negates the primary sum (card balance = -(primary charges))
      const bal = (isCard ? -primarySum : primarySum) + counterSum;
      tx.update(accounts).set({ balance_cents: bal, updated_at: now }).where(eq(accounts.id, a.id)).run();
    }

    // --- Step 2: Recompute debt balances from ledger (A2: SUM(+amount_cents)) ---
    // debt.balance = SUM(amount_cents WHERE debt_id=D)
    // Payment −50000 shrinks (adds negative), interest +11101 grows (adds positive).
    // Sanity: interest +11101 + payment −50000 = −38899 ✓
    const dbts = tx.select().from(debts).all();
    for (const d of dbts) {
      const agg = tx.select({ s: sql<number>`coalesce(sum(${transactions.amount_cents}), 0)` })
        .from(transactions).where(eq(transactions.debt_id, d.id)).get();
      tx.update(debts).set({ balance_cents: Number(agg?.s ?? 0), updated_at: now }).where(eq(debts.id, d.id)).run();
    }

    // --- Step 3: Mirror card accounts to their linked debt (card balance = −debt balance) ---
    // For any card account that has a debt_id back-link, derive its balance as −(debt.balance_cents).
    // This guarantees cardAccount.balance_cents === −cardDebt.balance_cents after any recompute,
    // regardless of payment wiring (e.g. payments routed to debt_id without a card-account leg).
    for (const a of accs) {
      if (a.type !== 'card' || a.debt_id == null) continue;
      const linkedDebt = tx.select({ b: debts.balance_cents }).from(debts).where(eq(debts.id, a.debt_id)).get();
      const bal = -(Number(linkedDebt?.b ?? 0));
      tx.update(accounts).set({ balance_cents: bal, updated_at: now }).where(eq(accounts.id, a.id)).run();
    }
  });
}

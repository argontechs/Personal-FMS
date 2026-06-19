// server/utils/postRecurring.ts
// Auto-posts due recurring templates and accrues card interest.
// Called by the Nitro scheduled task `post-recurring` and directly in tests.
import { db } from '../db/index';
import { recurringItems, debts, accounts, transactions } from '../db/schema';
import { postTransaction } from './post';
import { todayMYT, nextDueDate } from './mytDate';
import { and, eq, lte } from 'drizzle-orm';

// Maps a template's free-text category into the transactions enum.
function toEnumCategory(c: string, direction: string): string {
  if (direction === 'income') return 'income';
  if (['gym', 'subs', 'subscriptions', 'insurance', 'bills'].includes(c)) return 'bills';
  if (c === 'debt') return 'debt';
  if (['food', 'transport', 'interest', 'savings', 'adjustment', 'other'].includes(c)) return c;
  return 'other';
}

export function runPostRecurring(asOf?: string): { posted: number; interest: number } {
  const today = asOf ?? todayMYT();
  let posted = 0;

  // -----------------------------------------------------------------------
  // 1. Auto-post all due active templates
  // -----------------------------------------------------------------------
  const due = db.select().from(recurringItems)
    .where(and(
      eq(recurringItems.is_active, true),
      eq(recurringItems.auto_post, true),
      lte(recurringItems.next_due_date, today),
    )).all();

  for (const item of due) {
    // Finite template that has run to completion — skip without deactivating
    // (deactivation is done here when remaining_occurrences reaches 0 after posting).
    if (item.remaining_occurrences != null && item.remaining_occurrences <= 0) {
      // Deactivate templates that have been fully posted but not yet marked inactive.
      db.update(recurringItems)
        .set({ is_active: false, updated_at: Date.now() })
        .where(eq(recurringItems.id, item.id))
        .run();
      continue;
    }

    const postDate = item.next_due_date ?? today;

    // Idempotency backstop: UNIQUE(recurring_item_id, date) on the transactions table.
    // Also check explicitly to skip cleanly (the constraint would throw otherwise).
    const exists = db.select({ id: transactions.id }).from(transactions)
      .where(and(
        eq(transactions.recurring_item_id, item.id),
        eq(transactions.date, postDate),
      )).get();
    if (exists) continue;

    // -------------------------------------------------------------------
    // SPayLater: declining installment schedule.
    // Read the installment BY INDEX (never shift/mutate the stored array).
    // Index = number of installments already auto-posted for this template.
    // -------------------------------------------------------------------
    let amountCents = item.amount_cents;
    if (item.remaining_installments_json) {
      const schedule: number[] = JSON.parse(item.remaining_installments_json);
      // Count already-posted auto rows for this template to derive the current index.
      // Only count source='auto' so manual entries don't advance the index.
      const alreadyPosted = db.select({ id: transactions.id }).from(transactions)
        .where(and(eq(transactions.recurring_item_id, item.id), eq(transactions.source, 'auto'))).all().length;
      const idx = alreadyPosted;
      if (idx >= schedule.length) {
        // All installments exhausted — deactivate.
        db.update(recurringItems)
          .set({ is_active: false, updated_at: Date.now() })
          .where(eq(recurringItems.id, item.id))
          .run();
        continue;
      }
      amountCents = schedule[idx];
    }

    const signed = item.direction === 'income'
      ? Math.abs(amountCents)
      : -Math.abs(amountCents);

    postTransaction({
      uuid: `auto-${item.id}-${postDate}`,
      date: postDate,
      amount_cents: signed,
      direction: item.direction as 'income' | 'expense',
      category: toEnumCategory(item.category, item.direction) as any,
      account_id: item.funding_account_id ?? null,
      debt_id: item.debt_id ?? null,
      source: 'auto',
      recurring_item_id: item.id,
      is_estimate: item.is_variable ?? false,
    });
    posted++;

    // Deactivate finite templates that just had their last occurrence posted.
    // postTransaction already decremented remaining_occurrences to 0 inside its tx.
    if (item.remaining_occurrences != null && item.remaining_occurrences === 1) {
      // remaining_occurrences was 1 before posting → now 0 → mark inactive.
      db.update(recurringItems)
        .set({ is_active: false, updated_at: Date.now() })
        .where(eq(recurringItems.id, item.id))
        .run();
    }
  }

  // -----------------------------------------------------------------------
  // 2. Card interest accrual
  // Only fires on the card's statement_day, only while bt_status !== 'active'.
  // interest_cents = floor(balance × apr_bps / 120000)
  //   (apr_bps / 100 = % p.a.; ÷ 12 months → / 1200; bps ÷ 100 → / 120000)
  // Idempotent: UUID `interest-<debt_id>-<YYYY-MM>` is unique per card per month.
  // Amount is POSITIVE so it grows the debt (A1: debt.balance += amount_cents).
  // -----------------------------------------------------------------------
  let interestPosted = 0;
  const todayDay = Number(today.slice(8, 10));
  const cards = db.select().from(debts)
    .where(and(
      eq(debts.type, 'revolving'),
      eq(debts.statement_day, todayDay),
    )).all();

  for (const card of cards) {
    // Skip if under balance-transfer promo (interest waived).
    if (card.bt_status === 'active') continue;
    if (card.apr_bps == null || card.linked_account_id == null) continue;

    const interestCents = Math.floor((card.balance_cents * card.apr_bps) / 120000);
    if (interestCents <= 0) continue;

    // One interest row per card per statement month — idempotent via UUID.
    const uuid = `interest-${card.id}-${today.slice(0, 7)}`;
    const dup = db.select({ id: transactions.id }).from(transactions)
      .where(eq(transactions.uuid, uuid)).get();
    if (dup) continue;

    // Positive amount_cents → postTransaction: debt.balance += interestCents (grows debt)
    // and card account.balance += -interestCents (makes balance more negative).
    postTransaction({
      uuid,
      date: today,
      amount_cents: interestCents,
      direction: 'expense',
      category: 'interest',
      account_id: card.linked_account_id,
      debt_id: card.id,
      source: 'auto',
    });
    interestPosted++;
  }

  // -----------------------------------------------------------------------
  // 3. Advance next_due_date for reminder-only (is_active=true, auto_post=false) items
  //    that are due or overdue. No transactions are written; only next_due_date and
  //    last_posted_date are updated so committedOutflowsBeforeCents picks up the new cycle.
  // -----------------------------------------------------------------------
  const remindersDue = db.select().from(recurringItems)
    .where(and(
      eq(recurringItems.is_active, true),
      eq(recurringItems.auto_post, false),
      lte(recurringItems.next_due_date, today),
    )).all();

  for (const item of remindersDue) {
    // Skip items with no day_of_month — can't compute next occurrence.
    if (item.day_of_month == null) continue;

    // Skip fully-exhausted finite templates (same guard as auto path).
    if (item.remaining_occurrences != null && item.remaining_occurrences <= 0) {
      db.update(recurringItems)
        .set({ is_active: false, updated_at: Date.now() })
        .where(eq(recurringItems.id, item.id))
        .run();
      continue;
    }

    const postDate = item.next_due_date ?? today;

    // Honor end_date: if postDate >= end_date, deactivate without rolling.
    if (item.end_date && postDate >= item.end_date) {
      db.update(recurringItems)
        .set({ is_active: false, updated_at: Date.now() })
        .where(eq(recurringItems.id, item.id))
        .run();
      continue;
    }

    // Advance next_due_date to the next FUTURE occurrence (loop until > today).
    // Mirror the auto-post convention: advance one day past postDate before calling
    // nextDueDate so the same-day occurrence doesn't recur immediately.
    const [py, pm, pd] = postDate.split('-').map(Number);
    const dayAfter = new Date(Date.UTC(py, pm - 1, pd + 1));
    const dayAfterISO = `${dayAfter.getUTCFullYear()}-${String(dayAfter.getUTCMonth() + 1).padStart(2, '0')}-${String(dayAfter.getUTCDate()).padStart(2, '0')}`;
    let nextDue = nextDueDate(dayAfterISO, item.day_of_month);
    // Safety loop: in unusual catch-up scenarios, keep rolling until strictly > today.
    while (nextDue <= today) {
      const [ny, nm, nd] = nextDue.split('-').map(Number);
      const d2 = new Date(Date.UTC(ny, nm - 1, nd + 1));
      const d2ISO = `${d2.getUTCFullYear()}-${String(d2.getUTCMonth() + 1).padStart(2, '0')}-${String(d2.getUTCDate()).padStart(2, '0')}`;
      nextDue = nextDueDate(d2ISO, item.day_of_month);
    }

    // Honor end_date: don't roll past it.
    if (item.end_date && nextDue >= item.end_date) {
      db.update(recurringItems)
        .set({ is_active: false, updated_at: Date.now() })
        .where(eq(recurringItems.id, item.id))
        .run();
      continue;
    }

    // Decrement remaining_occurrences if finite (same as auto path: 1 → 0 → deactivate).
    const newRemaining = item.remaining_occurrences == null
      ? null
      : Math.max(0, item.remaining_occurrences - 1);

    db.update(recurringItems)
      .set({
        next_due_date: nextDue,
        last_posted_date: postDate,
        remaining_occurrences: newRemaining,
        is_active: newRemaining === 0 ? false : item.is_active,
        updated_at: Date.now(),
      })
      .where(eq(recurringItems.id, item.id))
      .run();
  }

  return { posted, interest: interestPosted };
}

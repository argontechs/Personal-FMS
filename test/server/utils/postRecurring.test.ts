// test/server/utils/postRecurring.test.ts
// DATABASE_URL=':memory:' set in vitest.config.ts so the module-level db singleton is in-memory.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db, sqlite } from '../../../server/db/index';
import { accounts, debts, recurringItems, transactions } from '../../../server/db/schema';
import { runPostRecurring } from '../../../server/utils/postRecurring';
import { committedOutflowsBeforeCents } from '../../../server/utils/forecastReads';
import { runMigrations } from '../../../server/db/migrate';
import { eq } from 'drizzle-orm';

// Ensure tables exist before any test runs.
beforeAll(() => {
  runMigrations(sqlite);
});

// Helper: insert a simple bank account and return its id.
function bank() {
  const now = Date.now();
  const [a] = db.insert(accounts).values({
    name: 'Bank', type: 'bank' as any, balance_cents: 100000,
    created_at: now, updated_at: now,
  }).returning().all();
  return a.id as number;
}

describe('runPostRecurring', () => {
  beforeEach(() => {
    db.delete(transactions).run();
    db.delete(recurringItems).run();
    db.delete(debts).run();
    db.delete(accounts).run();
  });

  // ---------------------------------------------------------------------------
  // 1. Basic idempotency: a due monthly template posts exactly once per day
  // ---------------------------------------------------------------------------
  it('auto-posts a due template exactly once, even on rerun', () => {
    const b = bank();
    const now = Date.now();
    db.insert(recurringItems).values({
      name: 'Unifi', direction: 'expense' as any, amount_cents: 15000, cadence: 'monthly' as any,
      day_of_month: 19, category: 'bills', funding_account_id: b, auto_post: true,
      start_date: '2026-06-01', next_due_date: '2026-06-19', is_active: true,
      created_at: now, updated_at: now,
    }).run();

    const r1 = runPostRecurring('2026-06-19');
    const r2 = runPostRecurring('2026-06-19'); // rerun same day
    expect(r1.posted).toBe(1);
    expect(r2.posted).toBe(0); // idempotent

    const rows = db.select().from(transactions).all();
    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe('auto');
    expect(rows[0].amount_cents).toBe(-15000); // expense posts negative
  });

  // ---------------------------------------------------------------------------
  // 1b. Reminder-only (auto_post=false): NOT auto-posted, even when due.
  // The user logs the payment himself; the auto-poster must skip it.
  // ---------------------------------------------------------------------------
  it('does NOT auto-post a reminder-only (auto_post=false) item even when due', () => {
    const b = bank();
    const now = Date.now();
    db.insert(recurringItems).values({
      name: 'Rent (reminder)', direction: 'expense' as any, amount_cents: 120000, cadence: 'monthly' as any,
      day_of_month: 19, category: 'bills', funding_account_id: b, auto_post: false,
      start_date: '2026-06-01', next_due_date: '2026-06-19', is_active: true,
      created_at: now, updated_at: now,
    }).run();

    const r = runPostRecurring('2026-06-19');
    expect(r.posted).toBe(0); // reminder-only is never auto-posted
    expect(db.select().from(transactions).all().length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 2. SPayLater: installments read BY INDEX, not by shifting the array
  // ---------------------------------------------------------------------------
  it('posts SPayLater by index (posted_count) without mutating remaining_installments_json', () => {
    const b = bank();
    const now = Date.now();
    const json = JSON.stringify([151950, 83682, 63165, 57307, 35528, 14651, 14651, 14651]);
    const [tpl] = db.insert(recurringItems).values({
      name: 'ShopeePayLater', direction: 'expense' as any, amount_cents: 0, cadence: 'monthly' as any,
      day_of_month: 10, category: 'debt', funding_account_id: b, auto_post: true,
      start_date: '2026-06-01', next_due_date: '2026-06-10', is_active: true,
      remaining_installments_json: json, remaining_occurrences: 8,
      created_at: now, updated_at: now,
    }).returning().all();

    runPostRecurring('2026-06-10'); // posts index 0

    const t1 = db.select().from(transactions).all();
    expect(t1.length).toBe(1);
    expect(t1[0].amount_cents).toBe(-151950); // first installment

    const item = db.select().from(recurringItems).where(eq(recurringItems.id, tpl.id as number)).get()!;
    // Array is NOT shifted/mutated — still 8 entries; position tracked via posted count.
    expect(JSON.parse(item.remaining_installments_json!).length).toBe(8);

    // Advance to next month; posts index 1 (83682), still idempotent within a day.
    db.update(recurringItems)
      .set({ next_due_date: '2026-07-10' })
      .where(eq(recurringItems.id, tpl.id as number))
      .run();
    runPostRecurring('2026-07-10');

    const t2 = db.select().from(transactions).all().sort((a, c) => a.date.localeCompare(c.date));
    expect(t2.length).toBe(2);
    expect(t2[1].amount_cents).toBe(-83682); // second installment by index
  });

  // ---------------------------------------------------------------------------
  // 2b. SPayLater: manual rows do NOT advance the index / cause skips
  // ---------------------------------------------------------------------------
  it('does NOT skip an installment if a manual source row exists for the same template', () => {
    const b = bank();
    const now = Date.now();
    const json = JSON.stringify([151950, 83682, 63165, 57307]);
    const [tpl] = db.insert(recurringItems).values({
      name: 'ShopeePayLaterWithManual', direction: 'expense' as any, amount_cents: 0, cadence: 'monthly' as any,
      day_of_month: 10, category: 'debt', funding_account_id: b, auto_post: true,
      start_date: '2026-06-01', next_due_date: '2026-06-10', is_active: true,
      remaining_installments_json: json, remaining_occurrences: 4,
      created_at: now, updated_at: now,
    }).returning().all();

    // Manually insert a row for the same template (source='manual')
    db.insert(transactions).values({
      uuid: `manual-1`,
      date: '2026-06-05',
      amount_cents: -10000,
      direction: 'expense' as any,
      category: 'debt',
      account_id: b,
      source: 'manual',
      recurring_item_id: tpl.id,
      created_at: now,
      updated_at: now,
    }).run();

    // Run the task on the first due date
    runPostRecurring('2026-06-10');

    const rows = db.select().from(transactions).all();
    expect(rows.length).toBe(2); // manual + auto

    // The auto-posted row must be index 0 (151950), NOT index 1 (83682)
    const autoRow = rows.find(r => r.source === 'auto');
    expect(autoRow).toBeDefined();
    expect(autoRow!.amount_cents).toBe(-151950); // first installment by index
  });

  // ---------------------------------------------------------------------------
  // 3. Card interest: accrues on statement_day (bt_status none), idempotent
  // ---------------------------------------------------------------------------
  it('accrues card interest on statement_day (bt_status none) to debt + linked card account', () => {
    const now = Date.now();
    const [cardAcct] = db.insert(accounts).values({
      name: 'Credit Card', type: 'card' as any, balance_cents: -740076,
      credit_limit_cents: 798740, created_at: now, updated_at: now,
    }).returning().all();
    const [cardDebt] = db.insert(debts).values({
      name: 'Credit Card', type: 'revolving' as any, balance_cents: 740076,
      rate_type: 'apr' as any, apr_bps: 1800, statement_day: 15, due_day: 5,
      bt_status: 'none' as any, linked_account_id: cardAcct.id,
      created_at: now, updated_at: now,
    }).returning().all();

    const r = runPostRecurring('2026-06-15'); // statement_day
    expect(r.interest).toBe(1); // one interest row posted

    // interest = floor(balance × apr_bps / 120000) = floor(740076 × 1800 / 120000) = floor(11101.14) = 11101
    const intRow = db.select().from(transactions).all().find(t => t.category === 'interest');
    expect(intRow).toBeDefined();
    expect(intRow!.amount_cents).toBe(11101);
    expect(intRow!.source).toBe('auto');

    const debtAfter = db.select().from(debts).where(eq(debts.id, cardDebt.id as number)).get();
    const acctAfter = db.select().from(accounts).where(eq(accounts.id, cardAcct.id as number)).get();
    expect(debtAfter!.balance_cents).toBe(751177);  // grew by interest
    expect(acctAfter!.balance_cents).toBe(-751177); // card account mirrors debt (negative)

    // Rerun same statement day → idempotent, no second interest row.
    const r2 = runPostRecurring('2026-06-15');
    expect(r2.interest).toBe(0);
    const interestRows = db.select().from(transactions).all().filter(t => t.category === 'interest');
    expect(interestRows.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 4. Card interest: NOT accrued when bt_status is 'active'
  // ---------------------------------------------------------------------------
  it('does NOT accrue card interest when bt_status is active', () => {
    const now = Date.now();
    const [cardAcct] = db.insert(accounts).values({
      name: 'Credit Card', type: 'card' as any, balance_cents: -740076,
      credit_limit_cents: 798740, created_at: now, updated_at: now,
    }).returning().all();
    db.insert(debts).values({
      name: 'Credit Card', type: 'revolving' as any, balance_cents: 740076,
      rate_type: 'apr' as any, apr_bps: 1800, statement_day: 15, due_day: 5,
      bt_status: 'active' as any, linked_account_id: cardAcct.id,
      created_at: now, updated_at: now,
    }).run();

    const r = runPostRecurring('2026-06-15');
    expect(r.interest).toBe(0);
    const interestRows = db.select().from(transactions).all().filter(t => t.category === 'interest');
    expect(interestRows.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 5. Month-boundary clamp regression guard: day_of_month=31 in a 30-day month
  // ---------------------------------------------------------------------------
  it('clamps day_of_month to month length when posting (e.g. 31 → 30 in June)', () => {
    const b = bank();
    const now = Date.now();
    db.insert(recurringItems).values({
      name: 'EndOfMonth', direction: 'expense' as any, amount_cents: 5000, cadence: 'monthly' as any,
      day_of_month: 31, category: 'bills', funding_account_id: b, auto_post: true,
      start_date: '2026-06-01', next_due_date: '2026-06-30', is_active: true, // already clamped
      created_at: now, updated_at: now,
    }).run();

    const r = runPostRecurring('2026-06-30');
    expect(r.posted).toBe(1);

    const item = db.select().from(recurringItems).all().find(i => i.name === 'EndOfMonth')!;
    // postTransaction recomputes next_due_date via nextDueDate(date+1, day_of_month=31)
    // → July has 31 days so day 31 is valid
    expect(item.next_due_date).toBe('2026-07-31');
    expect(item.last_posted_date).toBe('2026-06-30');
  });

  // ---------------------------------------------------------------------------
  // 6. Paused template (ILP: auto_post=false / is_active=false) is NOT posted
  // ---------------------------------------------------------------------------
  it('does NOT post a paused template (auto_post=false or is_active=false)', () => {
    const b = bank();
    const now = Date.now();
    db.insert(recurringItems).values({
      name: 'GE ILP', direction: 'expense' as any, amount_cents: 35000, cadence: 'monthly' as any,
      day_of_month: 17, category: 'bills', funding_account_id: b,
      auto_post: false, is_active: false,
      start_date: '2026-06-01', next_due_date: null,
      created_at: now, updated_at: now,
    }).run();

    const r = runPostRecurring('2026-06-17');
    expect(r.posted).toBe(0);
    expect(db.select().from(transactions).all().length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 7. Finite template: deactivated once remaining_occurrences reaches 0
  // ---------------------------------------------------------------------------
  it('deactivates a finite template after its last occurrence is posted', () => {
    const b = bank();
    const now = Date.now();
    db.insert(recurringItems).values({
      name: 'SLoan 2', direction: 'expense' as any, amount_cents: 9083, cadence: 'monthly' as any,
      day_of_month: 7, category: 'debt', funding_account_id: b, auto_post: true,
      start_date: '2026-06-01', next_due_date: '2026-10-07', is_active: true,
      remaining_occurrences: 1,
      created_at: now, updated_at: now,
    }).run();

    const r = runPostRecurring('2026-10-07');
    expect(r.posted).toBe(1);

    const item = db.select().from(recurringItems).all().find(i => i.name === 'SLoan 2')!;
    // After posting, remaining_occurrences = 0 and template should be deactivated.
    expect(item.remaining_occurrences).toBe(0);
    expect(item.is_active).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 8. Catch-up: posts templates overdue by multiple days
  // ---------------------------------------------------------------------------
  it('catch-up posts templates whose next_due_date is earlier than today', () => {
    const b = bank();
    const now = Date.now();
    // Overdue by 3 days — simulates a missed run
    db.insert(recurringItems).values({
      name: 'Overdue Bill', direction: 'expense' as any, amount_cents: 5000, cadence: 'monthly' as any,
      day_of_month: 15, category: 'bills', funding_account_id: b, auto_post: true,
      start_date: '2026-06-01', next_due_date: '2026-06-15', is_active: true,
      created_at: now, updated_at: now,
    }).run();

    // Run on the 18th — the template was due on the 15th; should still post.
    const r = runPostRecurring('2026-06-18');
    expect(r.posted).toBe(1);
    const rows = db.select().from(transactions).all();
    expect(rows.length).toBe(1);
    // Posted on the template's next_due_date, not today.
    expect(rows[0].date).toBe('2026-06-15');
  });

  // ---------------------------------------------------------------------------
  // 9. Income template: posts with positive amount_cents
  // ---------------------------------------------------------------------------
  it('posts an income template with positive amount_cents', () => {
    const b = bank();
    const now = Date.now();
    db.insert(recurringItems).values({
      name: 'Net Salary', direction: 'income' as any, amount_cents: 581950, cadence: 'monthly' as any,
      day_of_month: 3, category: 'income', funding_account_id: b, auto_post: true,
      start_date: '2026-06-01', next_due_date: '2026-06-03', is_active: true,
      created_at: now, updated_at: now,
    }).run();

    const r = runPostRecurring('2026-06-03');
    expect(r.posted).toBe(1);
    const rows = db.select().from(transactions).all();
    expect(rows.length).toBe(1);
    expect(rows[0].amount_cents).toBe(581950); // income is positive
    expect(rows[0].direction).toBe('income');
  });

  // ---------------------------------------------------------------------------
  // 10. Card interest: NOT accrued on a non-statement-day
  // ---------------------------------------------------------------------------
  it('does NOT accrue card interest on a non-statement-day', () => {
    const now = Date.now();
    const [cardAcct] = db.insert(accounts).values({
      name: 'Credit Card', type: 'card' as any, balance_cents: -740076,
      credit_limit_cents: 798740, created_at: now, updated_at: now,
    }).returning().all();
    db.insert(debts).values({
      name: 'Credit Card', type: 'revolving' as any, balance_cents: 740076,
      rate_type: 'apr' as any, apr_bps: 1800, statement_day: 15, due_day: 5,
      bt_status: 'none' as any, linked_account_id: cardAcct.id,
      created_at: now, updated_at: now,
    }).run();

    const r = runPostRecurring('2026-06-16'); // NOT the 15th
    expect(r.interest).toBe(0);
    const interestRows = db.select().from(transactions).all().filter(t => t.category === 'interest');
    expect(interestRows.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 11. next_due_date advanced atomically inside postTransaction
  // ---------------------------------------------------------------------------
  it('advances next_due_date inside the same atomic post transaction', () => {
    const b = bank();
    const now = Date.now();
    db.insert(recurringItems).values({
      name: 'Gym', direction: 'expense' as any, amount_cents: 19900, cadence: 'monthly' as any,
      day_of_month: 1, category: 'bills', funding_account_id: b, auto_post: true,
      start_date: '2026-06-01', next_due_date: '2026-06-01', is_active: true,
      created_at: now, updated_at: now,
    }).run();

    runPostRecurring('2026-06-01');

    const item = db.select().from(recurringItems).all().find(i => i.name === 'Gym')!;
    // next_due_date must have advanced to July 1
    expect(item.next_due_date).toBe('2026-07-01');
    // A second run on the same day must be idempotent (next_due_date now points to July)
    const r2 = runPostRecurring('2026-06-01');
    expect(r2.posted).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 12. Reminder-only: next_due_date rolls forward without writing any transaction
  // ---------------------------------------------------------------------------
  it('reminder-only (auto_post=false): rolls next_due_date forward with 0 transactions posted', () => {
    const b = bank();
    const now = Date.now();
    db.insert(recurringItems).values({
      name: 'Rent (reminder)', direction: 'expense' as any, amount_cents: 120000, cadence: 'monthly' as any,
      day_of_month: 1, category: 'bills', funding_account_id: b, auto_post: false,
      start_date: '2026-06-01', next_due_date: '2026-06-01', is_active: true,
      created_at: now, updated_at: now,
    }).run();

    const r = runPostRecurring('2026-06-19');
    expect(r.posted).toBe(0); // no ledger row written
    expect(db.select().from(transactions).all().length).toBe(0); // really no transaction

    const item = db.select().from(recurringItems).all().find(i => i.name === 'Rent (reminder)')!;
    // next_due_date must now be strictly > '2026-06-19'
    expect(item.next_due_date! > '2026-06-19').toBe(true);
    // Specifically rolls to July 1
    expect(item.next_due_date).toBe('2026-07-01');
    expect(item.last_posted_date).toBe('2026-06-01');
  });

  // ---------------------------------------------------------------------------
  // 12b. Reminder-only: still appears in committedOutflowsBeforeCents after rollover
  // ---------------------------------------------------------------------------
  it('reminder-only item still appears in committedOutflowsBeforeCents after next_due_date rolls forward', () => {
    const b = bank();
    const now = Date.now();
    db.insert(recurringItems).values({
      name: 'Insurance (reminder)', direction: 'expense' as any, amount_cents: 30000, cadence: 'monthly' as any,
      day_of_month: 25, category: 'bills', funding_account_id: b, auto_post: false,
      start_date: '2026-06-01', next_due_date: '2026-06-25', is_active: true,
      created_at: now, updated_at: now,
    }).run();

    // Simulate running postRecurring a week after the due date
    runPostRecurring('2026-07-01');

    // next_due_date should now be '2026-07-25' (> '2026-07-01', < '2026-08-01')
    const item = db.select().from(recurringItems).all().find(i => i.name === 'Insurance (reminder)')!;
    expect(item.next_due_date).toBe('2026-07-25');

    // The item must still gate into committedOutflowsBeforeCents for the new cycle
    const committed = committedOutflowsBeforeCents(db, '2026-07-01', '2026-08-01');
    expect(committed).toBe(30000);
  });

  // ---------------------------------------------------------------------------
  // 12c. Reminder-only rollover is idempotent (second run doesn't double-roll)
  // ---------------------------------------------------------------------------
  it('reminder-only rollover is idempotent on rerun', () => {
    const b = bank();
    const now = Date.now();
    db.insert(recurringItems).values({
      name: 'Broadband (reminder)', direction: 'expense' as any, amount_cents: 15000, cadence: 'monthly' as any,
      day_of_month: 10, category: 'bills', funding_account_id: b, auto_post: false,
      start_date: '2026-06-01', next_due_date: '2026-06-10', is_active: true,
      created_at: now, updated_at: now,
    }).run();

    runPostRecurring('2026-06-19');
    const item1 = db.select().from(recurringItems).all().find(i => i.name === 'Broadband (reminder)')!;
    const due1 = item1.next_due_date;

    // Rerun same day — should not roll again since next_due_date > today
    runPostRecurring('2026-06-19');
    const item2 = db.select().from(recurringItems).all().find(i => i.name === 'Broadband (reminder)')!;
    expect(item2.next_due_date).toBe(due1); // unchanged
  });

  // ---------------------------------------------------------------------------
  // 12d. auto_post=true behavior is unchanged after adding the reminder-only pass
  // ---------------------------------------------------------------------------
  it('auto_post=true item still posts a transaction and advances next_due_date', () => {
    const b = bank();
    const now = Date.now();
    db.insert(recurringItems).values({
      name: 'Unifi Auto', direction: 'expense' as any, amount_cents: 15000, cadence: 'monthly' as any,
      day_of_month: 5, category: 'bills', funding_account_id: b, auto_post: true,
      start_date: '2026-06-01', next_due_date: '2026-06-05', is_active: true,
      created_at: now, updated_at: now,
    }).run();

    const r = runPostRecurring('2026-06-05');
    expect(r.posted).toBe(1);
    expect(db.select().from(transactions).all().length).toBe(1);

    const item = db.select().from(recurringItems).all().find(i => i.name === 'Unifi Auto')!;
    expect(item.next_due_date).toBe('2026-07-05');
  });
});

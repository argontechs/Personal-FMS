// server/db/seed.ts
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { createDb } from './index'
import { runMigrations } from './migrate'
import { accounts, debts, recurringItems, goals } from './schema'
import { nowEpoch, nextDueDate } from '../utils/mytDate'
import { postTransaction } from '../utils/post'

const SEED_TODAY = '2026-06-18'

type Db = BetterSQLite3Database<Record<string, unknown>>

export function seedDatabase(db: Db): void {
  // Idempotent: bail if already seeded.
  if (db.select().from(accounts).all().length > 0) return

  const ts = nowEpoch()
  const base = { created_at: ts, updated_at: ts }

  // -------------------------------------------------------------------------
  // Accounts (7): Main Bank, Cash, UOB One, TnG eWallet, Public Bank, Credit Card, EF savings
  // All accounts start at balance_cents = 0; opening balances are posted below
  // via postTransaction so that recomputeBalances() is non-destructive.
  // -------------------------------------------------------------------------
  const bankId = db.insert(accounts).values({
    name: 'Main Bank',
    type: 'bank',
    balance_cents: 0,
    sort_order: 0,
    ...base,
  }).returning({ id: accounts.id }).get().id

  const cardAcctId = db.insert(accounts).values({
    name: 'Credit Card',
    type: 'card',
    // Card account balance is stored as NEGATIVE (outstanding debt).
    // Convention: card.balance = -(SUM primary ledger rows).
    // Opening row below posts amount_cents=740076 so recomputeBalances → -740076.
    balance_cents: 0,
    // Real limit: avail 58664 + balance 740076 = 798740 sen
    credit_limit_cents: 798740,
    // available_credit_cents is DERIVED at read time (limit − |balance|); never seeded
    available_credit_cents: null,
    sort_order: 1,
    ...base,
  }).returning({ id: accounts.id }).get().id

  const tngId = db.insert(accounts).values({
    name: 'TnG eWallet',
    type: 'ewallet',
    balance_cents: 0,
    sort_order: 2,
    ...base,
  }).returning({ id: accounts.id }).get().id

  const efId = db.insert(accounts).values({
    name: 'Emergency Fund (RYT)',
    type: 'savings',
    balance_cents: 0, // Opens at RM0 — ledger entries fund it later (no opening row needed)
    sort_order: 3,
    ...base,
  }).returning({ id: accounts.id }).get().id

  const cashId = db.insert(accounts).values({
    name: 'Cash',
    type: 'cash',
    balance_cents: 0,
    sort_order: 4,
    ...base,
  }).returning({ id: accounts.id }).get().id

  const uobId = db.insert(accounts).values({
    name: 'UOB One',
    type: 'bank',
    balance_cents: 0,
    sort_order: 5,
    ...base,
  }).returning({ id: accounts.id }).get().id

  const publicBankId = db.insert(accounts).values({
    name: 'Public Bank',
    type: 'bank',
    balance_cents: 0, // Opens at RM0 — salary lands here; no opening row needed
    sort_order: 6,
    ...base,
  }).returning({ id: accounts.id }).get().id

  // -------------------------------------------------------------------------
  // Debts (7): card, car, PTPTN, SLoan1, SLoan2, ShopeePayLater, Ryt PayLater
  // All debts start at balance_cents = 0; opening balances are posted below
  // via postTransaction so that recomputeBalances() is non-destructive.
  // -------------------------------------------------------------------------

  // 1. Credit Card (revolving) — priority 1, payoff baseline frozen to opening balance
  const cardDebtId = db.insert(debts).values({
    name: 'Credit Card',
    type: 'revolving',
    balance_cents: 0,
    original_principal_cents: 740076,
    payoff_baseline_cents: 740076, // frozen at goal creation (§14.3); matches opening balance
    rate_type: 'apr',
    apr_bps: 1800, // 18% p.a.
    min_payment_cents: 37004, // max(5% of 740076, RM50) = 37004
    statement_day: 15,
    due_day: 5,
    priority_rank: 1,
    linked_account_id: cardAcctId,
    ...base,
  }).returning({ id: debts.id }).get().id

  // Back-link card account → card debt (E1: real eq, not placeholder)
  db.update(accounts).set({ debt_id: cardDebtId }).where(eq(accounts.id, cardAcctId)).run()

  // 2. Car Loan (flat rate, never prepay)
  const carDebtId = db.insert(debts).values({
    name: 'Car Loan',
    type: 'flat_loan',
    balance_cents: 0,
    rate_type: 'flat',
    flat_rate_bps: 244, // 2.44% flat
    scheduled_payment_cents: 90400, // RM904.00/mo
    due_day: 22,
    never_prepay: true,
    ...base,
  }).returning({ id: debts.id }).get().id

  // 3. PTPTN (reducing loan, never prepay)
  const ptptnDebtId = db.insert(debts).values({
    name: 'PTPTN',
    type: 'reducing_loan',
    balance_cents: 0,
    rate_type: 'apr',
    apr_bps: 100, // 1% p.a.
    scheduled_payment_cents: 27000, // RM270.00/mo
    due_day: 1,
    never_prepay: true,
    ...base,
  }).returning({ id: debts.id }).get().id

  // 4. SLoan 1 (installment, 8 remaining @ RM177.43/mo, due day 12)
  const sloan1DebtId = db.insert(debts).values({
    name: 'SLoan 1',
    type: 'installment',
    balance_cents: 0,
    rate_type: 'none',
    scheduled_payment_cents: 17743,
    due_day: 12,
    payments_total: 8,
    ...base,
  }).returning({ id: debts.id }).get().id

  // 5. SLoan 2 (installment, 3 remaining @ RM90.83/mo, due day 7)
  const sloan2DebtId = db.insert(debts).values({
    name: 'SLoan 2',
    type: 'installment',
    balance_cents: 0,
    rate_type: 'none',
    scheduled_payment_cents: 9083,
    due_day: 7,
    payments_total: 3,
    ...base,
  }).returning({ id: debts.id }).get().id

  // 6. ShopeePayLater (declining installments, total 435585 sen)
  const spDebtId = db.insert(debts).values({
    name: 'ShopeePayLater',
    type: 'installment',
    balance_cents: 0,
    rate_type: 'none',
    due_day: 10,
    remaining_installments_json: JSON.stringify(
      [151950, 83682, 63165, 57307, 35528, 14651, 14651, 14651],
    ),
    ...base,
  }).returning({ id: debts.id }).get().id

  // 7. Ryt PayLater (installment, 4 remaining @ RM214.15/mo, due day 22)
  const rytDebtId = db.insert(debts).values({
    name: 'Ryt PayLater',
    type: 'installment',
    balance_cents: 0,
    rate_type: 'none',
    scheduled_payment_cents: 21415,
    due_day: 22,
    payments_total: 4,
    ...base,
  }).returning({ id: debts.id }).get().id

  // -------------------------------------------------------------------------
  // Opening-balance ledger rows
  // Posted via postTransaction(input, db) so that recomputeBalances() derives
  // the correct balances from the ledger and a subsequent PATCH/DELETE never
  // wipes real balances.
  //
  // Card account convention: balance is stored as NEGATIVE outstanding debt.
  //   recomputeBalances: card.balance = -(SUM primary amount_cents)
  //   → posting amount_cents=740076 gives recomputed card balance = -740076 ✓
  //   The same row also sets card debt balance: debt.balance += 740076 ✓
  //
  // Debt-only rows (debts with no linked cash account): account_id = null.
  //   recomputeBalances skips the account leg for NULL account_id rows.
  // -------------------------------------------------------------------------

  // --- Account opening balances ---
  // Main Bank: non-card → bank.balance += 75000 = 75000 ✓
  postTransaction({ uuid: 'ob-bank', date: SEED_TODAY, amount_cents: 75000, direction: 'income', category: 'adjustment', account_id: bankId, source: 'adjustment', note: 'Opening balance' }, db)

  // TnG eWallet: non-card → tng.balance += 6995 = 6995 ✓
  postTransaction({ uuid: 'ob-tng', date: SEED_TODAY, amount_cents: 6995, direction: 'income', category: 'adjustment', account_id: tngId, source: 'adjustment', note: 'Opening balance' }, db)

  // EF: opens at 0 — no row needed (ledger entries fund it later)

  // Cash: non-card → cash.balance += 27200 = 27200 ✓
  postTransaction({ uuid: 'ob-cash', date: SEED_TODAY, amount_cents: 27200, direction: 'income', category: 'adjustment', account_id: cashId, source: 'adjustment', note: 'Opening balance' }, db)

  // UOB One: non-card → uob.balance += 280 = 280 ✓
  postTransaction({ uuid: 'ob-uob', date: SEED_TODAY, amount_cents: 280, direction: 'income', category: 'adjustment', account_id: uobId, source: 'adjustment', note: 'Opening balance' }, db)

  // Public Bank: opens at 0 — no opening row needed

  // --- Card account + debt opening balance (single row covers both) ---
  // Card account (type='card'): post.ts applies acctDelta = -amount_cents
  //   → card.balance += -740076 = -740076 ✓
  // Card debt: debt.balance += 740076 = 740076 ✓
  postTransaction({ uuid: 'ob-card', date: SEED_TODAY, amount_cents: 740076, direction: 'expense', category: 'adjustment', account_id: cardAcctId, debt_id: cardDebtId, source: 'adjustment', note: 'Opening balance' }, db)

  // --- Debt-only opening balances (account_id = null, no cash-account leg) ---
  postTransaction({ uuid: 'ob-car',   date: SEED_TODAY, amount_cents: 7348467, direction: 'expense', category: 'adjustment', account_id: null, debt_id: carDebtId,    source: 'adjustment', note: 'Opening balance' }, db)
  postTransaction({ uuid: 'ob-ptptn', date: SEED_TODAY, amount_cents: 3284362, direction: 'expense', category: 'adjustment', account_id: null, debt_id: ptptnDebtId,  source: 'adjustment', note: 'Opening balance' }, db)
  postTransaction({ uuid: 'ob-sl1',   date: SEED_TODAY, amount_cents: 141944,  direction: 'expense', category: 'adjustment', account_id: null, debt_id: sloan1DebtId, source: 'adjustment', note: 'Opening balance' }, db)
  postTransaction({ uuid: 'ob-sl2',   date: SEED_TODAY, amount_cents: 27249,   direction: 'expense', category: 'adjustment', account_id: null, debt_id: sloan2DebtId, source: 'adjustment', note: 'Opening balance' }, db)
  postTransaction({ uuid: 'ob-sp',    date: SEED_TODAY, amount_cents: 435585,  direction: 'expense', category: 'adjustment', account_id: null, debt_id: spDebtId,     source: 'adjustment', note: 'Opening balance' }, db)
  postTransaction({ uuid: 'ob-ryt',   date: SEED_TODAY, amount_cents: 85660,   direction: 'expense', category: 'adjustment', account_id: null, debt_id: rytDebtId,    source: 'adjustment', note: 'Opening balance' }, db)

  // -------------------------------------------------------------------------
  // Recurring templates (17): 3 income + 7 expenses (card) + 7 debt payments
  // B3: SPayLater template included → 17 total
  // -------------------------------------------------------------------------

  type Tpl = {
    name: string
    direction: 'income' | 'expense'
    amount_cents: number
    day: number
    category: string
    funding: number | null
    debt_id?: number | null
    is_variable?: boolean
    auto_post?: boolean
    is_active?: boolean
    remaining?: number | null
    end_date?: string | null
    remaining_installments_json?: string | null
  }

  const tpls: Tpl[] = [
    // --- Income (3) ---
    {
      name: 'Net Salary',
      direction: 'income',
      amount_cents: 581950, // RM5,819.50
      day: 3,
      category: 'income',
      funding: publicBankId, // Salary lands in Public Bank (not Main Bank)
    },
    {
      name: 'Side Income A',
      direction: 'income',
      amount_cents: 60000, // RM600.00
      day: 1,
      category: 'income',
      funding: bankId,
    },
    {
      name: 'Side Income B',
      direction: 'income',
      amount_cents: 60000, // RM600.00
      day: 23,
      category: 'income',
      funding: bankId,
    },

    // --- Expenses funded by CARD (6, with ILP paused) ---
    {
      name: 'Digi',
      direction: 'expense',
      amount_cents: 37860, // RM378.60
      day: 16,
      category: 'bills',
      funding: cardAcctId,
      is_variable: true,
    },
    {
      name: 'Electricity',
      direction: 'expense',
      amount_cents: 15000, // RM150.00
      day: 16,
      category: 'bills',
      funding: bankId, // funded by bank, not card
      is_variable: true,
    },
    {
      name: 'Unifi',
      direction: 'expense',
      amount_cents: 15000, // RM150.00
      day: 19,
      category: 'bills',
      funding: cardAcctId,
    },
    {
      name: 'Insurance (GE CI)',
      direction: 'expense',
      amount_cents: 35000, // RM350.00
      day: 27,
      category: 'bills',
      funding: cardAcctId,
    },
    {
      name: 'GE ILP',
      direction: 'expense',
      amount_cents: 35000, // RM350.00
      day: 17,
      category: 'bills',
      funding: cardAcctId, // card (PAUSED — not bank-flipped; ILP is_active:false)
      auto_post: false,
      is_active: false,
    },
    {
      name: 'Gym',
      direction: 'expense',
      amount_cents: 19900, // RM199.00
      day: 1,
      category: 'bills',
      funding: cardAcctId,
    },
    {
      name: 'Subscriptions',
      direction: 'expense',
      amount_cents: 8200, // RM82.00
      day: 5,
      category: 'bills',
      funding: cardAcctId,
    },

    // --- Debt payments funded by BANK (7) ---
    {
      name: 'Car Loan',
      direction: 'expense',
      amount_cents: 90400, // RM904.00
      day: 22,
      category: 'debt',
      funding: bankId,
      debt_id: carDebtId,
    },
    {
      name: 'PTPTN',
      direction: 'expense',
      amount_cents: 27000, // RM270.00
      day: 1,
      category: 'debt',
      funding: bankId,
      debt_id: ptptnDebtId,
    },
    {
      name: 'SLoan 1',
      direction: 'expense',
      amount_cents: 17743, // RM177.43
      day: 12,
      category: 'debt',
      funding: bankId,
      debt_id: sloan1DebtId,
      remaining: 8,
      end_date: '2027-03-12',
    },
    {
      name: 'SLoan 2',
      direction: 'expense',
      amount_cents: 9083, // RM90.83
      day: 7,
      category: 'debt',
      funding: bankId,
      debt_id: sloan2DebtId,
      remaining: 3,
      end_date: '2026-10-07',
    },
    // B3: SPayLater recurring template (funding = bank, amount = first installment)
    {
      name: 'ShopeePayLater',
      direction: 'expense',
      amount_cents: 151950, // first installment (remaining array drives declining amounts)
      day: 10,
      category: 'debt',
      funding: bankId,
      debt_id: spDebtId,
      remaining_installments_json: JSON.stringify(
        [151950, 83682, 63165, 57307, 35528, 14651, 14651, 14651],
      ),
      remaining: 8,
      end_date: '2027-04-10',
    },
    {
      name: 'Ryt PayLater',
      direction: 'expense',
      amount_cents: 21415, // RM214.15
      day: 22,
      category: 'debt',
      funding: bankId,
      debt_id: rytDebtId,
      remaining: 4,
      end_date: '2026-10-22',
    },
    {
      name: 'Credit Card payment',
      direction: 'expense',
      amount_cents: 37004, // min payment (5% of 740076)
      day: 5,
      category: 'debt',
      funding: bankId,
      debt_id: cardDebtId,
    },
  ]

  for (const t of tpls) {
    const active = t.is_active ?? true
    db.insert(recurringItems).values({
      name: t.name,
      direction: t.direction,
      amount_cents: t.amount_cents,
      is_variable: t.is_variable ?? false,
      cadence: 'monthly',
      day_of_month: t.day,
      category: t.category,
      funding_account_id: t.funding,
      debt_id: t.debt_id ?? null,
      auto_post: t.auto_post ?? true,
      is_active: active,
      start_date: SEED_TODAY,
      end_date: t.end_date ?? null,
      remaining_occurrences: t.remaining ?? null,
      remaining_installments_json: t.remaining_installments_json ?? null,
      // Single when-due field: computed via canonical nextDueDate helper
      next_due_date: active ? nextDueDate(SEED_TODAY, t.day) : null,
      ...base,
    }).run()
  }

  // -------------------------------------------------------------------------
  // Goals (2): Emergency Fund (RM1,000 starter) + Kill Credit Card
  // -------------------------------------------------------------------------

  // EF goal: RM1,000 starter target (migrates to RM15,000 once funded — Phase 1 seeds 100000 only)
  db.insert(goals).values({
    name: 'Emergency Fund',
    type: 'savings',
    target_amount_cents: 100000, // RM1,000 starter; NOT 1,500,000 yet
    account_id: efId,
    monthly_contribution_cents: 50000, // RM500/mo buffer
    status: 'active',
    ...base,
  }).run()

  // Kill Credit Card goal: target = payoff_baseline = opening card balance
  db.insert(goals).values({
    name: 'Kill Credit Card',
    type: 'debt_payoff',
    target_amount_cents: 740076, // matches payoff_baseline_cents on card debt
    debt_id: cardDebtId,
    status: 'active',
    ...base,
  }).run()
}

// ---------------------------------------------------------------------------
// CLI entry: migrate then seed the real DATABASE_URL DB.
// Usage: npm run db:seed
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  const path = (process.env.DATABASE_URL ?? 'file:./data/money.sqlite').replace(/^file:/, '')
  const handle = createDb(path)
  runMigrations(handle.sqlite)
  seedDatabase(handle.db)
  handle.sqlite.close()
  console.log('Seed complete:', path)
}

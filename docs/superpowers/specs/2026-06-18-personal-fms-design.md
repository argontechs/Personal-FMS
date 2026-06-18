# Personal Financial Management PWA — Design Specification

> Single-user financial-habit app for a Malaysian salaried professional. North star: **build a money habit and a real emergency fund.** Self-hosted PWA at `money.argontechs.dev`.
> Status: project spec, v1.0 (2026-06-18).

---

## 1. Overview & Goal

### The user and the problem

A Malaysian salaried professional, net salary **RM5,819.50/mo**, plus two side incomes of **RM600** (on the 1st and the 23rd) = **RM7,019.50/mo** total. He is **cash-flow positive** (~RM620/mo *available to deploy* even in the tightest month, July, after carrying the card — Jul–Oct carry a RM214/mo Ryt PayLater installment — rising to ~RM2,410/mo by month ~6 once the card is dead; pausing the ILP adds RM350 on top) but has **RM0 savings** — the surplus leaks because nothing forces a transfer and nothing rewards it.

The single behavioral goal is to convert that leaking surplus into (1) a visible logging habit, (2) one honest "safe-to-spend" number, (3) money actually moving to an emergency fund on payday, and (4) the 18% credit card visibly shrinking.

### The three insights the system exists to surface

1. **He is positive but leaking.** Surplus exists; it just never lands in savings. The whole app is a mechanism to catch it.
2. **Funding an ILP while carrying 18% card debt and RM0 buffer is backwards.** RM350/mo into the Great Eastern investment-linked plan (assume ~5% gross, often net-negative in early years after allocation/surrender charges) while revolving at 18% is a guaranteed-losing trade. Killing the card is a **guaranteed, risk-free, tax-free 18% return** — the genuinely strong argument.
3. **The 18% card is the priority kill target** — it is the only debt where extra ringgit move the needle.

A rejected idea, recorded so the system never re-proposes it: the ShopeePayLater **cash-out** (borrowing ~RM1,700 at ~25–28% effective to repay 18% card debt) is strictly worse on every axis.

### What v1 must do (and nothing more)

Open the app, see one safe-to-spend number, log a coffee in two taps, get nudged on payday to move money to the emergency fund, and watch the card balance fall. Everything else is layered later (Section 10).

---

## 2. Architecture

### Recommended stack

A **single Nuxt 4 app** — Vue 3 SPA + service worker on the client, Nitro server routes (`server/api/`) on the server — persisting to **SQLite via Drizzle**, served by **PM2 (fork mode, 1 instance) behind CloudPanel's nginx + Let's Encrypt** at `money.argontechs.dev`. The habit scheduler runs **in-process inside the same Nitro app** (see Section 8) and sends Web Push to the installed PWA.

This is the intersection of two systems the user has already shipped to production: **PWA-PropertyAgentCRM** (Nuxt 4 + Drizzle + PWA on CloudPanel + PM2) and **eInvoicing-LHDN** (Nuxt 4 + SQLite + Drizzle). One language end-to-end (TS in Vue, Nitro, and the Drizzle schema), one repo, one deploy. Time-to-MVP is the binding constraint for a habit tool — an unfinished finance app helps nobody — so reusing a known-good path is the fastest route to value.

### Alternatives considered (one line each)

- **Native Mac / Tauri desktop** — loses: a finance habit lives on the phone in the moment of spending, Tauri mobile is immature, and it's a new-stack tax.
- **Managed serverless (Vercel/Cloudflare + hosted DB)** — loses: one user needs no scale, and serverless actively fights the always-on scheduler + Web Push subscription store the habit engine requires.

### SQLite vs MySQL — decision: **SQLite** (`better-sqlite3` via Drizzle)

This diverges from the most recent precedent (PropertyCRM uses MySQL) and aligns with eInvoicing. For a **single-user** app on the user's **own VPS**:

- **Backups are one file.** The entire financial history is `money.sqlite`. (Backed up via `sqlite3 .backup`, never `cp` — see Section 9.)
- **No second daemon** to patch, secure, or crash independently — one less network surface on a box holding finances.
- **More than fast enough** — one writer, a few thousand transactions a year, WAL-mode microsecond reads. Concurrency, the usual reason to pick MySQL, is a non-issue.
- **Drizzle keeps it portable** — if multi-user ever happens, it's a `drizzle-kit` dialect swap.

Mandatory pragmas: **WAL mode**, `foreign_keys=ON`. Money stored as **integer sen** (RM × 100), never floats. Timestamps as **UTC epoch integers**; business dates (due-day anchors, period keys) as **MYT calendar date strings** (`YYYY-MM-DD`) — see the timezone discipline in Section 8.

### Project structure

```
money/
├─ app/                          # Nuxt 4 client
│  ├─ components/  quicklog/  forecast/  debt/  budgets/  habit/
│  ├─ composables/  useOfflineQueue.ts  useSafeToSpend.ts  usePush.ts
│  ├─ pages/  index.vue (dashboard)  forecast.vue  debt.vue  expenses.vue  settings.vue
│  └─ stores/                    # Pinia (UI state)
├─ server/
│  ├─ api/
│  │  ├─ transactions/           # POST (upsert by uuid), GET, PATCH, DELETE
│  │  ├─ recurring/              # CRUD recurring templates
│  │  ├─ forecast.get.ts  debt.get.ts
│  │  ├─ goals/                  # EF + payoff goal progress
│  │  ├─ push/subscribe.post.ts  # gated by requireSession()
│  │  └─ auth/                   # register (token-gated), login, session
│  ├─ db/  schema.ts (THE model)  index.ts (drizzle + WAL)  migrations/  seed.ts
│  ├─ tasks/                     # Nitro scheduledTasks (in-process)
│  │  ├─ notify-dispatch.ts      # bill reminders + payday prompts
│  │  ├─ post-recurring.ts       # auto-post salary/bills/loans + card interest accrual
│  │  ├─ streak-rollover.ts      # phase 2
│  │  └─ checkin-weekly.ts       # phase 2
│  ├─ utils/  requireSession.ts  money.ts  mytDate.ts (single MYT helper)
│  └─ plugins/  webpush.ts (VAPID init)
├─ shared/types.ts
├─ drizzle.config.ts
├─ ecosystem.config.cjs          # PM2 — ONE app only
└─ nuxt.config.ts                # @vite-pwa/nuxt (injectManifest) + experimental.tasks
```

### One data model, four views

Everything is **one immutable-ish ledger of `transactions`** plus dimension tables that classify and project them. The four product views are all just reads/aggregations of the same rows — no view owns its own store. `schema.ts` is the **single source of truth**; the forecast and habit logic reference its field names directly (the divergent shapes that appeared across subsystem drafts are reconciled here). Money mutation is atomic: **every post wraps `insert transaction` + balance updates + debt update + schedule mark + occurrence decrement in one `better-sqlite3` transaction**, and account balances are treated as a derived cache re-anchored from the ledger (see Section 6, reconciliation).

---

## 3. Data Model

SQLite + Drizzle. Money in **integer sen**; income/credit positive, spend/debit negative on `transactions`. UTC epoch for `created_at/updated_at`; MYT `YYYY-MM-DD` strings for business dates. Single-user, so no `user_id`.

> **Scope note (per review):** the schema below is the **full** vision. **v1 ships ~8 of these tables** (`users`, `accounts`, `transactions`, `recurring_items`, `debts`, `goals`, `push_subscriptions`, `notifications_sent`). `categories` is a flat string enum on `transactions` in v1; `debt_schedule`, `budgets`, `habit_streaks`, `habit_events`, `milestones` are **deferred** to phase 2/3 (Section 10). They are specified here so the migration path is known, not so they're built first.

### v1 core tables

#### `accounts` — where money sits (including the internal Emergency Fund)

```ts
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),                          // "Bank Current", "Credit Card", "Emergency Fund (RYT)"
  type: text('type', { enum: ['cash','bank','card','ewallet','savings'] }).notNull(),
  balance_cents: integer('balance_cents').notNull().default(0),   // derived cache; re-anchored from ledger
  credit_limit_cents: integer('credit_limit_cents'),     // card only — 800000
  available_credit_cents: integer('available_credit_cents'),      // card only — limit − balance; HARD constraint (§4)
  debt_id: integer('debt_id').references(() => debts.id),// card account ↔ card debt
  currency: text('currency').notNull().default('MYR'),
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});
```

Seed: the bank/current account (salary lands here), the **Credit Card** (`type:'card'`, `credit_limit_cents: 800000`, `debt_id` → card debt), a **TNG e-wallet** (`type:'ewallet'`), and — **critical, this was the hole in the north-star feature** — an internal **Emergency Fund** account (`type:'savings'`). The EF is a real account so the payday-prompt's "Transfer logged" action writes an actual transfer transaction (cash → EF) instead of incrementing a hand-maintained counter. The user mirrors the move into his **RYT Bank "Emergency Fund" Save Pocket** manually (PIDM-insured, instant, ~3% — see §11.1); the app tracks intent-as-recorded, and all EF progress/milestones derive from that one ledger row.

The **credit card is modelled twice on purpose**: an `accounts` row (so card-charged spend posts against it, utilisation and the **hard available-credit ceiling** are visible) and a `debts` row (so APR, minimum, and payoff math live with the other debts), linked by `accounts.debt_id`.

#### `debts` — the payoff planner's domain

```ts
export const debts = sqliteTable('debts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['revolving','installment','flat_loan','reducing_loan'] }).notNull(),
  balance_cents: integer('balance_cents').notNull(),
  original_principal_cents: integer('original_principal_cents'),
  rate_type: text('rate_type', { enum: ['apr','flat','none'] }).notNull(),
  apr_bps: integer('apr_bps'),                           // 18% = 1800
  flat_rate_bps: integer('flat_rate_bps'),
  min_payment_cents: integer('min_payment_cents'),       // revolving: max(5% balance, RM50)
  scheduled_payment_cents: integer('scheduled_payment_cents'),
  due_day: integer('due_day'),
  statement_day: integer('statement_day'),               // revolving: interest accrual anchor
  payments_made: integer('payments_made').notNull().default(0),
  payments_total: integer('payments_total'),
  // SPayLater's declining schedule: v1 stores the remaining-amounts array inline (no debt_schedule join).
  remaining_installments_json: text('remaining_installments_json'),  // "[151950,83682,...]"
  priority_rank: integer('priority_rank'),               // card = 1
  never_prepay: integer('never_prepay', { mode: 'boolean' }).notNull().default(false),  // PTPTN
  // 0% balance-transfer state (see §5 — the reconciled kill-the-card plan):
  bt_status: text('bt_status', { enum: ['none','applied','active','declined'] }).notNull().default('none'),
  bt_promo_end_date: text('bt_promo_end_date'),          // MYT date the 0% window closes
  linked_account_id: integer('linked_account_id').references(() => accounts.id),
  is_closed: integer('is_closed', { mode: 'boolean' }).notNull().default(false),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});
```

How the six debts map:

| Debt | type | rate | payment | schedule |
|---|---|---|---|---|
| Credit card **RM7,400.76** (avail RM586.64) | `revolving` | `apr_bps:1800` | `min_payment_cents` = max(5%, RM50) | limit ~RM8,000; `statement_day:15`, `due_day:5` (4–5th); interest accrues on statement_day; `priority_rank:1`. If BT approved → 0% installment (§5) |
| ShopeePayLater | `installment` | `none` | per-installment, `due_day:10` | `remaining_installments_json:[151950,83682,63165,57307,35528,14651,14651,14651]` |
| Ryt PayLater | `installment` | `none` | `21415`/mo, `due_day:22` (19–24) | Jul–Oct 2026, `remaining_occurrences:4` (~RM857 total) |
| Car loan | `flat_loan` | `flat_rate_bps:244` (2.44% flat ≈ ~4.5% EIR) | `scheduled_payment_cents:90400`, `due_day:22` | balance **RM73,484.67**; 9-yr tenure from Jul 2025 (108 mo, ~11 paid); never prepay |
| PTPTN | `reducing_loan` | `apr_bps:100` | balance **RM32,843.62**; `27000`, `due_day:1` | `never_prepay:true` |
| SLoan 1 | `installment` | ~24% EIR (RM1,900→RM2,129, precomputed) | `17743`, `due_day:12` | `remaining_occurrences:8`, ends Mar 2027 (last RM177.41) |
| SLoan 2 | `installment` | ~31% EIR (RM500→RM545, precomputed) | `9083`, `due_day:7` | `remaining_occurrences:3`, ends Oct 2026 (last RM90.84) |

#### `recurring_items` — auto-posting income & expense templates (the single canonical shape)

```ts
export const recurringItems = sqliteTable('recurring_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  direction: text('direction', { enum: ['income','expense'] }).notNull(),
  amount_cents: integer('amount_cents').notNull(),
  is_variable: integer('is_variable', { mode: 'boolean' }).notNull().default(false),  // electricity estimate
  cadence: text('cadence', { enum: ['monthly','weekly','biweekly','yearly'] }).notNull().default('monthly'),
  day_of_month: integer('day_of_month'),                 // clamped to month length on post
  weekday: integer('weekday'),
  category: text('category').notNull(),                  // v1: string enum, NOT a categories table FK
  funding_account_id: integer('funding_account_id').references(() => accounts.id),  // bank | card | ewallet
  debt_id: integer('debt_id').references(() => debts.id),// set when this is a debt payment
  auto_post: integer('auto_post', { mode: 'boolean' }).notNull().default(true),
  start_date: text('start_date').notNull(),
  end_date: text('end_date'),
  remaining_occurrences: integer('remaining_occurrences'),  // SLoan1=8, SLoan2=3; decremented on post
  last_posted_date: text('last_posted_date'),            // idempotency guard
  next_due_date: text('next_due_date'),                  // precomputed (MYT) for scheduler & forecast
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});
```

> **Funding is modelled via the account, not a duplicate `'cash'|'card'` enum.** A template's `funding_account_id` points at the bank, card, or e-wallet account; whether it "hits cash or card" falls out of that account's `type`. This is the reconciliation of the three divergent recurring shapes that appeared in the drafts.

**Seeded templates** (one-time seed script for this user — see onboarding, Section 10):

| Template | dir | amount (sen) | day | funding (current) | notes |
|---|---|---|---|---|---|
| Net Salary | income | 581950 | 3 | bank | lands 1st–3rd; seeded at the 3rd (conservative) |
| Side Income A | income | 60000 | 1 | bank | clusters with salary + PTPTN + gym + ILP on the 1st |
| Side Income B | income | 60000 | 23 | bank | |
| Digi | expense | 37860 | 16 | **card** (auto-deduct post-statement) | `is_variable:true` (RM378.60 this cycle); flip off card under kill-plan |
| Electricity | expense | 15000 | 16 | **bank** (direct) | `is_variable:true`, off-card |
| Unifi | expense | 15000 | 19 | **card** | flip off card under kill-plan |
| Insurance (GE critical-illness) | expense | 35000 | 27 | **card** | real protection — keep; flip funding to bank |
| GE ILP (Great Wealth Enhancer) | expense | 35000 | 17 | **card (••0509)** | 10-yr term to 2036; **pause/holiday (§11)** |
| Gym | expense | 19900 | 1 | **card** (auto) | flip off card under kill-plan |
| Subscriptions | expense | 8200 | 5 | **card** | Netflix 50 + Spotify 20 + YouTube 12 = RM82 |
| Car Loan | expense | 90400 | 22 | bank, `debt_id`→car | never prepay |
| PTPTN | expense | 27000 | 1 | bank, `debt_id`→PTPTN | never prepay |
| SLoan 1 | expense | 17743 | 12 | bank, `debt_id`→SLoan1 | `remaining_occurrences:8`, ends Mar 2027 (last 17741) |
| SLoan 2 | expense | 9083 | 7 | bank, `debt_id`→SLoan2 | `remaining_occurrences:3`, ends Oct 2026 (last 9084) |
| Ryt PayLater | expense | 21415 | 22 | bank, `debt_id`→RytPayLater | `remaining_occurrences:4` (Jul–Oct 2026; due 19–24) |
| Credit Card payment | expense | strategy-derived | 5 | bank, `debt_id`→card | due ~4–5th, statement 15th; min + surplus (or BT installment) |

> **Critical data-model behaviour (review HIGH):** under the kill-the-card plan, **card-funded living templates flip their `funding_account_id` to the bank/eWallet account.** Food/transport/Digi/etc. stop re-polluting the card the app is trying to kill. Whether or not the BT is approved, "stop charging daily life to the card while it carries a balance" must be reflected in data, not just advice. **Exception: the GE ILP template is *paused*** (`is_active`/`auto_post` = false) — it stops auto-charging entirely, it is **not** flipped to bank funding (§11.3).

SPayLater is **not** a flat template — its next installment is read from `remaining_installments_json[0]` and the array is shifted on post.

#### `transactions` — the ledger every view aggregates

```ts
export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uuid: text('uuid').notNull().unique(),                 // client-generated; offline idempotency key
  date: text('date').notNull(),                          // MYT YYYY-MM-DD
  amount_cents: integer('amount_cents').notNull(),       // + income / − expense
  direction: text('direction', { enum: ['income','expense','transfer'] }).notNull(),
  category: text('category').notNull(),                  // v1 string enum: food|transport|bills|debt|income|savings|interest|adjustment
  account_id: integer('account_id').notNull().references(() => accounts.id),
  counter_account_id: integer('counter_account_id').references(() => accounts.id),  // transfer/EF-fund other leg
  debt_id: integer('debt_id').references(() => debts.id),
  goal_id: integer('goal_id').references(() => goals.id),
  note: text('note'),
  source: text('source', { enum: ['auto','manual','adjustment'] }).notNull(),
  recurring_item_id: integer('recurring_item_id').references(() => recurringItems.id),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  uniqRecurring: unique().on(t.recurring_item_id, t.date),  // backstops auto-post double-fire
}));
```

> **Mutability decision (review LOW):** transactions are **mutable** in v1 — the user can edit or delete a mis-logged entry directly (lowest friction, matches expectations). The "immutable ledger / append-only" framing is dropped for v1. Corrections-via-adjusting-rows returns only if full reconciliation is ever built (phase 3). The one exception that *does* post an adjusting row is the card interest accrual below and the single-field cash correction (Section 6).

#### `goals` — EF + card-payoff, progress derived from the ledger

```ts
export const goals = sqliteTable('goals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),                          // "Emergency Fund", "Kill Credit Card"
  type: text('type', { enum: ['savings','debt_payoff'] }).notNull(),
  target_amount_cents: integer('target_amount_cents').notNull(),
  account_id: integer('account_id').references(() => accounts.id),  // savings → EF account
  debt_id: integer('debt_id').references(() => debts.id),           // payoff → card debt
  target_date: text('target_date'),
  monthly_contribution_cents: integer('monthly_contribution_cents'),
  status: text('status', { enum: ['active','achieved','paused'] }).notNull().default('active'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});
```

Progress is always **recomputed from `transactions`** (EF = balance of the EF account; payoff = `1 − balance_cents/original_principal_cents`), never a hand-maintained number.

#### `push_subscriptions` and `notifications_sent`

```ts
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  user_agent: text('user_agent'),
  created_at: integer('created_at').notNull(),
  last_ok_at: integer('last_ok_at'),
  failed_at: integer('failed_at'),                       // set on 404/410 → pruned
});

export const notificationsSent = sqliteTable('notifications_sent', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['bill_due','payday_save','weekly_checkin','milestone'] }).notNull(),
  ref_id: integer('ref_id'),                             // recurring_item_id / debt_id / goal_id
  scheduled_for: text('scheduled_for').notNull(),        // MYT date — idempotency key
  sent_at: integer('sent_at'),
}, (t) => ({ uniqFire: unique().on(t.kind, t.ref_id, t.scheduled_for) }));
```

#### `users` (single row)

Holds the WebAuthn credential / argon2id password hash and the bootstrap state (Section 9).

### Deferred tables (phase 2/3, specified for migration path)

- `categories` (self-referential nesting, icons, colors) — replaces the v1 string enum when the expense view needs grouping richness.
- `debt_schedule` — explicit per-installment rows; replaces `remaining_installments_json` if amortisation detail is needed.
- `budgets` — per-category limits, weekly/monthly, rollover.
- `habit_streaks`, `habit_events`, `milestones` — the streak/milestone engine (Section 8, phase 2).

### Relationship summary (v1)

`accounts 1—1 debts` (card ↔ card debt) · `accounts 1—N transactions` (+`counter_account_id` for transfers/EF funding) · `recurring_items 1—N transactions` · `debts 1—N transactions` · `goals 1—N transactions` · `goals 1—1 {account|debt}` · `push_subscriptions`/`notifications_sent` standalone.

---

## 4. Feature — Cash-Flow Forecast & Safe-to-Spend

### Purpose

Answer two questions every day from one event stream: **"Am I going to run dry?"** (projected cash trajectory to the next inflow) and **"What can I spend right now without breaking anything?"** (the **Safe-to-Spend** hero number). Everything is derived; the user logs variable spend and occasionally corrects his cash balance.

### Two balances tracked

Because daily life is currently financed at 18% on the card:

- **`cash`** — bank + e-wallet. This is what can bounce; Safe-to-Spend and shortfall detection run on it.
- **`card`** — outstanding card debt. Grows on card-funded spend and on monthly interest accrual; shrinks on card payments. Surfaced in the debt view.

### The hard available-credit constraint (review HIGH)

The premise "most daily living is charged to the card" collides with arithmetic: limit ~RM8,000, balance RM7,400.76 = only **RM586.64 headroom** (his real available balance), while card-funded living (food, transport, Digi, Unifi, insurance, ILP, gym, subs — most auto-charged) is ~RM2,960/month (~RM2,610 with the ILP paused), with several auto-debits landing on the 1st. The card physically declines at the limit.

The model resolves this two ways, both active:

1. **Hard ceiling, not a soft warning.** `accounts.available_credit_cents` is a real constraint. The forecast flags **CRITICAL "card maxed — charges will decline"** when projected card balance reaches the limit, not merely a ">90% utilisation" warning. (The soft 90% warning is kept as an earlier amber signal.)
2. **The kill-the-card plan flips card-funded templates to bank/eWallet funding** (Section 3) and, if the BT is approved (Section 5), moves the RM7,400.76 *off* the revolving card into an installment loan — freeing the limit entirely. Either path stops the forecast from re-polluting the balance it's trying to kill.

### Safe-to-Spend (the hero metric)

*"How much can I spend between now and my next paycheck without dipping below my buffer or stealing from savings?"*

```
STS_cycle = cash_now
          + expected_inflows_before_next      // usually 0; covers two close inflows
          − committed_outflows_until(next_inflow)   // every bill/installment/card payment due before next inflow
          − savings_target_remaining          // the payday EF transfer still owed this cycle
          − BUFFER_FLOOR                       // hard keep-in-account minimum

STS_daily  = STS_cycle / max(1, days_to_next_inflow) − spent_today_variable
STS_weekly = STS_cycle × min(7, days_left) / days_left
```

`committed_outflows` **excludes** discretionary variable spend (that is exactly what STS is *for*). `next_inflow` = nearest of {1st, 23rd, payday} strictly after today.

**Display rules:** the hero is `STS_cycle` ("Safe to spend until 23 Jun: RMx"), with `STS_weekly`/`STS_daily` as chips. If `STS_cycle < 0` → show **RM0 in red** + "You're already committed past your buffer this cycle — RMy short." Never show a negative spendable number. STS recomputes live on every logged transaction.

### Variable-spend projection — v1 is flat, not statistical (review MEDIUM)

For future days, project variable spend as the **user-set monthly budget** (food RM1,000, transport RM450) ÷ days in month — no trailing window, no p95 capping, no cold-start blend. On day 1 there is zero data, so statistical averaging would do nothing useful during the make-or-break adoption window while adding cost. **Deferred to phase 3:** the 60-day `CategoryAverage` view, p95 outlier capping, seed-blending, and day-of-week weighting — revisit once 60+ days of real logs exist.

### Forecast scope — v1 is monthly + STS; daily chart is phase 2 (review LOW)

**v1 produces:** the STS number (above) and a **monthly surplus rollup** that draws the rising-surplus curve. **Deferred to phase 2:** the full per-day running-balance projection chart, per-day shortfall flags, and the weekend/holiday salary-shift logic (the MYT public-holiday calendar is a maintenance liability for marginal early value). The monthly rollup plus STS-until-next-inflow covers the day-1 behavioral need.

Monthly rollup:

```
income   = Σ inflows in month
living   = Σ cash+card expense events (food, transport, bills, subs)
debt_svc = Σ scheduled debt + card payment events
surplus  = income − living − debt_svc
```

This drives the surfaced insights: **surplus exists but leaks** (show `surplus` next to `Δcash this month`; if positive but cash isn't rising, flag "you cleared RMx but it didn't land in savings"), **ILP-while-18%-card is backwards** (compare RM350 ILP against the ~RM111/mo card interest), and **card is priority** (debt view ranks by APR).

### Constants (single config block)

```
BUFFER_FLOOR     = 20000 sen (RM200)   # hard floor under cash
SAVINGS_TARGET   = 30000 sen (RM300)/cycle  # EF nudge, user-set
FORECAST_HORIZON = 6 months (max 12)
CARD_UTIL_WARN   = 0.90                 # amber; hard decline at 1.00
```

### Sanity check against his numbers (and the precise ~RM623 label — review LOW)

**Month 1 (heaviest — July).** Income RM7,019.50. Living (food 1,000 + transport 450 + Digi 378.60 + elec 150 + Unifi 150 + insurance 350 + ILP 350 + gym 199 + subs 82) = RM3,109.60. Scheduled debt (car 904 + PTPTN 270 + SLoan1 177.43 + SLoan2 90.83 + SPayLater 1,519.50 + Ryt PayLater 214.15) = RM3,175.91.

```
raw_surplus_m1 = 7019.50 − 3109.60 − 3175.91 = RM733.99
```

The net **~RM623** is this **minus one month of card interest** (RM7,400.76 × 18% ÷ 12 ≈ **RM111.01**) — i.e. *surplus after covering the cost of carrying the card, before any principal paydown.* (It is **not** "surplus after the card minimum"; the 5% minimum is ~RM370. This precise label matters because STS's credibility rests on the user trusting exactly what is and isn't subtracted.) The **Ryt PayLater RM214.15 runs Jul–Oct only**; thereafter the monthly surplus keeps rising as SPayLater declines, reaching ~RM2,412/mo available by month 6 (card dead → no interest drain). Pausing the ILP adds RM350 throughout. *(All figures here are surplus **available to deploy** after every bill + card interest, before routing to EF or card principal — not "left over after the card paydown".)*

**Month ~6 (Dec).** SLoan 2 finished (Oct), SPayLater down to RM146.51, Ryt PayLater ended (Oct). Scheduled debt = car 904 + PTPTN 270 + SLoan1 177.43 + SPayLater 146.51 = RM1,497.94 → `raw_surplus_m6 = RM2,411.96`; with the card dead by ~M6 there is no interest drain, so **~RM2,412 is available to deploy**. Both endpoints on ONE basis (surplus available after every bill + card interest): **~RM623 (Jul) → ~RM2,412 (M6).** Pausing the ILP adds RM350/mo on top throughout.

---

## 5. Feature — Debt Payoff Planner

### The reconciled kill-the-card plan (review HIGH — the ~RM490 swing)

The two draft engines disagreed: one said keep the ~RM7,400 on the card at 18% and pay ~RM440–490 interest clearing by month 6; the other said do a **0% balance transfer / installment conversion** (fee-waived campaigns exist) and pay near-RM0. If a sub-18% conversion is obtainable, the plain-18%-avalanche plan is **strictly dominated**. The spec resolves this into **one gated plan**:

**Step 0 — attempt the 0% balance transfer / installment conversion first.** The planner's headline recommended action is "convert/transfer the full ~RM7,400 to a 0% (or lowest-rate) plan." The user has **no Maybank account**, so the order is: first check his **own card issuer's** installment/balance-conversion plan (no new card needed), then compare against opening a 0%-BT card elsewhere. `debts.bt_status` tracks `applied`.

- **If approved** (`bt_status:'active'`, `bt_promo_end_date` set): the planner models the card as a **0%-interest fixed-term obligation** — ~RM7,400 to clear *inside the promo window* — not an 18% revolving balance. Surplus is routed to clear it **before the promo expires** (the goal becomes "don't let it roll back to 18%"), not to minimise interest that no longer exists. Card interest accrual (below) stops.
- **If declined** (`bt_status:'declined'`): fall back to the **18%-avalanche** path below. A sub-18% installment conversion from his own issuer (or an open-market product like CIMB's ~13% EIR Auto Balance Conversion) is the secondary fallback before plain revolving.

In both branches, daily-living templates are flipped off the card (Section 3/4) so the balance only falls.

### v1 planner — single strategy, not a comparator (review MEDIUM)

The answer for this user is already decided (avalanche, card-first, buffer-first, pause ILP), so v1 does **not** build a configurable avalanche/snowball comparator. v1 shows: **current card balance, its monthly interest (~RM111, or RM0 under an active BT), and a single projected card-free date** computed from forecast surplus routed to the card (one loop, one strategy). The card-free date re-forecasts live as the user quick-logs.

**Deferred to phase 2 (if ever):** the two-strategy month-by-month simulation, multi-debt rollover, per-debt payoff dates, and the dedicated `debt_schedule` table (v1's `remaining_installments_json` covers SPayLater's "next amount + remaining count").

### Card interest accrual must post to the ledger (review LOW but load-bearing)

Without this, `debts.balance_cents` silently drifts below reality every cycle and corrupts "Kill Credit Card" progress. **Fix:** the `post-recurring` task, on each card `statement_day` (only while `bt_status ≠ 'active'`), posts an `auto` transaction `category:'interest'` of `balance × apr_bps / 120000` that increases the card debt balance — mirroring how SPayLater installments post. This keeps the ledger honest and stops reconciliation from masking the single most important number in the app.

### Why avalanche, why never the car/PTPTN

The card dwarfs everything else in cost and is the only debt where extra ringgit move the needle; SLoans and SPayLater are already ending on schedule, so snowball "wins" buy almost nothing while the card bleeds ~RM111/mo. (Note: **SLoan 1 ~24% EIR and SLoan 2 ~31% EIR are actually higher-rate than the card**, but their interest is *precomputed* into fixed installments — early settlement barely rebates it — and both finish soon, Oct 2026 / Mar 2027, so they simply run off; the *revolving* card stays the only place extra ringgit cut future interest.) **PTPTN stays at minimum forever** (~1% < both EF yield and card APR — never prepay). **Car loan stays at minimum:** prepaying a Malaysian flat-rate hire-purchase loan recovers only a small Rule-of-78 statutory rebate (Hire-Purchase Act 1967) — a poor use of ringgit versus the 18% card, so keep it at minimum until the card is dead. (The earlier "saves nothing" claim was imprecise; the conclusion is unchanged.)

### Recommended timeline

| Phase | Months | Move | Result |
|---|---|---|---|
| **Buffer** | M1–M2 | ~RM500/mo → EF to a **RM1,000 floor** (canonical figure, §7); card gets min + interest only (or BT installment) | RM1,000 buffer; first habit streak |
| **Attack** | M3–M6 | Full surplus + paused ILP RM350 → card | Card 7,500 → ~5,300 → ~3,300 → ~1,100 → **0 by ~M6** |
| **Sweep** | M7–M8 | SPayLater tail + SLoans finish on schedule; resume ILP; grow buffer toward 1-month expenses | Only car + PTPTN left, both cheap |

Total card interest under this plan: **~RM444–490 if no BT; ~RM0 if the BT is approved** (the whole point of Step 0).

---

## 6. Feature — Expense Tracking

### Low-friction capture is the product

The single highest-friction, highest-value moment is logging variable spend in the wild (food/fuel). Quick-log is **two taps**: amount + category chip (food/transport/other), optional note, done. Auto-posted bills and salary appear automatically with `source:'auto'`; manual entries are `source:'manual'`. The expense list groups by `category` (v1 string enum) and month, with the source tag separating auto bills from manual logs.

### Offline-first quick-log (review MEDIUM — confirm the device first)

The quick-log path must survive flaky mobile data; everything else can be online-first.

- **App-shell precache** via `@vite-pwa/nuxt` (`injectManifest` strategy — required anyway for the custom push handler, Section 8). App opens instantly offline.
- **Quick-log writes to an IndexedDB `pending_txns` store first** with a **client-generated UUID** as idempotency key, optimistically updates the UI, then flushes to `POST /api/transactions`, which **upserts on `uuid`** (the `transactions.uuid UNIQUE` constraint is a real DB constraint, not prose). A double-fired flush can't duplicate.
- **Flush strategy is device-aware.** Background Sync is flaky/absent on iOS Safari/PWA (the user's **confirmed device — iPhone**). v1 therefore uses **"queue in IndexedDB, flush on next app open / on reconnect"** as the reliable baseline, with Background Sync as *progressive enhancement* that no-ops gracefully where unsupported. No CRDT/conflict machinery beyond UUID dedupe.
- **Read views** (forecast/debt) are online-first with last-known-good cached JSON fallback — informational, eventual-consistency is fine. Auto-recurring posts are generated **server-side**, never client-side, so they're never in the offline queue.

### Single-field cash correction (review HIGH — reconciliation deferred)

Full reconciliation (BalanceAnchor, drift computation, `is_reconciling` rows, pending-confirm workflow, drift alerts) is **accounting-grade machinery that increases friction** and demands the exact discipline this user lacks — so it is **deferred to phase 3**. The v1 escape hatch is one field: **"Correct my cash balance to RM___"** writes a single adjusting transaction (`category:'adjustment'`, `source:'adjustment'`) for the difference. No anchors, no drift nagging. Balances are otherwise derived from the ledger; the one auto-posted adjustment that *does* exist is the card interest accrual (Section 5).

---

## 7. Feature — Budgets & Savings Goals

### v1 — Safe-to-Spend *is* the budget; the EF goal is real

For day 1, the honest **Safe-to-Spend** number (Section 4) is the only budget the user needs, plus a flat monthly target per variable category (food RM1,000, transport RM450) feeding the projection. The full `budgets` table (per-category limits, weekly/monthly periods, rollover) and the `categories` table (nesting, icons, colors) are **deferred to phase 2** — budgeting-with-rollover is asked for and rarely used; nested categories are polish; neither is needed to produce STS or fund the EF.

### Emergency Fund — the north-star feature, modelled as real money movement (review HIGH)

The EF is a real internal `savings` account (Section 3). The payday-prompt's **"Transfer logged"** action writes an actual transfer transaction (cash account → EF account, `goal_id` set, `category:'savings'`). The user mirrors the move into his **RYT Bank "Emergency Fund" Save Pocket** manually (PIDM-insured deposit, instant, ~3%); the app records intent-as-recorded. Therefore the EF progress bar, every EF milestone, and the STS `savings_target` carve-out all derive from **one real ledger row** — not a hand-maintained counter that nothing reliably writes. Without this the habit loop's entire payoff (watching the EF grow) is fictional.

Two goals seeded: **Emergency Fund** (`savings`, target = canonical buffer below) and **Kill Credit Card** (`debt_payoff` → card debt).

### The canonical buffer target (review MEDIUM — three figures reconciled)

The drafts scattered three starter-buffer numbers (RM1,000 / RM3,000 / one-month ~RM2,000–2,500). **One canonical figure: a RM1,000 starter buffer.** It is the defensible "enough to stop the next surprise hitting the 18% card" amount and **minimises interest drag** — holding RM3,000 first instead of RM1,000 keeps only an *extra* ~RM2,000 off the card for ~2 extra months at 1.5%/mo ≈ **~RM60 extra card interest** and pushes the card-free date out by weeks. RM1,000 is used consistently across the planner, the milestone ladder, and the Malaysian defaults (Section 11).

The planner **surfaces the tradeoff explicitly** so the user decides with the number visible: *"A bigger buffer-first costs ~RM60 more card interest and pushes card-free out ~N weeks."* After the card is dead, the full buffer grows to **6 months of essentials — RM15,000** (user-chosen), held in the RYT Bank Save Pocket.

---

## 8. Habit Engine

Turns a passive ledger into an active coach via **one in-process scheduler** firing **PWA push**, reading the shared data model. Therapeutic intent is in the copy: catch the surplus the moment income lands, keep the 18% card the visible kill target, make the EF grow visibly enough to become its own reward.

### Scheduler topology — ONE model, resolved (review BLOCKER)

The drafts gave three mutually exclusive answers (in-process Nitro plugin / Nitro `scheduledTasks` / a second `money-scheduler` PM2 process running `.output/scheduler.mjs` — an artifact the `node-server` preset never builds). **Decision: in-process Nitro `scheduledTasks` (croner engine) inside the single `money-fms` PM2 app, fork mode, `instances:1`.**

- Same Drizzle layer and same `web-push` config as the request handlers — least code, least drift, matches "one process owns everything."
- The only objection (experimental flag + "fires per instance") is neutralised: a single-user app has no reason to run cluster mode, and `fork`/`instances:1` is correct for SQLite single-writer anyway, so in-process fires exactly once.
- **The `money-scheduler` PM2 app is deleted from `ecosystem.config.cjs`.** There is no `.output/scheduler.mjs`. Running both would double-fire every notification.

```ts
// nuxt.config.ts
nitro: {
  experimental: { tasks: true },
  scheduledTasks: {
    '*/5 * * * *': ['notify:dispatch'],     // bill reminders + payday prompts, gated in code by MYT time/date
    '5 0 * * *':   ['streak:rollover'],      // phase 2 — just after MYT midnight
    '0 9 * * 0':   ['checkin:weekly'],       // phase 2 — Sunday 09:00 MYT
  },
}
```

Smoke-test that croner actually starts under the `node-server` preset (log task fires) before relying on it.

### Timezone & catch-up correctness (review MEDIUM)

VPS clocks are UTC; the app must fire at 9am MYT and key idempotency on MYT dates. **Standardize:** store timestamps as **UTC epoch**, store business dates (due-day anchors, period keys, `scheduled_for`) as **MYT calendar dates**, and compute "today MYT" once per run from a **single `mytDate.ts` helper**. Set the croner timezone **and** all date arithmetic to `Asia/Kuala_Lumpur` explicitly; assert `process.env.TZ` rather than depending on the box locale. Every task is **idempotent and catch-up aware**: it writes a `notifications_sent` row (`kind, ref_id, scheduled_for`) and checks it before sending, and on startup scans for due-today reminders whose `scheduled_for` passed but never sent (catch-up after downtime). **Required test:** run the dispatcher at 23:30 and 00:30 MYT around month boundaries (Feb 28/29, 30/31-day months) and assert exactly-once posting and clamped `day_of_month`.

### PWA Push architecture

Standard Web Push end-to-end, no third-party vendor (single user, own VPS).

- **Server:** `web-push` (handles VAPID signing + `aes128gcm` payload encryption). VAPID keys generated once (`npx web-push generate-vapid-keys`), stored as env vars, **never rotated casually** (rotation invalidates every subscription). Initialised in `server/plugins/webpush.ts`.
- **Client:** `@vite-pwa/nuxt` with **`injectManifest`** (not `generateSW`, which can't host a custom `push` handler).
- **Subscribe flow:** in-app "Turn on reminders" button (the permission prompt **must** come from a user gesture — hard iOS requirement) → `Notification.requestPermission()` → `pushManager.subscribe({ userVisibleOnly:true, applicationServerKey })` → `POST /api/push/subscribe`, which **is gated by `requireSession()`** (Section 9).
- **Multiple devices** each produce a subscription row; on send, iterate all non-`failed_at` rows, set a **TTL**, and **wrap each send so one bad subscription can't block the others**. On `web-push` `404`/`410`, set `failed_at` and stop sending to that row.
- **Service worker** handles `push` (showNotification with `tag` to collapse duplicates, `data.url` deep-link, `actions`), `notificationclick` (focus/open), and `pushsubscriptionchange` (transparent re-subscribe).

### The iOS caveat — a first-class health signal (review LOW)

iOS 16.4+ web push works **only when installed to the Home Screen** (`display:standalone`), never in a Safari tab — the single biggest silent-failure mode. Mitigations:

- Detect non-standalone on iOS → one-time "tap Share → Add to Home Screen" banner.
- Show "Turn on reminders" only once running standalone on iOS.
- Treat **"is this running standalone on iOS with permission granted?"** as a dashboard health signal **and surface it in the weekly email fallback** (the VPS has SMTP) so a broken push channel is loud, not silent.
- Send a **"reminders are working" canary push** after enabling, for positive confirmation.
- **Fallback channel:** an in-app "What needs your attention" list on the dashboard (and optional email) so the habit loop closes even when push fails.

### Reminders are derived from the data model

The `notify:dispatch` task each run: compute today MYT; select `recurring_items` where active and `due_day` (clamped to month length) is 3 days out, 1 day out, or today; for SPayLater read the next `remaining_installments_json[0]` so the reminder shows the correct declining amount; check `notifications_sent`; if absent and local time ≥ 09:00, send push + log. **Payday prompts** use the same mechanism on `direction:'income'` events — salary day, the 1st, the 23rd — but fire a **savings prompt**, not an FYI. Editing a bill in the UI automatically changes what's reminded; no second source of truth.

### MVP cut line vs phase 2 (review MEDIUM — honor the cut line)

**v1 habit engine ships exactly:** (1) push subscribe + custom SW + `web-push`, (2) `notify:dispatch` for bill-due reminders and the three payday-save prompts, (3) the Safe-to-Spend hero on the dashboard, (4) the EF transfer action (Section 7).

**Payday prompt copy (v1):** *"RM600 just landed. Move RM___ to your emergency fund now? You're cash-flow positive — this is the surplus that usually disappears."* One-tap **Transfer logged** / **Adjust** / **Skip** (skipping logs the decision, breaks no streak). Suggested amount scales: small now, larger from ~month 6.

**Deferred to phase 2** (additive, same scheduler + ledger — that's why deferral is safe): the two-streak engine (daily-log + weekly-checkin) with freeze tokens and the "nothing to log today" button, the `habit_events`/`habit_streaks` tables, the milestone ladder (First RM1,000 → 1-month buffer → 3/6-month → card paid off → each loan cleared), and the full 7-section weekly check-in screen. Streak logic with grace tokens is a notorious timezone/day-boundary bug source for marginal early value.

---

## 9. Security, Auth & Backups

This guards an entire financial life on a public subdomain — treat it as hostile-internet-facing even with one user.

### Auth — one committed stack (review HIGH, BLOCKER-adjacent)

The drafts contradicted (WebAuthn + argon2 + server-side sessions vs. only `NUXT_SESSION_PASSWORD` sealed cookies). **Committed v1 stack:**

- **argon2id password** (`@node-rs/argon2`), params pinned **in code** (memory ≥ 19 MiB, time ≥ 2) — never bcrypt, never plain.
- **Server-side session row** in SQLite (`users`/`sessions`), opaque random id in an **httpOnly, Secure, SameSite=Lax cookie** bound to `money.argontechs.dev`, 30-day rolling. Revocable by deleting the row; a `session_epoch` field allows bulk invalidation. `NUXT_SESSION_PASSWORD` (≥32 chars; `openssl rand -hex 32` = 64 hex is fine) signs/seals the cookie — it is **not** the session mechanism by itself (the row is).
- **`requireSession()` gates every `server/api/**` handler.** The **only** exceptions are the auth login/callback routes; **`/api/push/subscribe` is NOT an exception** — it is gated (an open subscribe endpoint lets anyone spam `push_subscriptions`).
- **Bootstrap without self-claim race (review HIGH):** registration is **not** open-then-lock (between deploy and first registration, anyone hitting `/register` first becomes the owner). Instead, seed the single user via a **one-time CLI/migration seed**, or require a **`REGISTER_TOKEN`** (set in `.env`, printed to server logs) on the register call. Never allow self-claim over the public internet.
- **Harden the surface:** rate-limit login (constant-time hash compare), HSTS + strict CSP via Nitro route rules.
- **Phase 2:** add **WebAuthn passkey** (`@simplewebauthn`, `rpID='money.argontechs.dev'`, `origin='https://money.argontechs.dev'`, credential pubkey stored + the same server-side session row for revocation) as a convenience biometric login. Deferred from v1 — passkey enrollment/recovery is fiddly and produces zero habit value on day 1.

### The cron-key internal endpoint (review HIGH)

If the optional cron fallback endpoint exists, **bind it to 127.0.0.1 only, require its secret via constant-time compare, and ensure nginx never proxies `/api/internal/*` from outside.** Better: drop the HTTP fallback entirely once in-process tasks are confirmed working (Section 8 makes them the only model).

### Backups — `.backup` only, never `cp` (review HIGH)

With WAL mode (mandated), a bare `cp money.sqlite` copies the main file **without** `-wal`/`-shm`, losing recently committed transactions and risking a corrupt restore — a silent data-loss trap for financial history. **The `cp money.db` suggestion is struck entirely.** Use **`sqlite3 ".backup"`** (point-in-time consistent on a live WAL DB) → gzip → 14-day local retention → **off-box copy via rclone** to Google Drive (the one infra item *not* to defer; it's his financial data). Full script in Section 12.

**Restore-and-verify drill (mandatory):** a backup never restored is not a backup. Periodically restore the latest gz to a scratch path and run `PRAGMA integrity_check;` + a row-count / last-transaction sanity check. This is what makes the "trivially copy and verify my entire dataset" claim real.

### Atomic money mutation (review MEDIUM)

Every post (auto or manual flush) wraps **insert transaction + account balance update + debt update + schedule shift + occurrence decrement** in a **single `better-sqlite3` transaction**, so an offline-sync flush and a scheduler post on the same minute can't race or drift even with one writer. The `transactions.uuid UNIQUE` and `(recurring_item_id, date) UNIQUE` constraints are real DB constraints backstopping idempotency.

---

## 10. MVP Phasing

Ruthless cut: **v1 must reach first value in under 2 minutes and form the habit before adding anything.** The schema below is small; Drizzle migrations make growing it free.

### v1 — the habit-forming core (~8 tables)

**Tables:** `users`, `accounts` (incl. the internal **Emergency Fund** account), `transactions` (mutable, flat string `category`, UUID idempotency), `recurring_items` (single canonical shape, funding via account), `debts` (flat, `remaining_installments_json` for SPayLater — **no** `debt_schedule`), `goals` (EF + Kill Card), `push_subscriptions`, `notifications_sent`.

**Features:**
- **Quick-log** (two taps, offline IndexedDB queue + flush-on-open, UUID upsert).
- **Safe-to-Spend hero** on the dashboard + monthly surplus rollup (flat variable-spend projection, no statistics).
- **Emergency Fund** as a real account; payday prompt's "Transfer logged" writes a real transfer.
- **Debt view:** card balance, monthly interest (or RM0 under BT), single card-free date; **BT-first** gated recommendation; card-interest accrual posts to the ledger.
- **Habit engine:** push subscribe + custom SW + `web-push`; `notify:dispatch` for bill-due + the three payday prompts; iOS standalone health signal + email fallback.
- **Auth:** argon2id + server-side session, token-gated bootstrap, hardening.
- **Card-funded templates flipped to bank/eWallet** under the kill-card plan; hard available-credit ceiling modelled.

**First-run onboarding (review LOW — minimal):** ask only **current cash balance, card balance, salary amount/day, EF target.** Pre-seed this user's known 16 recurring templates (incl. Ryt PayLater) and seven debts via a **one-time seed script** (it's single-user). Bills can be edited lazily. Target: usable STS + a first logged transaction within 2 minutes — time-to-first-value predicts whether the habit forms.

**Known starting position (2026-06-18, for seed defaults):** ~**RM750** in bank + ~**RM250** cash ≈ **RM1,000 liquid**, **RM0 ring-fenced**. This is the user's entire liquid net worth — so the EF account opens at RM0 and the *first* in-app action is ring-fencing this existing ~RM1,000 into the RYT "Emergency Fund" Save Pocket (it is **not** investable surplus; see §11). The starter-buffer milestone is therefore ~75% reachable on day one by relabelling cash already held, not by saving fresh — a deliberately fast first win.

### Phase 2 — retention boosters & richer views

Streaks (daily-log + weekly-checkin, freeze tokens, "nothing to log today"), `habit_events`/`habit_streaks`, milestone ladder, full weekly check-in screen; `categories` table (nesting/icons); `budgets` table; the avalanche/snowball comparator + multi-debt rollover + `debt_schedule`; the **daily** forecast chart + per-day shortfall flags + weekend/holiday salary shift; WebAuthn passkey login; optional OS-cron watchdog.

### Phase 3 — accounting-grade precision

Full reconciliation (BalanceAnchor, drift detection, `is_pending` confirm workflow, drift alerts); 60-day `CategoryAverage` variable-spend estimation (p95 capping, seed-blend, day-of-week weighting); append-only ledger with adjusting-row corrections (only if reconciliation lands).

---

## 11. Malaysian Financial Defaults (personalized money-routing)

The defaults are ordered to fix the backwards setup. *(General information, not licensed financial advice — verify current rates/terms with each provider before acting.)*

### 1. Where to park the liquid emergency fund

Capital safety + instant access beat yield for money whose whole job is to be there in a crisis. **Primary home: the RYT Bank savings deposit (a dedicated "Emergency Fund" Save Pocket).** It is the rare option that delivers all three at once: **PIDM-insured up to RM250k** (a real protected deposit, unlike money-market apps), **instant access**, and **~3% p.a. base**, paid daily (the 1% stamp-campaign bonus that briefly lifted it to ~4% ended 31 Mar 2026 — *verify the current rate at build, §13*). The RM15k target sits well inside the RM250k PIDM limit.

**Ryt Invest (SavePlus / Income / Gold) is NOT for the emergency fund.** These are OpusAM-managed investment funds (launched 28 May 2026): **not PIDM-protected**, **T+1** settlement, and they fluctuate in value. Of the three, only **SavePlus** (low-risk, money-market-style) is even buffer-shaped; **Income** holds blue-chip equities + bonds and **Gold** is a volatile commodity — both can fall exactly when an emergency hits (recessions take markets and jobs together). Reserve SavePlus/Income for money *beyond* the 6-month buffer (see §11.5). **Bank FD is also wrong here** — it locks the money. (User is **not** Bumiputera, so ASB is out of scope.)

### 2. The 18% card — stop revolving (the BT, reconciled with Section 5)

The standout move is to get the ~RM7,400 off 18% revolving. **He has no Maybank account**, so the order is: **(1)** ask his **own card issuer** for a balance/installment-conversion plan (converts the outstanding balance to a fixed term, no new card) — accept only if its EIR clearly beats 18%; **(2)** otherwise apply for a **0% balance-transfer card** on the open market (market benchmarks: a 0% BT-i ~12 months with fee waived — RM7,400 fits typical min RM1,000 / max RM50,000; CIMB Auto Balance Conversion ~13% EIR, no fee). **Avoid** conversions whose EIR lands near 18% (e.g. some flat-9.80% plans compute to ~16–18% EIR) — they barely beat revolving, and the standard Flexi Payment Plan still charges 18% on unpaid balances. **Critically: stop charging daily living to this card while it carries a balance** — route daily spend to debit/eWallet and pay-in-full only, or the balance is re-polluted at 18% (enforced in data by flipping the card-funded templates — Section 3).

### 3. The Great Eastern "Great Wealth Enhancer" ILP — stop now, while almost nothing is sunk

Funding RM350/mo into this plan while revolving the card at 18% with zero buffer is mathematically backwards, and the policy page makes it the clearest-cut case there is:

- **It's charged to the 18% credit card (••0509)** — so he is *borrowing at 18% to fund a ~5% plan locked for 20 years*: a guaranteed double-digit annual loss before it earns a cent.
- **Premium term is 10 years (Premium End Date 17 May 2036), not 5** — total future commitment ~**RM42,000**, not RM21k. Confirm with the agent; this misunderstanding alone warrants a hard rethink.
- **He is ~1 month in** (commenced 18 May 2026, one premium paid) — almost nothing is sunk, so the early surrender-charge trap hasn't bitten.
- **It is pure savings** (sum assured RM4,200, no real riders) — stopping forfeits **no** protection. His insurance is a *separate* RM350 critical-illness GE plan (due the 27th) that stays untouched.

**Action: contact GE and confirm** (a) the premium term (5 vs 10 yrs), (b) **free-look / cooling-off status** — normally 15 days from policy delivery; commenced 18 May so likely just past it, but if still inside, cancel for a near-full refund, (c) current surrender value (likely ~RM0 this early — a tiny sunk cost vs ~RM42k of future premiums), (d) premium-holiday / paid-up option. Then **stop charging it to the card** and redirect the RM350 to buffer-then-card. Resume or replace it (e.g. Ryt Invest SavePlus, *after* the buffer + card) only as a deliberate later step — not by default.

### 4. Buffer sizing (consistent with Section 7)

- **Starter: RM1,000** — the canonical figure; enough to break the "RM0 buffer → card finances life at 18%" loop while minimising interest drag. **Funded *first*, and ~75% already covered by the ~RM1,000 cash on hand today** — the first action is ring-fencing it, not saving fresh.
- **Full: 6 months of essentials — RM15,000** (≈RM2,500/mo × 6; user-chosen), held entirely in the RYT Bank Save Pocket (within the RM250k PIDM limit).

### Concrete monthly routing waterfall (~RM623 Jul → ~RM2,412 by month 6, surplus available to deploy; +RM350 if ILP paused)

1. **Pay all minimums / fixed obligations** — car, PTPTN (minimum forever — never prepay), SLoans, SPayLater schedule, insurance, the BT monthly installment.
2. **RM1,000 starter buffer → RYT Bank "Emergency Fund" Save Pocket** (PIDM-insured, instant, ~3%). Ring-fence the ~RM1,000 already on hand first; thereafter top up on each cash-in day (salary ~1st–3rd, the 1st, the 23rd) so the habit anchors to income events. **Do not invest this money** (§11.1).
3. **Do the 0% BT / conversion, then throw the rest of the surplus at the ~RM7,400** (now 0% → every ringgit is pure principal). Clear it inside the promo window; do not let it roll back to 18%.
4. **Free the RM350 ILP cash** (premium holiday / reduction) and redirect it into #3 until the card is gone.
5. **After the card:** finish the full RM15,000 (6-month) buffer in the RYT Save Pocket, then deploy further surplus to longer-term investing (Ryt Invest SavePlus/Income) rather than resuming the locked 20-year ILP. Optional accelerants throughout: Digi ~RM379 and gym RM199 are the fattest discretionary lines.

The system surfaces this as the single Safe-to-Spend number (income − fixed obligations − this-month's buffer/debt allocation) and fires the payday prompt on salary day, the 1st, and the 23rd to convert the leaking surplus into a visible streak.

---

## 12. Deployment Guide — CloudPanel + PM2

Deploys the Nuxt 4 + Nitro PWA (`node-server` preset → `.output/server/index.mjs`) the same way the user runs PWA-PropertyAgentCRM. SQLite = no DB server to provision.

> **Verify the site-user naming first (review LOW).** CloudPanel's convention is that the site user IS the SSH user with files under `/home/<siteUser>`. Before following anything below, check the existing PropertyCRM box: `ls /home` and `clpctl` output show the real user. **Use whatever CloudPanel actually creates uniformly** for SSH, docroot, crontab owner, and `pm2 startup -u`. Do not mix a `money-ssh` form and `money` unless confirmed distinct. Below assumes site user **`money`**, domain **`money.argontechs.dev`** — adjust to reality.

### 0. DNS first

A record `money` → VPS public IPv4 (AAAA if IPv6). Confirm `dig +short money.argontechs.dev` returns the VPS IP before issuing the cert (Let's Encrypt HTTP-01 fails otherwise).

### 1. Create the Node.js site

```bash
clpctl site:add:nodejs \
  --domainName=money.argontechs.dev \
  --nodejsVersion=22 \
  --appPort=3000 \
  --siteUser=money \
  --siteUserPassword='<strong-password>'
```

Provisions the Linux site user, docroot `/home/money/htdocs/money.argontechs.dev`, and an nginx vhost reverse-proxying all requests to `127.0.0.1:3000` (Node is never exposed directly).

### 2. Code onto the box

SSH as the **site user** (not root). `cd` into the docroot, `git clone <repo> .`. Pin the preset in `nuxt.config.ts`:

```ts
nitro: { preset: 'node-server', compressPublicAssets: true,
  experimental: { tasks: true }, scheduledTasks: { /* §8 */ } }
```

### 3. Environment variables

```bash
NODE_ENV=production
NITRO_HOST=127.0.0.1
NITRO_PORT=3000
DATABASE_URL=file:/home/money/data/money.sqlite     # OUTSIDE docroot

VAPID_PUBLIC_KEY=<from web-push>
NUXT_PUBLIC_VAPID_PUBLIC_KEY=<same public key>      # client-exposed copy
VAPID_PRIVATE_KEY=<from web-push>                   # server-only
VAPID_SUBJECT=mailto:yongwei1127@gmail.com

NUXT_SESSION_PASSWORD=<openssl rand -hex 32>        # ≥32 chars
REGISTER_TOKEN=<openssl rand -hex 16>               # one-time bootstrap (§9)
```

`chmod 600 .env`. Bind Nitro to `127.0.0.1` so only nginx reaches it.

### 4. SQLite location + daily backup

```bash
mkdir -p /home/money/data /home/money/backups && chmod 700 /home/money/data /home/money/backups
cd /home/money/htdocs/money.argontechs.dev && npm run db:migrate && npm run db:seed   # one-time seed (§10)
```

`/home/money/bin/backup-db.sh` — **`.backup`, never `cp`** (review HIGH):

```bash
#!/usr/bin/env bash
set -euo pipefail
DB=/home/money/data/money.sqlite ; DEST=/home/money/backups
STAMP=$(date +%Y%m%d-%H%M%S) ; OUT="$DEST/money-$STAMP.sqlite"
sqlite3 "$DB" ".backup '$OUT'"          # consistent hot snapshot (WAL-safe)
gzip "$OUT"
find "$DEST" -name 'money-*.sqlite.gz' -mtime +14 -delete   # 14-day retention
rclone copy "$OUT.gz" remote:money-fms-backups/ --quiet     # off-box (one-time: rclone config)
```

Plus a **monthly restore-verify** (Section 9): restore latest gz to scratch, `PRAGMA integrity_check;` + row-count check. Cron as the site user: `15 3 * * * /home/money/bin/backup-db.sh >> /home/money/backups/backup.log 2>&1`.

### 5. PM2 — ONE app (review BLOCKER)

The `money-scheduler` second process is **removed** (no `.output/scheduler.mjs` artifact exists; scheduling is in-process — Section 8). One fork-mode instance (SQLite single-writer):

```javascript
// /home/money/htdocs/money.argontechs.dev/ecosystem.config.cjs
const cwd = '/home/money/htdocs/money.argontechs.dev'
module.exports = { apps: [{
  name: 'money-fms', cwd, script: '.output/server/index.mjs',
  exec_mode: 'fork', instances: 1, env_file: '.env',
  max_memory_restart: '400M',
  out_file: '/home/money/logs/money-fms-out.log',
  error_file: '/home/money/logs/money-fms-error.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
}] }
```

```bash
mkdir -p /home/money/logs
cd /home/money/htdocs/money.argontechs.dev && npm ci && npm run build
pm2 start ecosystem.config.cjs && pm2 save
```

**Reboot persistence (review BLOCKER):** a non-root PM2 systemd unit is killed at session end and does **not** start at boot without lingering.

```bash
pm2 startup systemd -u money --hp /home/money    # run the printed sudo line as root
sudo loginctl enable-linger money                # <-- the line that makes it survive reboot
pm2 save
sudo reboot                                       # then confirm `pm2 list` shows online WITHOUT logging in interactively
```

### 6. Build must see the client VAPID env (review MEDIUM)

`runtimeConfig.public` (the client VAPID key for `pushManager.subscribe`) is resolved **at build time**. `pm2 reload --update-env` only updates the running server, not the built bundle. So `npm run build` **must** source the env:

```bash
set -a; . ./.env; set +a; npm run build
```

Post-deploy, verify the public key is actually in the client bundle and **test a real `subscribe()` end-to-end** — a missing key fails every push silently with no server error.

### 7. Reverse proxy + HTTPS

CloudPanel's vhost already targets `127.0.0.1:3000`. Verify `curl -I http://127.0.0.1:3000`. Issue the cert: CloudPanel → Sites → SSL/TLS → New Let's Encrypt Certificate → Create and Install (auto HTTP→HTTPS redirect, auto-renew). HTTPS is mandatory for service workers / push. Confirm the proxy block forwards `X-Forwarded-Proto $scheme` (so Nitro knows it's behind HTTPS for secure cookies) and `Upgrade $http_upgrade`.

### 8. Repeatable deploy — `/home/money/bin/deploy.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /home/money/htdocs/money.argontechs.dev
git pull --ff-only
npm ci
npm run db:migrate                      # before reload — new code never hits old schema
set -a; . ./.env; set +a; npm run build # build sees NUXT_PUBLIC_VAPID_PUBLIC_KEY (§6)
pm2 reload ecosystem.config.cjs --update-env
pm2 save
echo "Deployed money-fms @ $(git rev-parse --short HEAD)"
```

Rollback: `git reset --hard <sha> && npm ci && npm run build && pm2 reload ecosystem.config.cjs`. SQLite is untouched (lives in `/home/money/data`).

**Mental model:** Internet → nginx (TLS, 443) → `127.0.0.1:3000` → PM2 fork `money-fms` (app **+ in-process scheduler**) → `/home/money/data/money.sqlite`. Daily `.backup` ships a copy off-box; `loginctl enable-linger` + `pm2 save` cover reboots.

---

## 13. Open Questions & Risks

**Must-verify before/at build (gating):**
- **A 0% BT / sub-18% installment conversion obtainable for the ~RM7,400 balance?** User has **no Maybank** — check his own card issuer's conversion plan first, then open-market 0%-BT cards. The kill-card plan (Section 5) gates on `bt_status`; if nothing beats 18%, the plain 18%-avalanche fallback applies. Verify current terms directly — campaign dates may have lapsed by 2026-06.
- **Croner actually starts under the `node-server` preset.** Smoke-test task fires before trusting the habit engine (the product's point) to it. Fallback if not: a single OS-cron line hitting a 127.0.0.1-bound, secret-gated `/api/internal/run-due` (Section 9).
- **CloudPanel site-user naming** on this box (Section 12 note) — verify against the PropertyCRM box to avoid a wasted deploy session on wrong paths.
- **Target device: iPhone (confirmed).** Drives the offline-flush strategy (Background Sync no-ops on iOS → queue-and-flush) and the push-install friction. iOS Safari-tab push failure is the single biggest silent adoption risk — mitigated by the Home-Screen-install prompt, the standalone health signal, and the email fallback (Section 8).

**Behavioral / scope risks:**
- **Over-building is the primary risk to the goal**, not under-building. The v1 cut (Section 10) is deliberately small; resist re-adding phase-2 features before the habit forms. Time-to-first-value (<2 min) is the metric that predicts success.
- **The EF is self-reported** (the app can't see TNG/KDI). "Transfer logged" records *intent*; if the user taps it without actually moving money, progress is fictional. Accepted tradeoff for v1; the real ledger row at least makes the intent auditable and the prompt habit-forming.
- **Reconciliation deferred (phase 3)** means small drift between app cash and real bank balance accumulates; the single-field "correct my cash to RM___" escape hatch (Section 6) is the only v1 correction. Acceptable for a habit tool; revisit once months of data exist.

**Resolved with the user (2026-06-18):** main device = **iPhone**; salary lands **1st–3rd** (seeded 3rd); **not Bumiputera** (ASB out); EF full target = **6 months / RM15,000** (~RM2,500/mo essentials); EF home = **RYT Bank Save Pocket** (PIDM deposit), **not** Ryt Invest; ILP = Great Wealth Enhancer, 10-yr term to 2036, charged to the card, ~1 mo in → stop/pause; **backups → Google Drive**; **no Maybank account** (find a 0%-BT / installment-conversion alternative from a bank he actually uses). Full seed figures: card RM7,400.76 (avail RM586.64, stmt 15th, due ~5th), car RM73,484.67 @2.44% flat (due 22nd), PTPTN RM32,843.62 (due 1st), SLoan1 RM177.43 ×8 (due 12th, ends Mar 2027), SLoan2 RM90.83 ×3 (due 7th, ends Oct 2026), SPayLater (due 10th), Ryt PayLater RM214.15 ×4 (due ~22nd, Jul–Oct), Digi RM378.60 (16th), Unifi RM150 (19th), insurance RM350 (27th), ILP RM350 (17th), gym RM199 (1st), subs RM82 (5th), electricity ~RM150 (16th, off-card); current liquid ≈ RM1,000 (RM750 bank + RM250 cash).

**Still open (confirm at build, non-blocking):**
- Which bank issues his card / where he can get a **0% balance-transfer or installment conversion** (no Maybank) — survey his actual issuer's current campaign; the kill-card plan gates on `bt_status`.
- SLoan 1 / SLoan 2 exact contractual rates (the ~24% / ~31% EIRs are derived; doesn't change the never-target conclusion).

---

## 14. Self-Review Corrections (2026-06-18) — BINDING on the implementation plan

A 5-lens adversarial review verdicted **approve-with-fixes** (financial strategy + core architecture verified correct; no blockers). The directives below **supersede** any conflicting text in earlier sections and MUST be reflected in the build.

### HIGH — must implement exactly

1. **Scheduler naming must match files, or it silently never fires (§2/§8).** Nitro resolves a `'notify:dispatch'` task name to `server/tasks/notify/dispatch.ts` (colon → nested dir). Use **one consistent convention**: flat files with flat names — `server/tasks/notify-dispatch.ts` registered as `'notify-dispatch'`, `post-recurring.ts` as `'post-recurring'`, etc. Add the missing **`post-recurring` daily cron** entry. After deploy, assert in logs that each task actually registers and fires (the spec's croner smoke test).
2. **Available-credit is derived, never seeded (§3/§4/§5).** `available_credit_cents = credit_limit_cents − card_debt_balance` computed at read time. Confirm the **real statement limit** at seed (his stated avail RM586.64 + balance RM7,400.76 ⇒ limit ≈ RM7,987, i.e. ~RM8,000 with a small pending hold — seed the actual limit, do not hardcode 800000 as gospel). The "card maxed → charges decline" hard flag reads the derived value.
3. **Payoff bar needs a frozen baseline (§3/§5/§6).** `1 − balance/original_principal` breaks (null → NaN; goes negative after interest accrual). Add **`goals.baseline_amount_cents`** (or `debts.payoff_baseline_cents`), snapshot = card balance at goal creation; progress = `clamp((baseline − current)/baseline, 0, 1)`.
4. **VAPID public key is RUNTIME config, not build-time (§12.6).** Declare `runtimeConfig.public.vapidPublicKey = ''`, read via `useRuntimeConfig()` (never `import.meta.env`), set **`NUXT_PUBLIC_VAPID_PUBLIC_KEY`** in the env; `pm2 reload --update-env` picks it up. **Delete the "source .env before npm run build" step** from `deploy.sh`. Keep the end-to-end `subscribe()` smoke test.
5. **One balance authority — the ledger (§3/§5).** Account & debt balances change **only** via `transactions` rows carrying `account_id`/`debt_id` (payments decrement, interest increments). `recurring_items.scheduled_payment` is a **template only**. Compute `debt_service` for the rollup from **ledger XOR templates, never both** — no double-count.
6. **Session cookie hard-set in code (§12.7).** `setCookie` does NOT auto-add `Secure`, and `X-Forwarded-Proto` is spoofable from the loopback port. Set `httpOnly:true, secure:true, sameSite:'lax', domain:'money.argontechs.dev'` explicitly in code; use the proto header only for origin construction. Keep HSTS + HTTP→HTTPS redirect.
7. **Backup script: rclone before prune, named remote, alert + verify (§12.4).** Run `rclone copy` to the **named Google Drive remote BEFORE** the local `find -delete` prune (or make rclone non-fatal with an alert). Add off-box retention, an upload-size sanity check, `chmod 600` on the archive + rclone config, and a **second cron** that restore-verifies (`PRAGMA integrity_check` + row-count + latest-timestamp).
8. **One savings-target rule across §4/§7/§8.** `SAVINGS_TARGET` is **per-cycle** (a "cycle" = gap between consecutive inflows: salary~1st–3rd, 1st, 23rd). STS subtracts `savings_target_remaining` for the *current* cycle; the payday-prompt's suggested amount = that remaining figure. **Phase-scaled:** Buffer phase ≈ RM500/mo split across inflows → EF; Attack phase routes surplus to the **card** (EF target paused at RM1,000); post-card resumes EF toward RM15,000. The hero number must never subtract a target it isn't actually steering.

### MEDIUM — implement

9. **Card interest is a separate carrying-cost line (§4/§5).** In the rollup it sits in **neither** `living` nor `debt_service` (the ~RM623 label = raw_surplus − interest). Accrual updates the card **debt row and the linked card account row inside one transaction**.
10. **Keep the OS-cron fallback as standing insurance (§8/§13).** The habit engine rides the *experimental* Nitro tasks flag in-process. Pin Nuxt/Nitro versions (treat a major bump as a migration event); keep the loopback-bound, secret-gated `/api/internal/run-due` OS-cron **watchdog permanently** (do not "drop once croner works"); the startup catch-up scan must cover the **5-minute payday/bill window**, not just daily reminders.
11. **`next_due_date` is the single "when due" field (§8/§3).** Recompute it inside the same atomic post transaction; both scheduler and forecast read **only** it (never re-derive from `due_day` at read time). Covered by the mandated Feb 28/29 + 30/31 month-boundary test.
12. **Auth hardening (§9).** Seed the single user via **CLI/migration** (never log a token; if a token is used, single-use). Login: per-account backoff + per-IP cap stored in SQLite, with a cheap pre-check **before** argon2id (prevent memory-DoS on the fork). `.gitignore` must cover `.env`, `*.sqlite*`, `/data`, `/backups`; the nginx vhost denies dotfiles. `requireSession()` exemptions = **login + callback only** (push/subscribe is gated).
13. **Transfers (incl. EF) are two-leg atomic (§7/§9).** One operation writes a negative row on `account_id` and a positive row on `counter_account_id` in a single transaction; EF progress sums both legs.
14. **Category enum (§3/§6).** Add **`'other'`** to `transactions.category`; auto-post maps template categories into the enum (gym/subs/insurance → `'bills'`).

### LOW — fold in during build

15. **better-sqlite3 transactions are synchronous** — use `db.transaction(() => {…})`; keep ALL network/push I/O **outside** the closure (no `await` inside).
16. Seed the EF goal at the **RM1,000 starter**, migrate target to RM15,000 once funded (so day-one progress doesn't read ~7%).
17. Add **`transactions.is_estimate`** so estimated bills (Digi, electricity) are distinguishable from confirmed actuals.
18. SPayLater: read the installment **by index**, don't destructively shift the array (idempotent on task rerun).
19. Add a **`recomputeBalances()`** routine that rebuilds account/debt balances from the ledger (drift recovery).
20. Key `spent_today_variable` / `STS_daily` off the transaction's **client MYT date** (`mytDate.ts`), not flush/server time.
21. Add **`TZ=Asia/Kuala_Lumpur`** to the §12 env block; cron timezone + the 09:00 gate both read from `mytDate.ts`.
22. All state-changing endpoints are **POST/PATCH/DELETE only** (no mutating GET), each `requireSession`-gated.
23. **Name the session lib:** opaque-random-id in an httpOnly cookie + a `sessions` table as the authority (the row is canonical; `NUXT_SESSION_PASSWORD` only seals, it is not the session). Rotating the session password bumps `session_epoch`.
24. Verify reboot persistence from a **root shell** (SSHing as the site user masks a missing linger); ensure off-box archives contain only the sqlite backup, never `.env`; CloudPanel site-user verification is a hard precondition reused for crontab + `pm2 startup` + linger + docroot.

### Still-open after review (confirm at build)
- **Verify the current RYT savings rate** (the ~4% stamp campaign ended 31 Mar 2026; planning rate is ~3% — does not affect the EF-vs-18%-card logic).
- **Pin each finite template's first post-month** at seed so counts/end-dates reconcile (SLoan1 ×8, SLoan2 ×3, Ryt PayLater ×4 Jul–Oct, SPayLater first installment) — confirm the exact next-payment month with the user; the ~RM268 trough wobble doesn't change strategy.
- Ryt Invest accounts/goals are **NOT** seeded in v1 — the EF account is the only savings destination.
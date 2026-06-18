## Phase 3 — Forecast, Safe-to-Spend & Debt View

> ⚠️ **Read [`CORRECTIONS.md`](./2026-06-18-personal-fms-CORRECTIONS.md) first.** It resolves cross-phase fixes (debt-leg sign, EF two-leg reads, env-var names, schema re-export, single savings-target, SPayLater seed template, task ordering) that **supersede any conflicting code below**.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the day-1 decision-support layer — a Safe-to-Spend hero, a monthly surplus rollup (card interest excluded as a carrying cost), a debt view (card balance, ~RM111/mo interest or RM0 under an active BT, a single card-free date, BT-first gated recommendation), and EF + Kill-Card goal progress — all derived from the Phase-1/2 ledger.

**Architecture:** Pure read-side computation. Three Nitro GET handlers (`forecast.get.ts`, `debt.get.ts`, `goals/progress.get.ts`) call small, individually-tested `server/utils/` pure functions over rows read from the Drizzle `db`. No handler mutates state. The dashboard page (`app/pages/index.vue`) wires the three reads plus the `useSafeToSpend` composable. STS recomputes client-side on every quick-log via `useSafeToSpend`, which mirrors the server formula so the optimistic UI matches the next server read.

**Tech Stack:** Nuxt 4 + Nitro (`node-server`) · Vue 3 SPA · better-sqlite3 + Drizzle · vitest (+ @nuxt/test-utils for Nitro handlers) · TypeScript.

## Global Constraints

- Single-user; MYR only; integer **sen**, never float.
- DB: WAL + `foreign_keys=ON`; `transactions.uuid` UNIQUE and `UNIQUE(recurring_item_id, date)` are real DB constraints.
- All mutations are `requireSession`-gated POST/PATCH/DELETE; **no state-changing GET**. The three Phase-3 GET handlers are read-only but still `requireSession`-gated (every `server/api/**` handler except auth login/callback calls `requireSession(event)`).
- Money: `server/utils/money.ts` → `ringgitToSen`, `senToRinggit`, `formatRM(sen)` → `"RM7,400.76"`.
- Dates: timestamps = UTC epoch ms integers; business dates = MYT `YYYY-MM-DD` strings. `server/utils/mytDate.ts` → `todayMYT()`, `nowEpoch()`, `clampDay(year,month1to12,day)`, `nextDueDate(fromISO,dayOfMonth)`. TZ pinned `Asia/Kuala_Lumpur`.
- **One balance authority — the ledger (§14 #5).** Account & debt balances change only via `transactions` rows carrying `account_id`/`debt_id`. `recurring_items.scheduled_payment_cents` is a template only. `debt_service` for the rollup is computed from ledger XOR templates, **never both** — no double-count.
- **`available_credit_cents` is DERIVED (§14 #2):** `credit_limit_cents − card_debt_balance`, computed at read time, never seeded.
- **Payoff baseline is frozen (§14 #3):** `debts.payoff_baseline_cents` snapshot at goal creation; progress = `clamp((baseline − current)/baseline, 0, 1)`.
- **Card interest is a separate carrying-cost line (§14 #9):** `category:'interest'`; in the rollup it sits in **neither** `living` **nor** `debt_service`. The ~RM623 (Jul) label = `raw_surplus − interest`.
- **One savings-target rule (§14 #8):** `SAVINGS_TARGET` is **per-cycle** (a cycle = the gap between consecutive inflows among {salary day 3, the 1st, the 23rd}). STS subtracts `savings_target_remaining` for the *current* cycle only; the hero must never subtract a target it isn't actually steering (Attack phase routes surplus to the card, so EF target pauses at the RM1,000 floor).
- **`next_due_date` is the single "when due" field (§14 #11):** both scheduler and forecast read **only** it, never re-derive from `due_day` at read time.
- **`spent_today` keys off the transaction's client MYT date (§14 #20)**, not flush/server time.
- Never show a negative spendable number: `STS_cycle < 0` → display RM0 in red + "RMy short".
- Constants (§4 single config block): `BUFFER_FLOOR = 20000`, `SAVINGS_TARGET = 30000`, `CARD_UTIL_WARN = 0.90`, hard decline at `1.00`. EF starter goal target = `100000` sen (§14 #16; migrate to `1500000` once funded).
- better-sqlite3 transactions are synchronous (not exercised here — Phase 3 is read-only).

**Consumes from earlier phases (exact, must already exist):**
- `server/db/index.ts` → `db` (Drizzle instance, WAL + FK on).
- `server/db/schema.ts` → `accounts`, `debts`, `recurringItems`, `transactions`, `goals` (snake_case columns per §3 + §14: `accounts.available_credit_cents` derived, `debts.payoff_baseline_cents`, `transactions.category` enum includes `'other'`, `transactions.is_estimate`).
- `server/utils/money.ts` → `ringgitToSen`, `senToRinggit`, `formatRM`.
- `server/utils/mytDate.ts` → `todayMYT()`, `nowEpoch()`, `clampDay()`, `nextDueDate()`.
- `server/utils/requireSession.ts` → `requireSession(event): Session` (throws 401).

---

### Task 3.1: Forecast constants module

**Files:**
- Create: `server/utils/forecastConstants.ts`
- Test: `server/utils/__tests__/forecastConstants.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BUFFER_FLOOR: number` (20000), `SAVINGS_TARGET_PER_CYCLE: number` (30000), `CARD_UTIL_WARN: number` (0.9), `CARD_UTIL_DECLINE: number` (1.0), `EF_STARTER_TARGET: number` (100000), `EF_FULL_TARGET: number` (1500000), and the inflow anchor list `INFLOW_DAYS: number[]` (`[1, 3, 23]` — the 1st, salary day 3, the 23rd).

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/__tests__/forecastConstants.test.ts
import { describe, it, expect } from 'vitest'
import {
  BUFFER_FLOOR,
  SAVINGS_TARGET_PER_CYCLE,
  CARD_UTIL_WARN,
  CARD_UTIL_DECLINE,
  EF_STARTER_TARGET,
  EF_FULL_TARGET,
  INFLOW_DAYS,
} from '../forecastConstants'

describe('forecastConstants', () => {
  it('pins the §4 single config block in integer sen', () => {
    expect(BUFFER_FLOOR).toBe(20000)
    expect(SAVINGS_TARGET_PER_CYCLE).toBe(30000)
    expect(CARD_UTIL_WARN).toBe(0.9)
    expect(CARD_UTIL_DECLINE).toBe(1.0)
  })

  it('seeds the EF goal at the RM1,000 starter, full target RM15,000 (§14 #16)', () => {
    expect(EF_STARTER_TARGET).toBe(100000)
    expect(EF_FULL_TARGET).toBe(1500000)
  })

  it('anchors inflows to the 1st, salary day 3, and the 23rd (§4)', () => {
    expect(INFLOW_DAYS).toEqual([1, 3, 23])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/__tests__/forecastConstants.test.ts`
Expected: FAIL — `Cannot find module '../forecastConstants'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/forecastConstants.ts
// §4 single config block (integer sen). §14 #16: EF starts at RM1,000, migrates to RM15,000.
export const BUFFER_FLOOR = 20000 // RM200 hard floor under cash
export const SAVINGS_TARGET_PER_CYCLE = 30000 // RM300 EF nudge, per cycle (§14 #8)
export const CARD_UTIL_WARN = 0.9 // amber
export const CARD_UTIL_DECLINE = 1.0 // hard decline — "card maxed, charges decline"
export const EF_STARTER_TARGET = 100000 // RM1,000 starter buffer
export const EF_FULL_TARGET = 1500000 // RM15,000 full (6-month) buffer
export const INFLOW_DAYS = [1, 3, 23] // 1st, salary day 3, 23rd (§4 next_inflow set)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/__tests__/forecastConstants.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/forecastConstants.ts server/utils/__tests__/forecastConstants.test.ts
git commit -m "feat(forecast): pin §4 config block constants in sen"
```

---

### Task 3.2: `nextInflowDate` — nearest of {1st, salary day 3, 23rd} strictly after today

**Files:**
- Create: `server/utils/nextInflow.ts`
- Test: `server/utils/__tests__/nextInflow.test.ts`

**Interfaces:**
- Consumes: `INFLOW_DAYS` from `forecastConstants.ts`; `clampDay` from `mytDate.ts`.
- Produces: `nextInflowDate(fromISO: string): string` — the nearest MYT `YYYY-MM-DD` among the inflow anchor days **strictly after** `fromISO`, rolling into next month when all this-month anchors have passed. `daysBetweenISO(aISO: string, bISO: string): number` — whole-day count `b − a` (UTC-midnight arithmetic, MYT-date safe).

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/__tests__/nextInflow.test.ts
import { describe, it, expect } from 'vitest'
import { nextInflowDate, daysBetweenISO } from '../nextInflow'

describe('daysBetweenISO', () => {
  it('counts whole days forward', () => {
    expect(daysBetweenISO('2026-06-18', '2026-06-23')).toBe(5)
  })
  it('counts across a month boundary', () => {
    expect(daysBetweenISO('2026-06-23', '2026-07-01')).toBe(8)
  })
  it('is zero for the same day', () => {
    expect(daysBetweenISO('2026-06-18', '2026-06-18')).toBe(0)
  })
})

describe('nextInflowDate', () => {
  it('from the 18th returns the 23rd (this month)', () => {
    expect(nextInflowDate('2026-06-18')).toBe('2026-06-23')
  })
  it('from the 23rd rolls to the 1st of next month (strictly after)', () => {
    expect(nextInflowDate('2026-06-23')).toBe('2026-07-01')
  })
  it('from the 1st returns the 3rd (salary day)', () => {
    expect(nextInflowDate('2026-06-01')).toBe('2026-06-03')
  })
  it('from the 3rd returns the 23rd', () => {
    expect(nextInflowDate('2026-06-03')).toBe('2026-06-23')
  })
  it('clamps a Feb roll-in to a real day (1st always valid)', () => {
    expect(nextInflowDate('2026-01-31')).toBe('2026-02-01')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/__tests__/nextInflow.test.ts`
Expected: FAIL — `Cannot find module '../nextInflow'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/nextInflow.ts
import { INFLOW_DAYS } from './forecastConstants'
import { clampDay } from './mytDate'

// UTC-midnight epoch for an MYT calendar date string (date-only arithmetic, no TZ drift).
function isoToUtcMidnight(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
function utcMidnightToIso(ms: number): string {
  const dt = new Date(ms)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function daysBetweenISO(aISO: string, bISO: string): number {
  return Math.round((isoToUtcMidnight(bISO) - isoToUtcMidnight(aISO)) / 86_400_000)
}

export function nextInflowDate(fromISO: string): string {
  const [y, m] = fromISO.split('-').map(Number)
  const candidates: string[] = []
  // this month's anchors + next month's anchors (covers end-of-month roll)
  for (const day of INFLOW_DAYS) {
    candidates.push(clampDay(y, m, day)) // this month
    const ny = m === 12 ? y + 1 : y
    const nm = m === 12 ? 1 : m + 1
    candidates.push(clampDay(ny, nm, day)) // next month
  }
  const fromMs = isoToUtcMidnight(fromISO)
  const future = candidates
    .map(isoToUtcMidnight)
    .filter((ms) => ms > fromMs) // strictly after today
    .sort((a, b) => a - b)
  return utcMidnightToIso(future[0])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/__tests__/nextInflow.test.ts`
Expected: PASS (8 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/nextInflow.ts server/utils/__tests__/nextInflow.test.ts
git commit -m "feat(forecast): nextInflowDate over {1st, salary day 3, 23rd} + daysBetweenISO"
```

---

### Task 3.3: `computeSafeToSpend` — STS_cycle / daily / weekly (§4 + §14 #8, #20)

**Files:**
- Create: `server/utils/safeToSpend.ts`
- Test: `server/utils/__tests__/safeToSpend.test.ts`

**Interfaces:**
- Consumes: `BUFFER_FLOOR` from `forecastConstants.ts`; `nextInflowDate`, `daysBetweenISO` from `nextInflow.ts`.
- Produces:
  ```ts
  export interface StsInput {
    cashNowCents: number            // bank + e-wallet balance, derived from ledger
    expectedInflowsBeforeNextCents: number  // usually 0; covers two close inflows
    committedOutflowsCents: number  // Σ bills/installments/card payment due strictly before next inflow (excl. discretionary)
    savingsTargetRemainingCents: number     // current-cycle EF target still owed (0 in Attack phase)
    spentTodayVariableCents: number // discretionary spend already logged today (client MYT date)
    todayISO: string                // client MYT date
  }
  export interface StsResult {
    cycleCents: number              // clamped ≥ 0 for display
    dailyCents: number              // clamped ≥ 0
    weeklyCents: number             // clamped ≥ 0
    isNegative: boolean             // true when the raw cycle figure < 0
    shortfallCents: number          // |raw cycle| when negative, else 0
    nextInflowISO: string
    daysToNextInflow: number        // max(1, …)
  }
  export function computeSafeToSpend(input: StsInput): StsResult
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/__tests__/safeToSpend.test.ts
import { describe, it, expect } from 'vitest'
import { computeSafeToSpend } from '../safeToSpend'

describe('computeSafeToSpend', () => {
  it('STS_cycle = cash + inflows − committed − savings_target − BUFFER_FLOOR', () => {
    // cash 80000, no extra inflows, committed 20000, savings target 30000, buffer 20000
    // raw cycle = 80000 + 0 - 20000 - 30000 - 20000 = 10000
    const r = computeSafeToSpend({
      cashNowCents: 80000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 20000,
      savingsTargetRemainingCents: 30000,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-18', // next inflow 23rd → 5 days
    })
    expect(r.cycleCents).toBe(10000)
    expect(r.nextInflowISO).toBe('2026-06-23')
    expect(r.daysToNextInflow).toBe(5)
    expect(r.isNegative).toBe(false)
  })

  it('STS_daily = cycle / days − spent_today_variable, clamped at 0', () => {
    // cycle 10000 over 5 days = 2000/day; spent_today 500 → 1500
    const r = computeSafeToSpend({
      cashNowCents: 80000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 20000,
      savingsTargetRemainingCents: 30000,
      spentTodayVariableCents: 500,
      todayISO: '2026-06-18',
    })
    expect(r.dailyCents).toBe(1500)
  })

  it('STS_weekly = cycle × min(7, days)/days', () => {
    // days=5 (<7) → weekly == cycle == 10000
    const r = computeSafeToSpend({
      cashNowCents: 80000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 20000,
      savingsTargetRemainingCents: 30000,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-18',
    })
    expect(r.weeklyCents).toBe(10000)
  })

  it('weekly caps to a 7-day slice when more than 7 days remain', () => {
    // from the 23rd next inflow is the 1st → 8 days. cycle 80000 → weekly = 80000*7/8 = 70000
    const r = computeSafeToSpend({
      cashNowCents: 80000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 0,
      savingsTargetRemainingCents: 0,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-23',
    })
    expect(r.daysToNextInflow).toBe(8)
    expect(r.weeklyCents).toBe(70000)
  })

  it('never shows a negative number: clamps to 0 and reports shortfall', () => {
    // raw cycle = 5000 + 0 - 30000 - 0 - 20000 = -45000
    const r = computeSafeToSpend({
      cashNowCents: 5000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 30000,
      savingsTargetRemainingCents: 0,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-18',
    })
    expect(r.cycleCents).toBe(0)
    expect(r.dailyCents).toBe(0)
    expect(r.weeklyCents).toBe(0)
    expect(r.isNegative).toBe(true)
    expect(r.shortfallCents).toBe(45000)
  })

  it('does not subtract a savings target it is not steering (Attack phase = 0)', () => {
    // savings target paused (0) → cycle larger than the buffer-phase case
    const r = computeSafeToSpend({
      cashNowCents: 80000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 20000,
      savingsTargetRemainingCents: 0,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-18',
    })
    expect(r.cycleCents).toBe(40000)
  })

  it('guards days_to_next_inflow with max(1, …) so daily never divides by zero', () => {
    // todayISO already an inflow day: next strictly-after is the 3rd → still ≥ 1
    const r = computeSafeToSpend({
      cashNowCents: 20000,
      expectedInflowsBeforeNextCents: 0,
      committedOutflowsCents: 0,
      savingsTargetRemainingCents: 0,
      spentTodayVariableCents: 0,
      todayISO: '2026-06-01',
    })
    expect(r.daysToNextInflow).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/__tests__/safeToSpend.test.ts`
Expected: FAIL — `Cannot find module '../safeToSpend'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/safeToSpend.ts
import { BUFFER_FLOOR } from './forecastConstants'
import { nextInflowDate, daysBetweenISO } from './nextInflow'

export interface StsInput {
  cashNowCents: number
  expectedInflowsBeforeNextCents: number
  committedOutflowsCents: number
  savingsTargetRemainingCents: number
  spentTodayVariableCents: number
  todayISO: string
}

export interface StsResult {
  cycleCents: number
  dailyCents: number
  weeklyCents: number
  isNegative: boolean
  shortfallCents: number
  nextInflowISO: string
  daysToNextInflow: number
}

export function computeSafeToSpend(input: StsInput): StsResult {
  const nextInflowISO = nextInflowDate(input.todayISO)
  const daysToNextInflow = Math.max(1, daysBetweenISO(input.todayISO, nextInflowISO))

  // STS_cycle (§4). committed_outflows already excludes discretionary variable spend.
  const rawCycle =
    input.cashNowCents +
    input.expectedInflowsBeforeNextCents -
    input.committedOutflowsCents -
    input.savingsTargetRemainingCents -
    BUFFER_FLOOR

  const isNegative = rawCycle < 0
  const cycleCents = isNegative ? 0 : rawCycle
  const shortfallCents = isNegative ? -rawCycle : 0

  // STS_daily = cycle / days − spent_today_variable (§4, §14 #20: spent_today keyed off client MYT date)
  const dailyCents = Math.max(
    0,
    Math.floor(cycleCents / daysToNextInflow) - input.spentTodayVariableCents,
  )

  // STS_weekly = cycle × min(7, days)/days (§4)
  const weeklyCents = Math.floor((cycleCents * Math.min(7, daysToNextInflow)) / daysToNextInflow)

  return { cycleCents, dailyCents, weeklyCents, isNegative, shortfallCents, nextInflowISO, daysToNextInflow }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/__tests__/safeToSpend.test.ts`
Expected: PASS (7 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/safeToSpend.ts server/utils/__tests__/safeToSpend.test.ts
git commit -m "feat(forecast): computeSafeToSpend STS_cycle/daily/weekly, never negative (§4, §14 #8/#20)"
```

---

### Task 3.4: Forecast ledger reads — cash, committed outflows, variable projection, savings-target

**Files:**
- Create: `server/utils/forecastReads.ts`
- Test: `server/utils/__tests__/forecastReads.test.ts`

**Interfaces:**
- Consumes: `db` from `server/db/index.ts`; `accounts`, `recurringItems`, `transactions` from `server/db/schema.ts`; `daysBetweenISO` from `nextInflow.ts`; `SAVINGS_TARGET_PER_CYCLE` from `forecastConstants.ts`; Drizzle `eq`, `and`, `inArray`, `sql` from `drizzle-orm`.
- Produces (all take the live `db` so tests inject an in-memory instance):
  ```ts
  export function cashNowCents(db: DB): number          // Σ balance_cents of accounts where type IN ('cash','bank','ewallet')
  export function committedOutflowsBeforeCents(db: DB, todayISO: string, nextInflowISO: string): number
       // Σ recurring_items.amount_cents where direction='expense', is_active, next_due_date strictly between today and nextInflow
  export function projectedVariableSpendCents(monthlyBudgetCents: number, daysInMonth: number): number
       // flat: monthly budget ÷ days in month (§4 — v1 flat projection)
  export function spentTodayVariableCents(db: DB, todayISO: string): number
       // Σ |amount| of expense transactions on todayISO with category IN ('food','transport','other')
  export function savingsTargetRemainingCents(db: DB, cycleStartISO: string, nextInflowISO: string): number
       // SAVINGS_TARGET_PER_CYCLE minus EF (category='savings') transfers already made this cycle; clamped ≥ 0
  ```
  where `type DB = ReturnType<typeof import('better-sqlite3-helper-irrelevant')>` — concretely the Drizzle instance type; the test passes a real Drizzle-over-`better-sqlite3` `:memory:` db.

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/__tests__/forecastReads.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { accounts, recurringItems, transactions } from '../../db/schema'
import {
  cashNowCents,
  committedOutflowsBeforeCents,
  projectedVariableSpendCents,
  spentTodayVariableCents,
  savingsTargetRemainingCents,
} from '../forecastReads'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  // minimal DDL mirroring schema.ts columns exercised here
  sqlite.exec(`
    CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      type TEXT NOT NULL, balance_cents INTEGER NOT NULL DEFAULT 0, credit_limit_cents INTEGER,
      available_credit_cents INTEGER, debt_id INTEGER, currency TEXT NOT NULL DEFAULT 'MYR',
      is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE recurring_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      direction TEXT NOT NULL, amount_cents INTEGER NOT NULL, is_variable INTEGER NOT NULL DEFAULT 0,
      cadence TEXT NOT NULL DEFAULT 'monthly', day_of_month INTEGER, weekday INTEGER,
      category TEXT NOT NULL, funding_account_id INTEGER, debt_id INTEGER,
      auto_post INTEGER NOT NULL DEFAULT 1, start_date TEXT NOT NULL, end_date TEXT,
      remaining_occurrences INTEGER, last_posted_date TEXT, next_due_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE,
      date TEXT NOT NULL, amount_cents INTEGER NOT NULL, direction TEXT NOT NULL, category TEXT NOT NULL,
      account_id INTEGER NOT NULL, counter_account_id INTEGER, debt_id INTEGER, goal_id INTEGER,
      note TEXT, source TEXT NOT NULL, recurring_item_id INTEGER, is_estimate INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL);
  `)
  return drizzle(sqlite)
}

let db: ReturnType<typeof makeDb>
beforeEach(() => {
  db = makeDb()
})

describe('cashNowCents', () => {
  it('sums cash + bank + ewallet, excludes card and savings', () => {
    db.insert(accounts).values([
      { name: 'Bank', type: 'bank', balance_cents: 75000, created_at: 1, updated_at: 1 },
      { name: 'Cash', type: 'cash', balance_cents: 25000, created_at: 1, updated_at: 1 },
      { name: 'TNG', type: 'ewallet', balance_cents: 5000, created_at: 1, updated_at: 1 },
      { name: 'Card', type: 'card', balance_cents: -740076, created_at: 1, updated_at: 1 },
      { name: 'EF', type: 'savings', balance_cents: 100000, created_at: 1, updated_at: 1 },
    ]).run()
    expect(cashNowCents(db)).toBe(105000)
  })
})

describe('committedOutflowsBeforeCents', () => {
  it('sums active expense items due strictly between today and next inflow', () => {
    db.insert(recurringItems).values([
      { name: 'Subs', direction: 'expense', amount_cents: 8200, category: 'bills',
        start_date: '2026-06-01', next_due_date: '2026-06-20', is_active: true, created_at: 1, updated_at: 1 },
      { name: 'Salary', direction: 'income', amount_cents: 581950, category: 'income',
        start_date: '2026-06-01', next_due_date: '2026-06-21', is_active: true, created_at: 1, updated_at: 1 },
      { name: 'Digi(after)', direction: 'expense', amount_cents: 37860, category: 'bills',
        start_date: '2026-06-01', next_due_date: '2026-06-30', is_active: true, created_at: 1, updated_at: 1 },
      { name: 'Paused', direction: 'expense', amount_cents: 35000, category: 'bills',
        start_date: '2026-06-01', next_due_date: '2026-06-20', is_active: false, created_at: 1, updated_at: 1 },
    ]).run()
    // window (2026-06-18, 2026-06-23): only Subs (20th) qualifies; income excluded; Digi 30th out of window; paused excluded
    expect(committedOutflowsBeforeCents(db, '2026-06-18', '2026-06-23')).toBe(8200)
  })
})

describe('projectedVariableSpendCents', () => {
  it('is a flat monthly budget ÷ days in month', () => {
    // food RM1,000 = 100000 sen over 30 days = 3333 sen/day (floored)
    expect(projectedVariableSpendCents(100000, 30)).toBe(3333)
  })
})

describe('spentTodayVariableCents', () => {
  it('sums discretionary expense logged on the client MYT date', () => {
    db.insert(transactions).values([
      { uuid: 'a', date: '2026-06-18', amount_cents: -1500, direction: 'expense', category: 'food',
        account_id: 1, source: 'manual', created_at: 1 },
      { uuid: 'b', date: '2026-06-18', amount_cents: -800, direction: 'expense', category: 'transport',
        account_id: 1, source: 'manual', created_at: 1 },
      { uuid: 'c', date: '2026-06-18', amount_cents: -27000, direction: 'expense', category: 'debt',
        account_id: 1, source: 'auto', created_at: 1 }, // not discretionary
      { uuid: 'd', date: '2026-06-17', amount_cents: -900, direction: 'expense', category: 'food',
        account_id: 1, source: 'manual', created_at: 1 }, // yesterday
    ]).run()
    expect(spentTodayVariableCents(db, '2026-06-18')).toBe(2300)
  })
})

describe('savingsTargetRemainingCents', () => {
  it('is the per-cycle target minus EF transfers already made, clamped at 0', () => {
    db.insert(transactions).values([
      { uuid: 'ef1', date: '2026-06-18', amount_cents: 10000, direction: 'transfer', category: 'savings',
        account_id: 5, source: 'manual', created_at: 1 },
    ]).run()
    // target 30000 − 10000 already moved this cycle = 20000
    expect(savingsTargetRemainingCents(db, '2026-06-03', '2026-06-23')).toBe(20000)
  })
  it('clamps to 0 when the cycle target is already met or exceeded', () => {
    db.insert(transactions).values([
      { uuid: 'ef2', date: '2026-06-18', amount_cents: 50000, direction: 'transfer', category: 'savings',
        account_id: 5, source: 'manual', created_at: 1 },
    ]).run()
    expect(savingsTargetRemainingCents(db, '2026-06-03', '2026-06-23')).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/__tests__/forecastReads.test.ts`
Expected: FAIL — `Cannot find module '../forecastReads'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/forecastReads.ts
import { and, eq, gt, lt, inArray, sql } from 'drizzle-orm'
import { accounts, recurringItems, transactions } from '../db/schema'
import { SAVINGS_TARGET_PER_CYCLE } from './forecastConstants'

// The Drizzle-over-better-sqlite3 instance type (server/db/index.ts exports `db` of this shape).
type DB = any

export function cashNowCents(db: DB): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${accounts.balance_cents}), 0)` })
    .from(accounts)
    .where(inArray(accounts.type, ['cash', 'bank', 'ewallet']))
    .get()
  return Number(row?.total ?? 0)
}

export function committedOutflowsBeforeCents(db: DB, todayISO: string, nextInflowISO: string): number {
  // §14 #11: read only next_due_date; never re-derive from due_day. Window is (today, nextInflow).
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${recurringItems.amount_cents}), 0)` })
    .from(recurringItems)
    .where(
      and(
        eq(recurringItems.direction, 'expense'),
        eq(recurringItems.is_active, true),
        gt(recurringItems.next_due_date, todayISO),
        lt(recurringItems.next_due_date, nextInflowISO),
      ),
    )
    .get()
  return Number(row?.total ?? 0)
}

export function projectedVariableSpendCents(monthlyBudgetCents: number, daysInMonth: number): number {
  // §4: v1 flat projection — monthly budget ÷ days in month. No trailing window, no p95.
  return Math.floor(monthlyBudgetCents / daysInMonth)
}

const DISCRETIONARY = ['food', 'transport', 'other'] as const

export function spentTodayVariableCents(db: DB, todayISO: string): number {
  // §14 #20: keyed off the transaction's client MYT date, not server time.
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(ABS(${transactions.amount_cents})), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.date, todayISO),
        eq(transactions.direction, 'expense'),
        inArray(transactions.category, DISCRETIONARY as unknown as string[]),
      ),
    )
    .get()
  return Number(row?.total ?? 0)
}

export function savingsTargetRemainingCents(db: DB, cycleStartISO: string, nextInflowISO: string): number {
  // EF transfers carry category='savings'; count positive legs landing this cycle [cycleStart, nextInflow).
  const row = db
    .select({ moved: sql<number>`COALESCE(SUM(${transactions.amount_cents}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.category, 'savings'),
        gt(transactions.amount_cents, 0),
        sql`${transactions.date} >= ${cycleStartISO}`,
        lt(transactions.date, nextInflowISO),
      ),
    )
    .get()
  const moved = Number(row?.moved ?? 0)
  return Math.max(0, SAVINGS_TARGET_PER_CYCLE - moved)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/__tests__/forecastReads.test.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/forecastReads.ts server/utils/__tests__/forecastReads.test.ts
git commit -m "feat(forecast): ledger reads — cash, committed outflows, flat variable projection, savings-target (§4, §14 #11/#20)"
```

---

### Task 3.5: `computeMonthlyRollup` — income / living / debt_svc / surplus, interest excluded (§4 + §14 #5, #9)

**Files:**
- Create: `server/utils/monthlyRollup.ts`
- Test: `server/utils/__tests__/monthlyRollup.test.ts`

**Interfaces:**
- Consumes: `db` from `server/db/index.ts`; `transactions` from `server/db/schema.ts`; Drizzle `and`, `eq`, `sql`, `like` from `drizzle-orm`.
- Produces:
  ```ts
  export interface MonthlyRollup {
    incomeCents: number      // Σ income transactions in the month
    livingCents: number      // Σ |amount| of expense events: food|transport|bills|other (NOT interest, NOT debt)
    debtServiceCents: number // Σ |amount| of category='debt' expense events (ledger authority — §14 #5)
    interestCents: number    // Σ |amount| of category='interest' — carrying cost, in neither living nor debt_svc (§14 #9)
    rawSurplusCents: number  // income − living − debtService  (the §4 rollup definition)
    surplusAfterInterestCents: number // rawSurplus − interest  (the ~RM623 label)
  }
  export function computeMonthlyRollup(db: DB, monthPrefix: string): MonthlyRollup // monthPrefix = 'YYYY-MM'
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/__tests__/monthlyRollup.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { transactions } from '../../db/schema'
import { computeMonthlyRollup } from '../monthlyRollup'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE,
      date TEXT NOT NULL, amount_cents INTEGER NOT NULL, direction TEXT NOT NULL, category TEXT NOT NULL,
      account_id INTEGER NOT NULL, counter_account_id INTEGER, debt_id INTEGER, goal_id INTEGER,
      note TEXT, source TEXT NOT NULL, recurring_item_id INTEGER, is_estimate INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL);
  `)
  return drizzle(sqlite)
}
let db: ReturnType<typeof makeDb>
beforeEach(() => { db = makeDb() })

describe('computeMonthlyRollup', () => {
  beforeEach(() => {
    db.insert(transactions).values([
      // income
      { uuid: 'i1', date: '2026-07-03', amount_cents: 581950, direction: 'income', category: 'income', account_id: 1, source: 'auto', created_at: 1 },
      { uuid: 'i2', date: '2026-07-01', amount_cents: 60000, direction: 'income', category: 'income', account_id: 1, source: 'auto', created_at: 1 },
      // living (food/transport/bills/other)
      { uuid: 'l1', date: '2026-07-05', amount_cents: -100000, direction: 'expense', category: 'food', account_id: 1, source: 'manual', created_at: 1 },
      { uuid: 'l2', date: '2026-07-06', amount_cents: -45000, direction: 'expense', category: 'transport', account_id: 1, source: 'manual', created_at: 1 },
      { uuid: 'l3', date: '2026-07-16', amount_cents: -37860, direction: 'expense', category: 'bills', account_id: 1, source: 'auto', created_at: 1 },
      { uuid: 'l4', date: '2026-07-09', amount_cents: -1000, direction: 'expense', category: 'other', account_id: 1, source: 'manual', created_at: 1 },
      // debt service (category 'debt')
      { uuid: 'd1', date: '2026-07-22', amount_cents: -90400, direction: 'expense', category: 'debt', debt_id: 4, account_id: 1, source: 'auto', created_at: 1 },
      // card interest — carrying cost, must be excluded from living AND debt_svc (§14 #9)
      { uuid: 'int1', date: '2026-07-15', amount_cents: -11101, direction: 'expense', category: 'interest', debt_id: 1, account_id: 2, source: 'auto', created_at: 1 },
      // a June row that must NOT leak into July
      { uuid: 'june', date: '2026-06-30', amount_cents: -99999, direction: 'expense', category: 'food', account_id: 1, source: 'manual', created_at: 1 },
    ]).run()
  })

  it('income = Σ income transactions in the month', () => {
    expect(computeMonthlyRollup(db, '2026-07').incomeCents).toBe(641950)
  })

  it('living excludes interest and debt', () => {
    // 100000 + 45000 + 37860 + 1000 = 183860
    expect(computeMonthlyRollup(db, '2026-07').livingCents).toBe(183860)
  })

  it('debt_service is category=debt only (ledger authority, §14 #5)', () => {
    expect(computeMonthlyRollup(db, '2026-07').debtServiceCents).toBe(90400)
  })

  it('interest is a separate carrying-cost line (§14 #9)', () => {
    expect(computeMonthlyRollup(db, '2026-07').interestCents).toBe(11101)
  })

  it('raw surplus = income − living − debt_svc; after-interest subtracts the carrying cost', () => {
    const r = computeMonthlyRollup(db, '2026-07')
    expect(r.rawSurplusCents).toBe(641950 - 183860 - 90400) // 367690
    expect(r.surplusAfterInterestCents).toBe(367690 - 11101) // 356589
  })

  it('does not leak rows from an adjacent month', () => {
    // June food row (-99999) must not appear in July living
    expect(computeMonthlyRollup(db, '2026-07').livingCents).toBe(183860)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/__tests__/monthlyRollup.test.ts`
Expected: FAIL — `Cannot find module '../monthlyRollup'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/monthlyRollup.ts
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { transactions } from '../db/schema'

type DB = any

const LIVING = ['food', 'transport', 'bills', 'other'] as const

export interface MonthlyRollup {
  incomeCents: number
  livingCents: number
  debtServiceCents: number
  interestCents: number
  rawSurplusCents: number
  surplusAfterInterestCents: number
}

function sumAbsForCategories(db: DB, monthPrefix: string, categories: readonly string[]): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(ABS(${transactions.amount_cents})), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.direction, 'expense'),
        inArray(transactions.category, categories as unknown as string[]),
        like(transactions.date, `${monthPrefix}-%`),
      ),
    )
    .get()
  return Number(row?.total ?? 0)
}

export function computeMonthlyRollup(db: DB, monthPrefix: string): MonthlyRollup {
  const incomeRow = db
    .select({ total: sql<number>`COALESCE(SUM(${transactions.amount_cents}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.direction, 'income'), like(transactions.date, `${monthPrefix}-%`)))
    .get()
  const incomeCents = Number(incomeRow?.total ?? 0)

  const livingCents = sumAbsForCategories(db, monthPrefix, LIVING)
  const debtServiceCents = sumAbsForCategories(db, monthPrefix, ['debt'])
  const interestCents = sumAbsForCategories(db, monthPrefix, ['interest'])

  // §4: surplus = income − living − debt_svc. §14 #9: interest is neither living nor debt_svc.
  const rawSurplusCents = incomeCents - livingCents - debtServiceCents
  const surplusAfterInterestCents = rawSurplusCents - interestCents // the ~RM623 (Jul) label

  return { incomeCents, livingCents, debtServiceCents, interestCents, rawSurplusCents, surplusAfterInterestCents }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/__tests__/monthlyRollup.test.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/monthlyRollup.ts server/utils/__tests__/monthlyRollup.test.ts
git commit -m "feat(forecast): monthly rollup income/living/debt_svc/surplus, interest as carrying cost (§4, §14 #5/#9)"
```

---

### Task 3.6: `cardMonthlyInterest` + `cardFreeDate` — interest line and single payoff date (§5)

**Files:**
- Create: `server/utils/cardPayoff.ts`
- Test: `server/utils/__tests__/cardPayoff.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces:
  ```ts
  export interface CardLike {
    balance_cents: number        // current card debt balance (positive magnitude)
    apr_bps: number              // 1800 = 18%
    bt_status: 'none' | 'applied' | 'active' | 'declined'
  }
  // Monthly interest = balance × apr_bps / 120000 (= balance × apr/12). RM0 while BT active. (§5)
  export function cardMonthlyInterestCents(card: CardLike): number
  // Loop: each month apply interest (unless BT active) then subtract monthlyPaymentCents; return months to clear.
  // Returns { months, cardFreeISO } or { months: null, cardFreeISO: null } when payment never clears it.
  export function cardFreeDate(card: CardLike, monthlyPaymentCents: number, fromISO: string):
    { months: number | null; cardFreeISO: string | null }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/__tests__/cardPayoff.test.ts
import { describe, it, expect } from 'vitest'
import { cardMonthlyInterestCents, cardFreeDate } from '../cardPayoff'

describe('cardMonthlyInterestCents', () => {
  it('is balance × apr_bps / 120000 (≈ RM111 on RM7,400.76 @ 18%)', () => {
    // 740076 × 1800 / 120000 = 11101.14 → floor 11101 sen = RM111.01
    expect(cardMonthlyInterestCents({ balance_cents: 740076, apr_bps: 1800, bt_status: 'none' })).toBe(11101)
  })
  it('is RM0 while a balance transfer is active (§5)', () => {
    expect(cardMonthlyInterestCents({ balance_cents: 740076, apr_bps: 1800, bt_status: 'active' })).toBe(0)
  })
})

describe('cardFreeDate', () => {
  it('returns null months when the payment never beats interest', () => {
    // interest ≈ 11101/mo; paying 10000/mo never clears
    const r = cardFreeDate({ balance_cents: 740076, apr_bps: 1800, bt_status: 'none' }, 10000, '2026-06-18')
    expect(r.months).toBeNull()
    expect(r.cardFreeISO).toBeNull()
  })

  it('computes a single card-free date under the 18% avalanche (~M6 from §5)', () => {
    // ~RM2,200/mo surplus thrown at the card clears ~RM7,400 in ~4-5 months including interest
    const r = cardFreeDate({ balance_cents: 740076, apr_bps: 1800, bt_status: 'none' }, 220000, '2026-06-18')
    expect(r.months).toBeGreaterThan(0)
    expect(r.months).toBeLessThanOrEqual(6)
    // fromISO 2026-06-18 + months → an ISO date string in the right month
    expect(r.cardFreeISO).toMatch(/^2026-(0[6-9]|1[0-2])-\d{2}$/)
  })

  it('under an active BT, every ringgit is principal (faster, no interest)', () => {
    const noBt = cardFreeDate({ balance_cents: 740076, apr_bps: 1800, bt_status: 'none' }, 150000, '2026-06-18')
    const bt = cardFreeDate({ balance_cents: 740076, apr_bps: 1800, bt_status: 'active' }, 150000, '2026-06-18')
    expect(bt.months!).toBeLessThanOrEqual(noBt.months!)
    // BT clears 740076 at 150000/mo with no interest → ceil(740076/150000) = 5 months
    expect(bt.months).toBe(5)
  })

  it('returns 0 months and today when balance is already zero', () => {
    const r = cardFreeDate({ balance_cents: 0, apr_bps: 1800, bt_status: 'none' }, 100000, '2026-06-18')
    expect(r.months).toBe(0)
    expect(r.cardFreeISO).toBe('2026-06-18')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/__tests__/cardPayoff.test.ts`
Expected: FAIL — `Cannot find module '../cardPayoff'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/cardPayoff.ts
export interface CardLike {
  balance_cents: number
  apr_bps: number
  bt_status: 'none' | 'applied' | 'active' | 'declined'
}

// §5: monthly interest = balance × apr_bps / 120000. RM0 while BT active.
export function cardMonthlyInterestCents(card: CardLike): number {
  if (card.bt_status === 'active') return 0
  return Math.floor((card.balance_cents * card.apr_bps) / 120000)
}

function addMonthsISO(fromISO: string, months: number): string {
  const [y, m, d] = fromISO.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1 + months, 1))
  const ty = base.getUTCFullYear()
  const tm = base.getUTCMonth() + 1
  // clamp original day to the target month's length
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${ty}-${String(tm).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// §5: single strategy, one loop. Apply interest (unless BT active) then the monthly payment.
export function cardFreeDate(
  card: CardLike,
  monthlyPaymentCents: number,
  fromISO: string,
): { months: number | null; cardFreeISO: string | null } {
  if (card.balance_cents <= 0) return { months: 0, cardFreeISO: fromISO }

  let balance = card.balance_cents
  const btActive = card.bt_status === 'active'
  const MAX_MONTHS = 600 // 50-year safety cap → never-clears guard

  for (let month = 1; month <= MAX_MONTHS; month++) {
    if (!btActive) {
      balance += Math.floor((balance * card.apr_bps) / 120000) // accrue interest first
    }
    balance -= monthlyPaymentCents
    if (balance <= 0) {
      return { months: month, cardFreeISO: addMonthsISO(fromISO, month) }
    }
  }
  return { months: null, cardFreeISO: null } // payment never beats interest
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/__tests__/cardPayoff.test.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/cardPayoff.ts server/utils/__tests__/cardPayoff.test.ts
git commit -m "feat(debt): card monthly interest + single card-free date loop, BT-aware (§5)"
```

---

### Task 3.7: `payoffProgress` + `btRecommendation` — clamped baseline progress and BT-first gating (§5 + §14 #3)

**Files:**
- Create: `server/utils/payoff.ts`
- Test: `server/utils/__tests__/payoff.test.ts`

**Interfaces:**
- Consumes: `CardLike` from `cardPayoff.ts`.
- Produces:
  ```ts
  // §14 #3: progress = clamp((baseline − current)/baseline, 0, 1). Guards null/0 baseline → 0.
  export function payoffProgress(baselineCents: number | null | undefined, currentCents: number): number
  type BtRecommendation = 'attempt_bt' | 'route_surplus_inside_promo' | 'avalanche_18pct'
  // §5 gated plan: 'none'/'applied' → attempt the 0% conversion first; 'active' → clear inside promo;
  // 'declined' → fall back to 18% avalanche.
  export function btRecommendation(btStatus: CardLike['bt_status']): BtRecommendation
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/__tests__/payoff.test.ts
import { describe, it, expect } from 'vitest'
import { payoffProgress, btRecommendation } from '../payoff'

describe('payoffProgress', () => {
  it('is (baseline − current)/baseline', () => {
    // baseline 740076, current 370038 → 0.5
    expect(payoffProgress(740076, 370038)).toBeCloseTo(0.5, 5)
  })
  it('clamps to 0 when current exceeds baseline (post-interest drift, §14 #3)', () => {
    expect(payoffProgress(740076, 800000)).toBe(0)
  })
  it('clamps to 1 when the card is cleared', () => {
    expect(payoffProgress(740076, 0)).toBe(1)
  })
  it('returns 0 for a null/zero baseline instead of NaN', () => {
    expect(payoffProgress(null, 100)).toBe(0)
    expect(payoffProgress(0, 100)).toBe(0)
    expect(payoffProgress(undefined, 100)).toBe(0)
  })
})

describe('btRecommendation', () => {
  it('attempts the 0% BT first when none applied (Step 0, §5)', () => {
    expect(btRecommendation('none')).toBe('attempt_bt')
    expect(btRecommendation('applied')).toBe('attempt_bt')
  })
  it('routes surplus to clear inside the promo when BT active', () => {
    expect(btRecommendation('active')).toBe('route_surplus_inside_promo')
  })
  it('falls back to the 18% avalanche when declined', () => {
    expect(btRecommendation('declined')).toBe('avalanche_18pct')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/__tests__/payoff.test.ts`
Expected: FAIL — `Cannot find module '../payoff'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/payoff.ts
import type { CardLike } from './cardPayoff'

// §14 #3: frozen baseline; clamp guards null/0 (→0) and post-interest drift (current > baseline → 0).
export function payoffProgress(baselineCents: number | null | undefined, currentCents: number): number {
  if (!baselineCents || baselineCents <= 0) return 0
  const raw = (baselineCents - currentCents) / baselineCents
  return Math.min(1, Math.max(0, raw))
}

export type BtRecommendation = 'attempt_bt' | 'route_surplus_inside_promo' | 'avalanche_18pct'

// §5 gated plan, Step 0 first.
export function btRecommendation(btStatus: CardLike['bt_status']): BtRecommendation {
  switch (btStatus) {
    case 'active':
      return 'route_surplus_inside_promo'
    case 'declined':
      return 'avalanche_18pct'
    case 'none':
    case 'applied':
    default:
      return 'attempt_bt'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/__tests__/payoff.test.ts`
Expected: PASS (7 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/payoff.ts server/utils/__tests__/payoff.test.ts
git commit -m "feat(debt): clamped payoff progress + BT-first gated recommendation (§5, §14 #3)"
```

---

### Task 3.8: `GET /api/forecast` — STS + monthly rollup handler (§4)

**Files:**
- Create: `server/api/forecast.get.ts`
- Test: `server/api/__tests__/forecast.get.test.ts`

**Interfaces:**
- Consumes: `requireSession` from `server/utils/requireSession.ts`; `db` from `server/db/index.ts`; `cashNowCents`, `committedOutflowsBeforeCents`, `spentTodayVariableCents`, `savingsTargetRemainingCents` from `forecastReads.ts`; `nextInflowDate` from `nextInflow.ts`; `computeSafeToSpend` from `safeToSpend.ts`; `computeMonthlyRollup` from `monthlyRollup.ts`; `todayMYT` from `mytDate.ts`; `getQuery`, `defineEventHandler` from `h3`.
- Produces: `GET /api/forecast` (`requireSession`-gated, read-only) returning:
  ```ts
  interface ForecastResponse {
    sts: StsResult                  // from computeSafeToSpend
    rollup: MonthlyRollup           // from computeMonthlyRollup (current MYT month)
    cashNowCents: number
    todayISO: string
  }
  ```
  Accepts optional `?today=YYYY-MM-DD` (defaults to `todayMYT()`) and `?savingsTargetRemaining=<sen>` (defaults to the computed current-cycle figure) so the client and tests can drive deterministic dates.

- [ ] **Step 1: Write the failing test**

```ts
// server/api/__tests__/forecast.get.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock requireSession to a no-op authenticated session (auth is exercised in the auth phase).
vi.mock('../../utils/requireSession', () => ({
  requireSession: () => ({ id: 'sess-1', userId: 1 }),
}))

// Mock the ledger reads + db so the handler is exercised in isolation.
vi.mock('../../db', () => ({ db: {} }))
vi.mock('../../utils/forecastReads', () => ({
  cashNowCents: () => 80000,
  committedOutflowsBeforeCents: () => 20000,
  spentTodayVariableCents: () => 500,
  savingsTargetRemainingCents: () => 30000,
}))
vi.mock('../../utils/monthlyRollup', () => ({
  computeMonthlyRollup: () => ({
    incomeCents: 641950, livingCents: 183860, debtServiceCents: 90400,
    interestCents: 11101, rawSurplusCents: 367690, surplusAfterInterestCents: 356589,
  }),
}))

import handler from '../forecast.get'

function makeEvent(query: Record<string, string> = {}) {
  return { node: { req: {}, res: {} }, context: {}, _query: query } as any
}
// h3 getQuery reads from the URL; stub it via the event we pass.
vi.mock('h3', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return { ...actual, getQuery: (e: any) => e._query ?? {} }
})

describe('GET /api/forecast', () => {
  it('returns STS + rollup for the supplied MYT date', async () => {
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    // raw cycle = 80000 - 20000 - 30000 - 20000 = 10000; next inflow 23rd → 5 days
    expect(res.sts.cycleCents).toBe(10000)
    expect(res.sts.nextInflowISO).toBe('2026-06-23')
    expect(res.sts.daysToNextInflow).toBe(5)
    // daily = floor(10000/5) - 500 = 1500
    expect(res.sts.dailyCents).toBe(1500)
    expect(res.rollup.surplusAfterInterestCents).toBe(356589)
    expect(res.cashNowCents).toBe(80000)
    expect(res.todayISO).toBe('2026-06-18')
  })

  it('honors a caller-supplied savingsTargetRemaining override', async () => {
    const res = await handler(makeEvent({ today: '2026-06-18', savingsTargetRemaining: '0' }))
    // raw cycle = 80000 - 20000 - 0 - 20000 = 40000
    expect(res.sts.cycleCents).toBe(40000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/api/__tests__/forecast.get.test.ts`
Expected: FAIL — `Cannot find module '../forecast.get'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/api/forecast.get.ts
import { defineEventHandler, getQuery } from 'h3'
import { requireSession } from '../utils/requireSession'
import { db } from '../db'
import {
  cashNowCents,
  committedOutflowsBeforeCents,
  spentTodayVariableCents,
  savingsTargetRemainingCents,
} from '../utils/forecastReads'
import { nextInflowDate } from '../utils/nextInflow'
import { computeSafeToSpend } from '../utils/safeToSpend'
import { computeMonthlyRollup } from '../utils/monthlyRollup'
import { todayMYT } from '../utils/mytDate'

export default defineEventHandler((event) => {
  requireSession(event) // §14 #22: every server/api/** handler is session-gated

  const q = getQuery(event)
  const todayISO = typeof q.today === 'string' ? q.today : todayMYT()
  const nextInflowISO = nextInflowDate(todayISO)

  // §14 #8: current-cycle savings target; caller may override (Attack phase routes to card → 0).
  const savingsTargetRemainingCentsValue =
    typeof q.savingsTargetRemaining === 'string'
      ? Number(q.savingsTargetRemaining)
      : savingsTargetRemainingCents(db, todayISO, nextInflowISO)

  const sts = computeSafeToSpend({
    cashNowCents: cashNowCents(db),
    expectedInflowsBeforeNextCents: 0, // §4: usually 0
    committedOutflowsCents: committedOutflowsBeforeCents(db, todayISO, nextInflowISO),
    savingsTargetRemainingCents: savingsTargetRemainingCentsValue,
    spentTodayVariableCents: spentTodayVariableCents(db, todayISO),
    todayISO,
  })

  const rollup = computeMonthlyRollup(db, todayISO.slice(0, 7)) // 'YYYY-MM'

  return { sts, rollup, cashNowCents: cashNowCents(db), todayISO }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/api/__tests__/forecast.get.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
git add server/api/forecast.get.ts server/api/__tests__/forecast.get.test.ts
git commit -m "feat(api): GET /api/forecast — STS + monthly rollup, session-gated (§4)"
```

---

### Task 3.9: `GET /api/debt` — card balance, interest, derived available credit, card-free date, BT recommendation (§5 + §14 #2, #3)

**Files:**
- Create: `server/api/debt.get.ts`
- Test: `server/api/__tests__/debt.get.test.ts`

**Interfaces:**
- Consumes: `requireSession`; `db`; `accounts`, `debts` from schema; `cardMonthlyInterestCents`, `cardFreeDate` from `cardPayoff.ts`; `payoffProgress`, `btRecommendation` from `payoff.ts`; `computeMonthlyRollup` from `monthlyRollup.ts`; `todayMYT` from `mytDate.ts`; `CARD_UTIL_WARN`, `CARD_UTIL_DECLINE` from `forecastConstants.ts`; Drizzle `eq` from `drizzle-orm`.
- Produces: `GET /api/debt` (`requireSession`-gated, read-only) returning:
  ```ts
  interface DebtResponse {
    cardBalanceCents: number
    creditLimitCents: number
    availableCreditCents: number   // §14 #2 DERIVED: limit − balance (clamped ≥ 0)
    utilization: number            // balance / limit
    utilWarn: boolean              // ≥ CARD_UTIL_WARN
    utilDecline: boolean           // ≥ CARD_UTIL_DECLINE — "card maxed, charges decline"
    monthlyInterestCents: number   // ~11101 (RM111) or 0 under active BT
    btStatus: 'none' | 'applied' | 'active' | 'declined'
    btRecommendation: 'attempt_bt' | 'route_surplus_inside_promo' | 'avalanche_18pct'
    payoffProgress: number         // clamp((baseline − current)/baseline, 0, 1)
    cardFreeISO: string | null
    cardFreeMonths: number | null
  }
  ```
  Card-free date is computed from this month's `surplusAfterInterestCents` (the surplus routed at the card). Accepts optional `?today=YYYY-MM-DD`.

- [ ] **Step 1: Write the failing test**

```ts
// server/api/__tests__/debt.get.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../utils/requireSession', () => ({ requireSession: () => ({ id: 's', userId: 1 }) }))
vi.mock('../../db', () => ({ db: {} }))
vi.mock('h3', async (orig) => {
  const actual = await (orig() as Promise<any>)
  return { ...actual, getQuery: (e: any) => e._query ?? {} }
})

// The card debt + card account read is wrapped in a helper so we mock that helper.
vi.mock('../../utils/debtReads', () => ({
  readCard: () => ({
    debt: { balance_cents: 740076, apr_bps: 1800, bt_status: 'none', payoff_baseline_cents: 740076 },
    account: { credit_limit_cents: 798740 },
  }),
}))
vi.mock('../../utils/monthlyRollup', () => ({
  computeMonthlyRollup: () => ({ surplusAfterInterestCents: 220000 } as any),
}))

import handler from '../debt.get'
const makeEvent = (query: Record<string, string> = {}) => ({ _query: query } as any)

describe('GET /api/debt', () => {
  it('derives available credit (§14 #2) and flags utilization', async () => {
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    expect(res.cardBalanceCents).toBe(740076)
    expect(res.creditLimitCents).toBe(798740)
    // 798740 − 740076 = 58664 (RM586.64) — matches the seed avail
    expect(res.availableCreditCents).toBe(58664)
    expect(res.utilWarn).toBe(true)       // 740076/798740 ≈ 0.927 ≥ 0.90
    expect(res.utilDecline).toBe(false)   // < 1.00
  })

  it('reports ~RM111 monthly interest and a single card-free date (no BT)', async () => {
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    expect(res.monthlyInterestCents).toBe(11101)
    expect(res.cardFreeMonths).toBeGreaterThan(0)
    expect(res.cardFreeMonths).toBeLessThanOrEqual(6)
    expect(res.cardFreeISO).toMatch(/^2026-\d{2}-\d{2}$/)
  })

  it('recommends attempting the BT first (Step 0) and reports clamped progress', async () => {
    const res = await handler(makeEvent({ today: '2026-06-18' }))
    expect(res.btRecommendation).toBe('attempt_bt')
    // baseline 740076, current 740076 → progress 0
    expect(res.payoffProgress).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/api/__tests__/debt.get.test.ts`
Expected: FAIL — `Cannot find module '../debt.get'` (and `../../utils/debtReads`).

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/debtReads.ts
import { eq } from 'drizzle-orm'
import { accounts, debts } from '../db/schema'

type DB = any

// The card is modelled twice (§3): a debts row (APR/payoff) + an accounts row (limit/utilisation), linked.
export function readCard(db: DB): {
  debt: { balance_cents: number; apr_bps: number; bt_status: 'none' | 'applied' | 'active' | 'declined'; payoff_baseline_cents: number | null }
  account: { credit_limit_cents: number | null }
} {
  const debt = db.select().from(debts).where(eq(debts.type, 'revolving')).get()
  const account = db.select().from(accounts).where(eq(accounts.debt_id, debt.id)).get()
  return { debt, account }
}
```

```ts
// server/api/debt.get.ts
import { defineEventHandler, getQuery } from 'h3'
import { requireSession } from '../utils/requireSession'
import { db } from '../db'
import { readCard } from '../utils/debtReads'
import { cardMonthlyInterestCents, cardFreeDate } from '../utils/cardPayoff'
import { payoffProgress, btRecommendation } from '../utils/payoff'
import { computeMonthlyRollup } from '../utils/monthlyRollup'
import { todayMYT } from '../utils/mytDate'
import { CARD_UTIL_WARN, CARD_UTIL_DECLINE } from '../utils/forecastConstants'

export default defineEventHandler((event) => {
  requireSession(event)

  const q = getQuery(event)
  const todayISO = typeof q.today === 'string' ? q.today : todayMYT()

  const { debt, account } = readCard(db)
  const cardBalanceCents = debt.balance_cents
  const creditLimitCents = account.credit_limit_cents ?? 0

  // §14 #2: available credit is DERIVED at read time — never seeded.
  const availableCreditCents = Math.max(0, creditLimitCents - cardBalanceCents)
  const utilization = creditLimitCents > 0 ? cardBalanceCents / creditLimitCents : 0

  const monthlyInterestCents = cardMonthlyInterestCents({
    balance_cents: cardBalanceCents,
    apr_bps: debt.apr_bps,
    bt_status: debt.bt_status,
  })

  // Surplus routed at the card = this month's after-interest surplus (the §4 rollup figure).
  const monthlyPaymentCents = computeMonthlyRollup(db, todayISO.slice(0, 7)).surplusAfterInterestCents
  const { months: cardFreeMonths, cardFreeISO } = cardFreeDate(
    { balance_cents: cardBalanceCents, apr_bps: debt.apr_bps, bt_status: debt.bt_status },
    monthlyPaymentCents,
    todayISO,
  )

  return {
    cardBalanceCents,
    creditLimitCents,
    availableCreditCents,
    utilization,
    utilWarn: utilization >= CARD_UTIL_WARN,
    utilDecline: utilization >= CARD_UTIL_DECLINE,
    monthlyInterestCents,
    btStatus: debt.bt_status,
    btRecommendation: btRecommendation(debt.bt_status),
    payoffProgress: payoffProgress(debt.payoff_baseline_cents, cardBalanceCents),
    cardFreeISO,
    cardFreeMonths,
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/api/__tests__/debt.get.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/debtReads.ts server/api/debt.get.ts server/api/__tests__/debt.get.test.ts
git commit -m "feat(api): GET /api/debt — derived available credit, interest, card-free date, BT-first (§5, §14 #2/#3)"
```

---

### Task 3.10: `GET /api/goals/progress` — EF (from ledger) + Kill-Card (from baseline) (§7 + §14 #3, #13, #16)

**Files:**
- Create: `server/utils/goalReads.ts`
- Create: `server/api/goals/progress.get.ts`
- Test: `server/utils/__tests__/goalReads.test.ts`
- Test: `server/api/__tests__/goals-progress.get.test.ts`

**Interfaces:**
- Consumes: `requireSession`; `db`; `accounts`, `transactions`, `goals`, `debts` from schema; `payoffProgress` from `payoff.ts`; Drizzle `eq`, `and`, `or`, `sql` from `drizzle-orm`.
- Produces:
  ```ts
  // EF balance = both legs of every transfer touching the EF account (§14 #13: two-leg atomic).
  export function efBalanceCents(db: DB, efAccountId: number): number
  ```
  and `GET /api/goals/progress` (`requireSession`-gated) returning:
  ```ts
  interface GoalsProgressResponse {
    ef: { currentCents: number; targetCents: number; progress: number }        // savings goal
    killCard: { currentCents: number; baselineCents: number; progress: number } // debt_payoff goal
  }
  ```
  EF progress = `clamp(currentCents / targetCents, 0, 1)`; Kill-Card progress via `payoffProgress(baseline, current)`.

- [ ] **Step 1: Write the failing test (util)**

```ts
// server/utils/__tests__/goalReads.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { transactions } from '../../db/schema'
import { efBalanceCents } from '../goalReads'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE,
      date TEXT NOT NULL, amount_cents INTEGER NOT NULL, direction TEXT NOT NULL, category TEXT NOT NULL,
      account_id INTEGER NOT NULL, counter_account_id INTEGER, debt_id INTEGER, goal_id INTEGER,
      note TEXT, source TEXT NOT NULL, recurring_item_id INTEGER, is_estimate INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL);
  `)
  return drizzle(sqlite)
}
let db: ReturnType<typeof makeDb>
beforeEach(() => { db = makeDb() })

describe('efBalanceCents', () => {
  it('sums every leg landing on the EF account (account_id or counter_account_id)', () => {
    const EF = 5
    db.insert(transactions).values([
      // transfer into EF: positive leg on the EF account
      { uuid: 't1', date: '2026-06-18', amount_cents: 50000, direction: 'transfer', category: 'savings',
        account_id: EF, counter_account_id: 1, source: 'manual', created_at: 1 },
      // an unrelated cash expense — must not count
      { uuid: 'x1', date: '2026-06-18', amount_cents: -1500, direction: 'expense', category: 'food',
        account_id: 1, source: 'manual', created_at: 1 },
      // another EF top-up
      { uuid: 't2', date: '2026-06-23', amount_cents: 30000, direction: 'transfer', category: 'savings',
        account_id: EF, counter_account_id: 1, source: 'manual', created_at: 1 },
    ]).run()
    expect(efBalanceCents(db, EF)).toBe(80000)
  })

  it('nets a withdrawal leg back out of the EF account', () => {
    const EF = 5
    db.insert(transactions).values([
      { uuid: 't1', date: '2026-06-18', amount_cents: 50000, direction: 'transfer', category: 'savings',
        account_id: EF, counter_account_id: 1, source: 'manual', created_at: 1 },
      { uuid: 't2', date: '2026-06-20', amount_cents: -20000, direction: 'transfer', category: 'savings',
        account_id: EF, counter_account_id: 1, source: 'manual', created_at: 1 },
    ]).run()
    expect(efBalanceCents(db, EF)).toBe(30000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/__tests__/goalReads.test.ts`
Expected: FAIL — `Cannot find module '../goalReads'`.

- [ ] **Step 3: Write minimal implementation (util)**

```ts
// server/utils/goalReads.ts
import { eq, sql } from 'drizzle-orm'
import { transactions } from '../db/schema'

type DB = any

// §7/§14 #13: EF is a real savings account; progress = sum of every ledger leg on that account.
// (Transfers write a positive leg with account_id = EF; withdrawals a negative leg.)
export function efBalanceCents(db: DB, efAccountId: number): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${transactions.amount_cents}), 0)` })
    .from(transactions)
    .where(eq(transactions.account_id, efAccountId))
    .get()
  return Number(row?.total ?? 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/__tests__/goalReads.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 5: Write the failing test (handler)**

```ts
// server/api/__tests__/goals-progress.get.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../utils/requireSession', () => ({ requireSession: () => ({ id: 's', userId: 1 }) }))
vi.mock('../../db', () => ({ db: {} }))

// goalRows helper returns the two seeded goals + their linked account/debt facts.
vi.mock('../../utils/goalReads', () => ({
  efBalanceCents: () => 80000, // RM800 ring-fenced so far
  readGoals: () => ({
    ef: { accountId: 5, targetCents: 100000 },               // §14 #16 starter RM1,000
    killCard: { baselineCents: 740076, currentCents: 555057 }, // 25% paid down
  }),
}))

import handler from '../goals/progress.get'
const makeEvent = () => ({} as any)

describe('GET /api/goals/progress', () => {
  it('EF progress derives from the ledger / starter target', async () => {
    const res = await handler(makeEvent())
    expect(res.ef.currentCents).toBe(80000)
    expect(res.ef.targetCents).toBe(100000)
    expect(res.ef.progress).toBeCloseTo(0.8, 5) // 80000/100000
  })

  it('Kill-Card progress derives from the frozen baseline (§14 #3)', async () => {
    const res = await handler(makeEvent())
    expect(res.killCard.baselineCents).toBe(740076)
    // (740076 − 555057)/740076 ≈ 0.25
    expect(res.killCard.progress).toBeCloseTo(0.25, 2)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run server/api/__tests__/goals-progress.get.test.ts`
Expected: FAIL — `Cannot find module '../goals/progress.get'` (and missing `readGoals`).

- [ ] **Step 7: Write minimal implementation (handler + readGoals)**

```ts
// server/utils/goalReads.ts  — append readGoals to the existing file
import { eq, and } from 'drizzle-orm'
import { goals, debts } from '../db/schema'

// (efBalanceCents above stays unchanged.)
export function readGoals(db: DB): {
  ef: { accountId: number; targetCents: number }
  killCard: { baselineCents: number; currentCents: number }
} {
  const efGoal = db.select().from(goals).where(eq(goals.type, 'savings')).get()
  const cardGoal = db.select().from(goals).where(eq(goals.type, 'debt_payoff')).get()
  const cardDebt = db.select().from(debts).where(eq(debts.id, cardGoal.debt_id)).get()
  return {
    ef: { accountId: efGoal.account_id, targetCents: efGoal.target_amount_cents },
    killCard: {
      baselineCents: cardDebt.payoff_baseline_cents ?? 0,
      currentCents: cardDebt.balance_cents,
    },
  }
}
```

```ts
// server/api/goals/progress.get.ts
import { defineEventHandler } from 'h3'
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db'
import { efBalanceCents, readGoals } from '../../utils/goalReads'
import { payoffProgress } from '../../utils/payoff'

export default defineEventHandler((event) => {
  requireSession(event)

  const { ef, killCard } = readGoals(db)
  const efCurrent = efBalanceCents(db, ef.accountId)
  const efProgress = ef.targetCents > 0 ? Math.min(1, Math.max(0, efCurrent / ef.targetCents)) : 0

  return {
    ef: { currentCents: efCurrent, targetCents: ef.targetCents, progress: efProgress },
    killCard: {
      currentCents: killCard.currentCents,
      baselineCents: killCard.baselineCents,
      progress: payoffProgress(killCard.baselineCents, killCard.currentCents),
    },
  }
})
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `npx vitest run server/utils/__tests__/goalReads.test.ts server/api/__tests__/goals-progress.get.test.ts`
Expected: PASS (4 passing total).

- [ ] **Step 9: Commit**

```bash
git add server/utils/goalReads.ts server/api/goals/progress.get.ts server/utils/__tests__/goalReads.test.ts server/api/__tests__/goals-progress.get.test.ts
git commit -m "feat(api): GET /api/goals/progress — EF from ledger, Kill-Card from baseline (§7, §14 #3/#13/#16)"
```

---

### Task 3.11: `useSafeToSpend` composable — client STS mirror, recomputes on every quick-log (§4 + §14 #20)

**Files:**
- Create: `app/composables/useSafeToSpend.ts`
- Test: `app/composables/__tests__/useSafeToSpend.test.ts`

**Interfaces:**
- Consumes: `computeSafeToSpend`, `StsResult`, `StsInput` — re-exported from `server/utils/safeToSpend.ts` via `shared/types.ts` so client and server share **one** formula (no duplicate math); `formatRM` from `server/utils/money.ts` (also re-exported through `shared`); Vue `ref`, `computed`.
- Produces:
  ```ts
  export function useSafeToSpend(seed: () => StsInput): {
    sts: ComputedRef<StsResult>            // recomputed reactively from the seed
    heroLabel: ComputedRef<string>         // "Safe to spend until 23 Jun: RM100.00" | "RM0 — RM450.00 short"
    registerSpend: (cents: number) => void // optimistic: bump spentTodayVariableCents for the current MYT day
    spentTodayCents: Ref<number>
  }
  ```
  `registerSpend` lets a quick-log optimistically reduce daily STS before the server round-trips (§4: "STS recomputes live on every logged transaction"; §14 #20: keyed on the client MYT date the seed supplies).

- [ ] **Step 1: Write the failing test**

```ts
// app/composables/__tests__/useSafeToSpend.test.ts
import { describe, it, expect } from 'vitest'
import { useSafeToSpend } from '../useSafeToSpend'

const baseSeed = () => ({
  cashNowCents: 80000,
  expectedInflowsBeforeNextCents: 0,
  committedOutflowsCents: 20000,
  savingsTargetRemainingCents: 30000,
  spentTodayVariableCents: 0,
  todayISO: '2026-06-18',
})

describe('useSafeToSpend', () => {
  it('computes the same STS_cycle as the server formula', () => {
    const { sts } = useSafeToSpend(baseSeed)
    expect(sts.value.cycleCents).toBe(10000)
    expect(sts.value.nextInflowISO).toBe('2026-06-23')
  })

  it('formats the hero label with the next-inflow date', () => {
    const { heroLabel } = useSafeToSpend(baseSeed)
    expect(heroLabel.value).toBe('Safe to spend until 23 Jun: RM100.00')
  })

  it('shows RM0 + shortfall in the label when committed past the buffer', () => {
    const seed = () => ({ ...baseSeed(), cashNowCents: 5000, savingsTargetRemainingCents: 0 })
    // raw cycle = 5000 - 20000 - 0 - 20000 = -35000
    const { heroLabel, sts } = useSafeToSpend(seed)
    expect(sts.value.isNegative).toBe(true)
    expect(heroLabel.value).toBe('RM0 — RM350.00 short')
  })

  it('registerSpend optimistically reduces STS_daily without a server round-trip', () => {
    const { sts, registerSpend, spentTodayCents } = useSafeToSpend(baseSeed)
    const before = sts.value.dailyCents // floor(10000/5) - 0 = 2000
    expect(before).toBe(2000)
    registerSpend(500)
    expect(spentTodayCents.value).toBe(500)
    expect(sts.value.dailyCents).toBe(1500) // 2000 - 500
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/composables/__tests__/useSafeToSpend.test.ts`
Expected: FAIL — `Cannot find module '../useSafeToSpend'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// shared/types.ts — re-export the shared STS contract so client & server use ONE formula.
export { computeSafeToSpend } from '../server/utils/safeToSpend'
export type { StsInput, StsResult } from '../server/utils/safeToSpend'
export { formatRM } from '../server/utils/money'
```

```ts
// app/composables/useSafeToSpend.ts
import { ref, computed, type ComputedRef, type Ref } from 'vue'
import { computeSafeToSpend, formatRM, type StsInput, type StsResult } from '~/../shared/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

export function useSafeToSpend(seed: () => StsInput): {
  sts: ComputedRef<StsResult>
  heroLabel: ComputedRef<string>
  registerSpend: (cents: number) => void
  spentTodayCents: Ref<number>
} {
  const spentTodayCents = ref(0)

  const sts = computed<StsResult>(() => {
    const base = seed()
    // §14 #20: spent_today is keyed on the client MYT date the seed carries; add optimistic local spend.
    return computeSafeToSpend({
      ...base,
      spentTodayVariableCents: base.spentTodayVariableCents + spentTodayCents.value,
    })
  })

  const heroLabel = computed(() => {
    const s = sts.value
    if (s.isNegative) {
      return `RM0 — ${formatRM(s.shortfallCents)} short`
    }
    return `Safe to spend until ${shortDate(s.nextInflowISO)}: ${formatRM(s.cycleCents)}`
  })

  function registerSpend(cents: number) {
    spentTodayCents.value += cents
  }

  return { sts, heroLabel, registerSpend, spentTodayCents }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/composables/__tests__/useSafeToSpend.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts app/composables/useSafeToSpend.ts app/composables/__tests__/useSafeToSpend.test.ts
git commit -m "feat(client): useSafeToSpend — shared STS formula, optimistic registerSpend (§4, §14 #20)"
```

---

### Task 3.12: Dashboard page — wire hero + rollup + debt + EF progress (§4, §5, §7)

**Files:**
- Create: `app/pages/index.vue`
- Create: `app/components/forecast/SafeToSpendHero.vue`
- Create: `app/components/forecast/SurplusRollup.vue`
- Create: `app/components/debt/CardDebtCard.vue`
- Create: `app/components/forecast/GoalProgressBar.vue`
- Test: `app/components/__tests__/SafeToSpendHero.test.ts`
- Test: `app/components/__tests__/CardDebtCard.test.ts`

**Interfaces:**
- Consumes: `useSafeToSpend` from `app/composables/useSafeToSpend.ts`; `formatRM`, `StsResult` from `shared/types.ts`; the `GET /api/forecast`, `GET /api/debt`, `GET /api/goals/progress` responses (Tasks 3.8–3.10) via `useFetch`; Vue Test Utils `mount`.
- Produces: the dashboard at route `/` rendering the STS hero (with `STS_weekly`/`STS_daily` chips), the surplus rollup ("you cleared RMx but it didn't land in savings" when `surplus > 0` and Δcash ≤ 0), the card-debt card (balance, interest or "RM0 under BT", card-free date, BT recommendation, hard "card maxed" flag on `utilDecline`), and EF + Kill-Card progress bars.

- [ ] **Step 1: Write the failing component tests**

```ts
// app/components/__tests__/SafeToSpendHero.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SafeToSpendHero from '../forecast/SafeToSpendHero.vue'

const positiveSts = {
  cycleCents: 10000, dailyCents: 2000, weeklyCents: 10000, isNegative: false,
  shortfallCents: 0, nextInflowISO: '2026-06-23', daysToNextInflow: 5,
}

describe('SafeToSpendHero', () => {
  it('renders the cycle hero and the daily/weekly chips', () => {
    const w = mount(SafeToSpendHero, { props: { sts: positiveSts } })
    expect(w.text()).toContain('Safe to spend until 23 Jun')
    expect(w.text()).toContain('RM100.00')   // cycle
    expect(w.text()).toContain('RM20.00')    // daily chip
  })

  it('renders RM0 in red with the shortfall when negative', () => {
    const negSts = { ...positiveSts, cycleCents: 0, isNegative: true, shortfallCents: 35000 }
    const w = mount(SafeToSpendHero, { props: { sts: negSts } })
    expect(w.text()).toContain('RM0')
    expect(w.text()).toContain('RM350.00 short')
    expect(w.find('[data-testid="sts-negative"]').exists()).toBe(true)
  })
})
```

```ts
// app/components/__tests__/CardDebtCard.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CardDebtCard from '../debt/CardDebtCard.vue'

const debt = {
  cardBalanceCents: 740076, creditLimitCents: 798740, availableCreditCents: 58664,
  utilization: 0.927, utilWarn: true, utilDecline: false, monthlyInterestCents: 11101,
  btStatus: 'none' as const, btRecommendation: 'attempt_bt' as const,
  payoffProgress: 0, cardFreeISO: '2026-11-18', cardFreeMonths: 5,
}

describe('CardDebtCard', () => {
  it('shows balance, ~RM111 interest and the single card-free date', () => {
    const w = mount(CardDebtCard, { props: { debt } })
    expect(w.text()).toContain('RM7,400.76')  // balance
    expect(w.text()).toContain('RM111.01')     // monthly interest
    expect(w.text()).toContain('card-free')
  })

  it('shows RM0 interest and a "clear inside promo" line under an active BT', () => {
    const bt = { ...debt, monthlyInterestCents: 0, btStatus: 'active' as const, btRecommendation: 'route_surplus_inside_promo' as const }
    const w = mount(CardDebtCard, { props: { debt: bt } })
    expect(w.text()).toContain('RM0')
    expect(w.text()).toContain('promo')
  })

  it('surfaces the hard "card maxed" flag when utilDecline is true', () => {
    const maxed = { ...debt, utilDecline: true }
    const w = mount(CardDebtCard, { props: { debt: maxed } })
    expect(w.find('[data-testid="card-maxed"]').exists()).toBe(true)
    expect(w.text()).toContain('charges will decline')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/components/__tests__/SafeToSpendHero.test.ts app/components/__tests__/CardDebtCard.test.ts`
Expected: FAIL — cannot find the two `.vue` components.

- [ ] **Step 3: Write the hero + card-debt components**

```vue
<!-- app/components/forecast/SafeToSpendHero.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { formatRM, type StsResult } from '~/../shared/types'

const props = defineProps<{ sts: StsResult }>()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const untilLabel = computed(() => {
  const [, m, d] = props.sts.nextInflowISO.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
})
</script>

<template>
  <section class="sts-hero">
    <template v-if="sts.isNegative">
      <p data-testid="sts-negative" class="sts-hero__negative" style="color: #c0392b">
        RM0 — {{ formatRM(sts.shortfallCents) }} short
      </p>
      <p class="sts-hero__sub">You're already committed past your buffer this cycle.</p>
    </template>
    <template v-else>
      <p class="sts-hero__label">Safe to spend until {{ untilLabel }}</p>
      <p class="sts-hero__amount">{{ formatRM(sts.cycleCents) }}</p>
      <div class="sts-hero__chips">
        <span class="chip">{{ formatRM(sts.dailyCents) }}/day</span>
        <span class="chip">{{ formatRM(sts.weeklyCents) }}/week</span>
      </div>
    </template>
  </section>
</template>
```

```vue
<!-- app/components/debt/CardDebtCard.vue -->
<script setup lang="ts">
import { formatRM } from '~/../shared/types'

interface DebtView {
  cardBalanceCents: number
  creditLimitCents: number
  availableCreditCents: number
  utilization: number
  utilWarn: boolean
  utilDecline: boolean
  monthlyInterestCents: number
  btStatus: 'none' | 'applied' | 'active' | 'declined'
  btRecommendation: 'attempt_bt' | 'route_surplus_inside_promo' | 'avalanche_18pct'
  payoffProgress: number
  cardFreeISO: string | null
  cardFreeMonths: number | null
}
const props = defineProps<{ debt: DebtView }>()

const REC_COPY: Record<DebtView['btRecommendation'], string> = {
  attempt_bt: 'Convert/transfer the full balance to a 0% (or lowest-rate) plan first.',
  route_surplus_inside_promo: 'BT active — clear it inside the promo window before it rolls back to 18%.',
  avalanche_18pct: 'BT declined — throw all surplus at the 18% card (avalanche).',
}
</script>

<template>
  <section class="card-debt">
    <h2>Credit Card</h2>
    <p class="card-debt__balance">{{ formatRM(debt.cardBalanceCents) }}</p>
    <p>Available credit: {{ formatRM(debt.availableCreditCents) }}</p>

    <p v-if="debt.monthlyInterestCents > 0">Monthly interest: {{ formatRM(debt.monthlyInterestCents) }}</p>
    <p v-else>Monthly interest: RM0 (under balance transfer)</p>

    <p v-if="debt.cardFreeISO">Projected card-free: {{ debt.cardFreeISO }} ({{ debt.cardFreeMonths }} mo)</p>
    <p v-else>Card-free date: payment too low to clear — increase the amount routed to the card.</p>

    <p class="card-debt__rec">{{ REC_COPY[debt.btRecommendation] }}</p>

    <p v-if="debt.utilDecline" data-testid="card-maxed" style="color: #c0392b">
      Card maxed — charges will decline.
    </p>
    <p v-else-if="debt.utilWarn" style="color: #d68910">
      Utilisation over 90% — close to the limit.
    </p>
  </section>
</template>
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `npx vitest run app/components/__tests__/SafeToSpendHero.test.ts app/components/__tests__/CardDebtCard.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Write the rollup + goal-progress components and the page that wires everything**

```vue
<!-- app/components/forecast/GoalProgressBar.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { formatRM } from '~/../shared/types'

const props = defineProps<{ label: string; currentCents: number; targetCents: number; progress: number }>()
const pct = computed(() => Math.round(props.progress * 100))
</script>

<template>
  <div class="goal-progress">
    <p class="goal-progress__label">{{ label }}: {{ formatRM(currentCents) }} / {{ formatRM(targetCents) }} ({{ pct }}%)</p>
    <div class="goal-progress__track">
      <div class="goal-progress__fill" :style="{ width: pct + '%' }" />
    </div>
  </div>
</template>
```

```vue
<!-- app/components/forecast/SurplusRollup.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { formatRM } from '~/../shared/types'

interface Rollup {
  incomeCents: number; livingCents: number; debtServiceCents: number
  interestCents: number; rawSurplusCents: number; surplusAfterInterestCents: number
}
const props = defineProps<{ rollup: Rollup; deltaCashCents: number }>()

// §4: surplus exists but leaks — flag when surplus is positive yet cash didn't rise.
const leaking = computed(() => props.rollup.rawSurplusCents > 0 && props.deltaCashCents <= 0)
</script>

<template>
  <section class="surplus-rollup">
    <h2>This month</h2>
    <p>Income: {{ formatRM(rollup.incomeCents) }}</p>
    <p>Living: {{ formatRM(rollup.livingCents) }}</p>
    <p>Debt service: {{ formatRM(rollup.debtServiceCents) }}</p>
    <p>Card interest (carrying cost): {{ formatRM(rollup.interestCents) }}</p>
    <p class="surplus-rollup__surplus">
      Surplus after interest: {{ formatRM(rollup.surplusAfterInterestCents) }}
    </p>
    <p v-if="leaking" class="surplus-rollup__leak" style="color: #d68910">
      You cleared {{ formatRM(rollup.rawSurplusCents) }} but it didn't land in savings.
    </p>
  </section>
</template>
```

```vue
<!-- app/pages/index.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import SafeToSpendHero from '~/components/forecast/SafeToSpendHero.vue'
import SurplusRollup from '~/components/forecast/SurplusRollup.vue'
import CardDebtCard from '~/components/debt/CardDebtCard.vue'
import GoalProgressBar from '~/components/forecast/GoalProgressBar.vue'

// Read views are online-first with last-known-good cached fallback (§6).
const { data: forecast } = await useFetch('/api/forecast')
const { data: debt } = await useFetch('/api/debt')
const { data: goals } = await useFetch('/api/goals/progress')

// Δcash this month is not yet a dedicated endpoint in v1; surplus-leak flag uses 0 as the conservative default.
const deltaCashCents = computed(() => 0)
</script>

<template>
  <main class="dashboard">
    <SafeToSpendHero v-if="forecast" :sts="forecast.sts" />
    <SurplusRollup v-if="forecast" :rollup="forecast.rollup" :delta-cash-cents="deltaCashCents" />
    <CardDebtCard v-if="debt" :debt="debt" />
    <GoalProgressBar
      v-if="goals"
      label="Emergency Fund"
      :current-cents="goals.ef.currentCents"
      :target-cents="goals.ef.targetCents"
      :progress="goals.ef.progress"
    />
    <GoalProgressBar
      v-if="goals"
      label="Kill Credit Card"
      :current-cents="goals.killCard.currentCents"
      :target-cents="goals.killCard.baselineCents"
      :progress="goals.killCard.progress"
    />
  </main>
</template>
```

- [ ] **Step 6: Run the full Phase-3 test suite to confirm nothing regressed**

Run: `npx vitest run server/utils server/api app/composables app/components`
Expected: PASS (all Phase-3 suites green).

- [ ] **Step 7: Commit**

```bash
git add app/pages/index.vue app/components/forecast/ app/components/debt/ app/components/__tests__/
git commit -m "feat(dashboard): wire STS hero + surplus rollup + debt card + EF/Kill-Card progress (§4/§5/§7)"
```

---

#### Phase deliverable & how to verify

**Deliverable:** opening `/` shows the Safe-to-Spend hero (cycle figure with daily/weekly chips, RM0-in-red with a shortfall line when over-committed, never a negative number), the monthly surplus rollup (income/living/debt_service with card interest broken out as a separate carrying cost and a "you cleared RMx but it didn't land in savings" leak flag), the credit-card debt card (balance, derived available credit, ~RM111/mo interest or RM0 under an active BT, a single projected card-free date, and the BT-first gated recommendation with the hard "card maxed — charges will decline" flag), and EF (from the ledger, RM1,000 starter target) + Kill-Card (from the frozen baseline) progress bars. `useSafeToSpend` recomputes STS live on every quick-log via `registerSpend`, sharing the exact server formula.

**How to verify:**
1. `npx vitest run server/utils server/api app/composables app/components` → all Phase-3 suites pass (forecastConstants, nextInflow, safeToSpend, forecastReads, monthlyRollup, cardPayoff, payoff, debtReads, goalReads, the three handlers, the composable, and the two component suites).
2. Spot-check the seed math against §4: with `cash≈RM1,000`, the July rollup yields `rawSurplus` ≈ RM733.99 and `surplusAfterInterest` ≈ RM623 (raw − ~RM111.01 card interest); `/api/debt` returns `availableCreditCents` = 58664 (RM586.64 = limit 798740 − balance 740076) and `monthlyInterestCents` = 11101 (RM111.01).
3. With the dev server up (`npm run dev`), `curl -s 'http://127.0.0.1:3000/api/forecast?today=2026-06-18'` returns `sts.nextInflowISO = "2026-06-23"` and `sts.daysToNextInflow = 5`; `curl -s http://127.0.0.1:3000/api/debt` returns `btRecommendation: "attempt_bt"` while `bt_status='none'`. Both 401 without a session cookie (every handler is `requireSession`-gated).
4. Toggle the card debt's `bt_status` to `'active'` in the DB → `/api/debt` flips `monthlyInterestCents` to 0 and `btRecommendation` to `route_surplus_inside_promo`, and the card-free date shortens (every ringgit is principal).

**Files produced (absolute paths):** `/Users/brendxn___/Desktop/Personal-FMS/server/utils/forecastConstants.ts`, `nextInflow.ts`, `safeToSpend.ts`, `forecastReads.ts`, `monthlyRollup.ts`, `cardPayoff.ts`, `payoff.ts`, `debtReads.ts`, `goalReads.ts`; `/Users/brendxn___/Desktop/Personal-FMS/server/api/forecast.get.ts`, `debt.get.ts`, `goals/progress.get.ts`; `/Users/brendxn___/Desktop/Personal-FMS/shared/types.ts`; `/Users/brendxn___/Desktop/Personal-FMS/app/composables/useSafeToSpend.ts`; `/Users/brendxn___/Desktop/Personal-FMS/app/pages/index.vue` plus the four components under `app/components/forecast/` and `app/components/debt/`.
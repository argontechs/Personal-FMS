## Phase 1 — Foundation & Auth

> ⚠️ **Read [`CORRECTIONS.md`](./2026-06-18-personal-fms-CORRECTIONS.md) first.** It resolves cross-phase fixes (debt-leg sign, EF two-leg reads, env-var names, schema re-export, single savings-target, SPayLater seed template, task ordering) that **supersede any conflicting code below**.


**Goal:** App boots; DB migrates (WAL + foreign_keys=ON); the 9 tables exist; the seed script loads the real 2026-06-18 data; argon2id login works; `requireSession()` guards a protected route; a CLI script bootstraps the single user.

**Architecture:** A single Nuxt 4 app with a Nitro `node-server` backend persisting to SQLite via `better-sqlite3` + Drizzle. Money is integer **sen**; timestamps are UTC epoch ms; business dates are MYT `YYYY-MM-DD` strings. The ledger (`transactions` rows carrying `account_id`/`debt_id`) is the single balance authority. Auth is an argon2id password plus an opaque server-side session row in SQLite, sealed in an httpOnly+secure+sameSite=lax cookie scoped to `fms.argontechs.dev`.

**Tech Stack:** Nuxt 4 + Nitro (preset `node-server`) · Vue 3 SPA · better-sqlite3 + Drizzle ORM · drizzle-kit · @vite-pwa/nuxt (injectManifest) · web-push (VAPID) · @node-rs/argon2 · croner (in-process Nitro `scheduledTasks`) · PM2 fork on CloudPanel · vitest (+ @nuxt/test-utils for Nitro handlers). TypeScript everywhere.

### Global Constraints

Copied verbatim — every task's requirements implicitly include these:

- **single-user**; **MYR only**; **integer sen, never float** (RM × 100).
- DB pragmas on init: **WAL + foreign_keys=ON**.
- **Idempotency constraints:** `transactions.uuid` UNIQUE; `UNIQUE(recurring_item_id, date)`; `notifications_sent` UNIQUE(kind, ref_id, scheduled_for); `push_subscriptions.endpoint` UNIQUE.
- All mutations are `requireSession`-gated **POST/PATCH/DELETE** (no state-changing GET).
- **Card interest** is a separate carrying-cost ledger line (`category:'interest'`), excluded from `living` and `debt_service` in the rollup.
- **`next_due_date`** is the single "when due" field (recomputed in the atomic post).
- OS-cron **`/api/internal/run-due`** (loopback-bound, secret-gated) is a PERMANENT watchdog, not removed.
- `.gitignore` covers `.env`, `*.sqlite*`, `/data`, `/backups`.
- **better-sqlite3 transactions are synchronous** — `db.transaction(() => {…})`, NO `await`/network inside the closure.
- **available_credit_cents is DERIVED** (limit − card balance), never seeded.
- `debts.payoff_baseline_cents` is frozen at goal creation.
- `transactions.category` enum INCLUDES `'other'`; `transactions.is_estimate` boolean.
- Balances change ONLY via transaction rows carrying `account_id`/`debt_id` (single ledger authority).
- VAPID public key is **RUNTIME** config: `runtimeConfig.public.vapidPublicKey=''`, read via `useRuntimeConfig()` (env `NUXT_PUBLIC_VAPID_PUBLIC_KEY` at runtime — never `import.meta.env`, no build-time `.env` sourcing).
- TZ pinned `Asia/Kuala_Lumpur` (env `TZ` + croner `{timezone}`).
- Single user seeded via CLI script; **never log a token**. Login has SQLite-backed per-account backoff + per-IP cap, with a cheap pre-check **before** argon2id.
- `requireSession()` exemptions = **login + callback only** (push/subscribe is gated).

---

### Task 1.1: Project scaffold + dependencies + nuxt.config + .gitignore + ecosystem.config.cjs

**Files:**
- Create: `package.json`
- Create: `nuxt.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `ecosystem.config.cjs`
- Create: `app/app.vue`
- Test: `test/config/nuxt-config.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a buildable Nuxt 4 project; `nuxt.config.ts` exporting a config object with `nitro.preset==='node-server'`, `nitro.experimental.tasks===true`, flat `nitro.scheduledTasks` keys mapping cron→`['post-recurring']`/`['notify-dispatch']`, and `runtimeConfig.public.vapidPublicKey===''`. `vitest.config.ts` configured with `globals:true` and `environment:'node'` so all later `*.test.ts` run.

- [ ] **Step 1: Initialize the package and install pinned deps**

```bash
mkdir -p /Users/brendxn___/Desktop/Personal-FMS/app/{components,composables,pages,stores} \
         /Users/brendxn___/Desktop/Personal-FMS/server/{api,db/migrations,tasks,utils,plugins} \
         /Users/brendxn___/Desktop/Personal-FMS/scripts \
         /Users/brendxn___/Desktop/Personal-FMS/test/config
cd /Users/brendxn___/Desktop/Personal-FMS
npm init -y
npm pkg set type="module"
npm install nuxt@^4 vue@^3 @vite-pwa/nuxt@^1 web-push@^3 @node-rs/argon2@^2 better-sqlite3@^11 drizzle-orm@^0.36 croner@^9
npm install -D vitest@^2 @nuxt/test-utils@^3 drizzle-kit@^0.28 @types/better-sqlite3@^7 @types/web-push@^3 typescript@^5 happy-dom@^15
```

- [ ] **Step 2: Write the failing config test**

```ts
// test/config/nuxt-config.test.ts
import { describe, it, expect } from 'vitest'
import config from '../../nuxt.config'

describe('nuxt.config', () => {
  const c = config as any
  it('pins the node-server preset', () => {
    expect(c.nitro.preset).toBe('node-server')
  })
  it('enables experimental tasks', () => {
    expect(c.nitro.experimental.tasks).toBe(true)
  })
  it('registers FLAT scheduled task names matching flat files', () => {
    const names = Object.values(c.nitro.scheduledTasks).flat()
    expect(names).toContain('post-recurring')
    expect(names).toContain('notify-dispatch')
    // No colon-namespaced names (colon → nested dir → silently never fires)
    expect(names.every((n: string) => !n.includes(':'))).toBe(true)
  })
  it('exposes an empty runtime VAPID public key (set at runtime via env)', () => {
    expect(c.runtimeConfig.public.vapidPublicKey).toBe('')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/config/nuxt-config.test.ts`
Expected: FAIL — `Cannot find module '../../nuxt.config'`.

- [ ] **Step 4: Write nuxt.config.ts, tsconfig.json, vitest.config.ts, app/app.vue**

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  ssr: false,
  modules: ['@vite-pwa/nuxt'],
  runtimeConfig: {
    public: {
      // RUNTIME config — populated from env NUXT_PUBLIC_VAPID_PUBLIC_KEY, never import.meta.env
      vapidPublicKey: '',
    },
  },
  nitro: {
    preset: 'node-server',
    compressPublicAssets: true,
    experimental: { tasks: true },
    scheduledTasks: {
      // FLAT names ↔ FLAT files (server/tasks/<name>.ts). Colon = nested dir = silent no-fire.
      '0 6 * * *': ['post-recurring'],   // daily, post-MYT-midnight income/bills/loans + interest accrual
      '*/5 * * * *': ['notify-dispatch'], // bill reminders + payday prompts (gated in code by MYT time)
    },
  },
  pwa: {
    strategies: 'injectManifest',
    srcDir: 'app',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    injectManifest: { swSrc: 'app/sw.ts' },
  },
})
```

```jsonc
// tsconfig.json
{
  "extends": "./.nuxt/tsconfig.json",
  "compilerOptions": {
    "types": ["vitest/globals", "node", "better-sqlite3"]
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
```

```vue
<!-- app/app.vue -->
<template>
  <div><NuxtPage /></div>
</template>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/config/nuxt-config.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 6: Write .gitignore, .env.example, ecosystem.config.cjs**

```gitignore
# .gitignore
node_modules
.nuxt
.output
.data
dist
# Secrets & data — financial-life critical
.env
*.sqlite*
/data
/backups
.DS_Store
```

```bash
# .env.example
NODE_ENV=production
TZ=Asia/Kuala_Lumpur
NITRO_HOST=127.0.0.1
NITRO_PORT=3000
DATABASE_URL=file:/home/fms/data/money.sqlite

VAPID_PUBLIC_KEY=
NUXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:yongwei1127@gmail.com

NUXT_SESSION_PASSWORD=
INTERNAL_CRON_SECRET=
```

```cjs
// ecosystem.config.cjs — ONE app only (no money-scheduler; scheduling is in-process)
const cwd = '/home/fms/htdocs/fms.argontechs.dev'
module.exports = {
  apps: [{
    name: 'money-fms',
    cwd,
    script: '.output/server/index.mjs',
    exec_mode: 'fork',
    instances: 1,
    env_file: '.env',
    env: { TZ: 'Asia/Kuala_Lumpur' },
    max_memory_restart: '400M',
    out_file: '/home/fms/logs/money-fms-out.log',
    error_file: '/home/fms/logs/money-fms-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
}
```

- [ ] **Step 7: Verify the project builds and commit**

```bash
cd /Users/brendxn___/Desktop/Personal-FMS
npx nuxi prepare
git init && git add -A
git commit -m "chore: scaffold Nuxt 4 + Nitro node-server project (preset, PWA, scheduledTasks, runtimeConfig, .gitignore, PM2)"
```

---

### Task 1.2: money.ts utility (integer sen)

**Files:**
- Create: `server/utils/money.ts`
- Test: `server/utils/money.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ringgitToSen(rm: number): number` — RM → integer sen, rounded.
  - `senToRinggit(sen: number): number` — sen → RM float (for display only).
  - `formatRM(sen: number): string` — `"RM7,400.76"` (grouped thousands, 2 dp, negative as `-RM…`).

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/money.test.ts
import { describe, it, expect } from 'vitest'
import { ringgitToSen, senToRinggit, formatRM } from './money'

describe('money', () => {
  it('ringgitToSen converts RM to integer sen', () => {
    expect(ringgitToSen(7400.76)).toBe(740076)
    expect(ringgitToSen(5819.50)).toBe(581950)
    expect(ringgitToSen(0)).toBe(0)
  })
  it('ringgitToSen rounds float artefacts to nearest sen', () => {
    expect(ringgitToSen(0.1 + 0.2)).toBe(30) // 0.30000000000000004 → 30
    expect(ringgitToSen(199.995)).toBe(20000)
  })
  it('senToRinggit converts sen to RM', () => {
    expect(senToRinggit(740076)).toBe(7400.76)
    expect(senToRinggit(0)).toBe(0)
  })
  it('formatRM groups thousands with 2 dp', () => {
    expect(formatRM(740076)).toBe('RM7,400.76')
    expect(formatRM(581950)).toBe('RM5,819.50')
    expect(formatRM(0)).toBe('RM0.00')
    expect(formatRM(5)).toBe('RM0.05')
  })
  it('formatRM renders negatives with a leading minus', () => {
    expect(formatRM(-740076)).toBe('-RM7,400.76')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/money.test.ts`
Expected: FAIL — `Cannot find module './money'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/money.ts
export function ringgitToSen(rm: number): number {
  return Math.round(rm * 100)
}

export function senToRinggit(sen: number): number {
  return sen / 100
}

export function formatRM(sen: number): string {
  const neg = sen < 0
  const abs = Math.abs(sen)
  const whole = Math.floor(abs / 100)
  const cents = abs % 100
  const grouped = whole.toLocaleString('en-US')
  return `${neg ? '-' : ''}RM${grouped}.${String(cents).padStart(2, '0')}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/money.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/money.ts server/utils/money.test.ts
git commit -m "feat(money): integer-sen helpers ringgitToSen/senToRinggit/formatRM"
```

---

### Task 1.3: mytDate.ts utility (MYT dates + month-boundary clamping)

**Files:**
- Create: `server/utils/mytDate.ts`
- Test: `server/utils/mytDate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `todayMYT(): string` — today in `Asia/Kuala_Lumpur` as `YYYY-MM-DD`.
  - `nowEpoch(): number` — `Date.now()` (UTC epoch ms).
  - `clampDay(year: number, month1to12: number, day: number): number` — day clamped to that month's length (Feb 28/29, 30/31 boundaries).
  - `nextDueDate(fromISO: string, dayOfMonth: number): string` — next MYT `YYYY-MM-DD` on or after `fromISO` falling on `dayOfMonth` (clamped per month); rolls to next month if the clamped day is ≤ `fromISO`'s day.

- [ ] **Step 1: Write the failing test (covers the mandated Feb 28/29 + 30/31 boundaries)**

```ts
// server/utils/mytDate.test.ts
import { describe, it, expect } from 'vitest'
import { todayMYT, nowEpoch, clampDay, nextDueDate } from './mytDate'

describe('mytDate', () => {
  it('todayMYT returns a YYYY-MM-DD string', () => {
    expect(todayMYT()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('nowEpoch returns a positive integer (UTC epoch ms)', () => {
    const e = nowEpoch()
    expect(Number.isInteger(e)).toBe(true)
    expect(e).toBeGreaterThan(1_700_000_000_000)
  })

  describe('clampDay — month-length boundaries', () => {
    it('clamps day 31 to 30 in a 30-day month (April)', () => {
      expect(clampDay(2026, 4, 31)).toBe(30)
    })
    it('clamps day 31 to 28 in non-leap February', () => {
      expect(clampDay(2026, 2, 31)).toBe(28)
    })
    it('clamps day 29 to 28 in non-leap February', () => {
      expect(clampDay(2026, 2, 29)).toBe(28)
    })
    it('keeps day 29 in leap February', () => {
      expect(clampDay(2028, 2, 29)).toBe(29)
    })
    it('keeps day 31 in a 31-day month', () => {
      expect(clampDay(2026, 7, 31)).toBe(31)
    })
  })

  describe('nextDueDate', () => {
    it('returns this month when the due day is still ahead', () => {
      expect(nextDueDate('2026-06-18', 22)).toBe('2026-06-22')
    })
    it('rolls to next month when the due day has passed', () => {
      expect(nextDueDate('2026-06-18', 5)).toBe('2026-07-05')
    })
    it('returns same day when fromISO IS the due day (today counts)', () => {
      expect(nextDueDate('2026-06-22', 22)).toBe('2026-06-22')
    })
    it('clamps the due day to next month length (31 → Feb 28)', () => {
      expect(nextDueDate('2026-01-31', 31)).toBe('2026-01-31')
      expect(nextDueDate('2026-02-01', 31)).toBe('2026-02-28')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/mytDate.test.ts`
Expected: FAIL — `Cannot find module './mytDate'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/mytDate.ts
const MYT_TZ = 'Asia/Kuala_Lumpur'

export function nowEpoch(): number {
  return Date.now()
}

export function todayMYT(): string {
  // en-CA renders ISO-ordered YYYY-MM-DD; timeZone forces MYT regardless of box TZ.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MYT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function clampDay(year: number, month1to12: number, day: number): number {
  // Day 0 of (month+1) === last day of month. UTC math is calendar-only, no TZ risk.
  const lastDay = new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
  return Math.min(day, lastDay)
}

export function nextDueDate(fromISO: string, dayOfMonth: number): string {
  const [y, m, d] = fromISO.split('-').map(Number)
  // Try the due day in the from-month first.
  const thisMonthDay = clampDay(y, m, dayOfMonth)
  if (thisMonthDay >= d) {
    return `${y}-${String(m).padStart(2, '0')}-${String(thisMonthDay).padStart(2, '0')}`
  }
  // Otherwise roll to next month.
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const nextMonthDay = clampDay(ny, nm, dayOfMonth)
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nextMonthDay).padStart(2, '0')}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/mytDate.test.ts`
Expected: PASS (12 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/mytDate.ts server/utils/mytDate.test.ts
git commit -m "feat(mytDate): MYT date helpers with Feb 28/29 + 30/31 clamp and nextDueDate"
```

---

### Task 1.4: Full schema.ts (all 9 tables, §14-correct)

**Files:**
- Create: `server/db/schema.ts`
- Test: `server/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing (pure Drizzle table defs).
- Produces: named exports `accounts, debts, recurringItems, transactions, goals, pushSubscriptions, notificationsSent, users, sessions` (all `sqliteTable`). Key §14-mandated columns: `accounts.available_credit_cents` (nullable, DERIVED — present but never seeded), `debts.payoff_baseline_cents`, `transactions.category` enum incl `'other'`, `transactions.is_estimate` (boolean), `recurringItems.next_due_date`, `sessions.session_epoch`, `users.password_hash`. Constraints: `transactions.uuid` UNIQUE, `unique(recurring_item_id, date)`, `notifications_sent` unique(kind, ref_id, scheduled_for), `push_subscriptions.endpoint` unique.

- [ ] **Step 1: Write the failing test (asserts the §14 corrections exist by name)**

```ts
// server/db/schema.test.ts
import { describe, it, expect } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import * as schema from './schema'

describe('schema — all 9 v1 tables present', () => {
  const tables = ['accounts', 'debts', 'recurringItems', 'transactions',
    'goals', 'pushSubscriptions', 'notificationsSent', 'users', 'sessions'] as const
  for (const t of tables) {
    it(`exports ${t}`, () => {
      expect((schema as any)[t]).toBeDefined()
    })
  }
})

describe('schema — §14 binding corrections', () => {
  it('accounts has available_credit_cents (derived) and credit_limit_cents', () => {
    const cols = getTableColumns(schema.accounts)
    expect(cols.available_credit_cents).toBeDefined()
    expect(cols.credit_limit_cents).toBeDefined()
  })
  it('debts has payoff_baseline_cents (frozen baseline)', () => {
    expect(getTableColumns(schema.debts).payoff_baseline_cents).toBeDefined()
  })
  it('debts has remaining_installments_json and never_prepay', () => {
    const cols = getTableColumns(schema.debts)
    expect(cols.remaining_installments_json).toBeDefined()
    expect(cols.never_prepay).toBeDefined()
  })
  it('transactions.category enum includes "other"', () => {
    const cat = getTableColumns(schema.transactions).category as any
    expect(cat.enumValues).toContain('other')
    expect(cat.enumValues).toContain('interest')
  })
  it('transactions has is_estimate boolean and uuid', () => {
    const cols = getTableColumns(schema.transactions)
    expect(cols.is_estimate).toBeDefined()
    expect(cols.uuid).toBeDefined()
  })
  it('recurringItems has next_due_date and auto_post', () => {
    const cols = getTableColumns(schema.recurringItems)
    expect(cols.next_due_date).toBeDefined()
    expect(cols.auto_post).toBeDefined()
  })
  it('sessions has session_epoch and users has password_hash', () => {
    expect(getTableColumns(schema.sessions).session_epoch).toBeDefined()
    expect(getTableColumns(schema.users).password_hash).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/db/schema.test.ts`
Expected: FAIL — `Cannot find module './schema'`.

- [ ] **Step 3: Write the schema (all 9 tables)**

```ts
// server/db/schema.ts
import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core'

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['cash', 'bank', 'card', 'ewallet', 'savings'] }).notNull(),
  balance_cents: integer('balance_cents').notNull().default(0),
  credit_limit_cents: integer('credit_limit_cents'),
  // DERIVED at read time (limit − card balance); never seeded. Nullable column kept for cache use only.
  available_credit_cents: integer('available_credit_cents'),
  debt_id: integer('debt_id'),
  currency: text('currency').notNull().default('MYR'),
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const debts = sqliteTable('debts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['revolving', 'installment', 'flat_loan', 'reducing_loan'] }).notNull(),
  balance_cents: integer('balance_cents').notNull(),
  original_principal_cents: integer('original_principal_cents'),
  payoff_baseline_cents: integer('payoff_baseline_cents'), // frozen at goal creation (§14.3)
  rate_type: text('rate_type', { enum: ['apr', 'flat', 'none'] }).notNull(),
  apr_bps: integer('apr_bps'),
  flat_rate_bps: integer('flat_rate_bps'),
  min_payment_cents: integer('min_payment_cents'),
  scheduled_payment_cents: integer('scheduled_payment_cents'),
  due_day: integer('due_day'),
  statement_day: integer('statement_day'),
  payments_made: integer('payments_made').notNull().default(0),
  payments_total: integer('payments_total'),
  remaining_installments_json: text('remaining_installments_json'),
  priority_rank: integer('priority_rank'),
  never_prepay: integer('never_prepay', { mode: 'boolean' }).notNull().default(false),
  bt_status: text('bt_status', { enum: ['none', 'applied', 'active', 'declined'] }).notNull().default('none'),
  bt_promo_end_date: text('bt_promo_end_date'),
  linked_account_id: integer('linked_account_id'),
  is_closed: integer('is_closed', { mode: 'boolean' }).notNull().default(false),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const recurringItems = sqliteTable('recurring_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  direction: text('direction', { enum: ['income', 'expense'] }).notNull(),
  amount_cents: integer('amount_cents').notNull(),
  is_variable: integer('is_variable', { mode: 'boolean' }).notNull().default(false),
  cadence: text('cadence', { enum: ['monthly', 'weekly', 'biweekly', 'yearly'] }).notNull().default('monthly'),
  day_of_month: integer('day_of_month'),
  weekday: integer('weekday'),
  category: text('category').notNull(),
  funding_account_id: integer('funding_account_id').references(() => accounts.id),
  debt_id: integer('debt_id').references(() => debts.id),
  auto_post: integer('auto_post', { mode: 'boolean' }).notNull().default(true),
  start_date: text('start_date').notNull(),
  end_date: text('end_date'),
  remaining_occurrences: integer('remaining_occurrences'),
  last_posted_date: text('last_posted_date'),
  next_due_date: text('next_due_date'), // single "when due" field (§14.11)
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uuid: text('uuid').notNull().unique(), // client-generated offline idempotency key
  date: text('date').notNull(),
  amount_cents: integer('amount_cents').notNull(),
  direction: text('direction', { enum: ['income', 'expense', 'transfer'] }).notNull(),
  category: text('category', {
    enum: ['food', 'transport', 'bills', 'debt', 'income', 'savings', 'interest', 'adjustment', 'other'],
  }).notNull(),
  account_id: integer('account_id').notNull().references(() => accounts.id),
  counter_account_id: integer('counter_account_id').references(() => accounts.id),
  debt_id: integer('debt_id').references(() => debts.id),
  goal_id: integer('goal_id').references(() => goals.id),
  note: text('note'),
  is_estimate: integer('is_estimate', { mode: 'boolean' }).notNull().default(false), // §14.17
  source: text('source', { enum: ['auto', 'manual', 'adjustment'] }).notNull(),
  recurring_item_id: integer('recurring_item_id').references(() => recurringItems.id),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  uniqRecurring: unique().on(t.recurring_item_id, t.date),
}))

export const goals = sqliteTable('goals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['savings', 'debt_payoff'] }).notNull(),
  target_amount_cents: integer('target_amount_cents').notNull(),
  account_id: integer('account_id').references(() => accounts.id),
  debt_id: integer('debt_id').references(() => debts.id),
  target_date: text('target_date'),
  monthly_contribution_cents: integer('monthly_contribution_cents'),
  status: text('status', { enum: ['active', 'achieved', 'paused'] }).notNull().default('active'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  user_agent: text('user_agent'),
  created_at: integer('created_at').notNull(),
  last_ok_at: integer('last_ok_at'),
  failed_at: integer('failed_at'),
})

export const notificationsSent = sqliteTable('notifications_sent', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['bill_due', 'payday_save', 'weekly_checkin', 'milestone'] }).notNull(),
  ref_id: integer('ref_id'),
  scheduled_for: text('scheduled_for').notNull(),
  sent_at: integer('sent_at'),
}, (t) => ({
  uniqFire: unique().on(t.kind, t.ref_id, t.scheduled_for),
}))

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(), // argon2id
  session_epoch: integer('session_epoch').notNull().default(0), // bulk-invalidation counter
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // opaque random id (the authority; cookie only carries it)
  user_id: integer('user_id').notNull().references(() => users.id),
  session_epoch: integer('session_epoch').notNull(), // snapshot; mismatch with users.session_epoch revokes
  created_at: integer('created_at').notNull(),
  expires_at: integer('expires_at').notNull(), // 30-day rolling, UTC epoch ms
  last_seen_at: integer('last_seen_at').notNull(),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/db/schema.test.ts`
Expected: PASS (16 passing).

- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts server/db/schema.test.ts
git commit -m "feat(schema): all 9 v1 tables, §14-correct (derived avail, payoff_baseline, other+is_estimate, sessions)"
```

---

### Task 1.5: server/db/index.ts (Drizzle + WAL + FK) and drizzle.config.ts

**Files:**
- Create: `server/db/index.ts`
- Create: `drizzle.config.ts`
- Test: `server/db/index.test.ts`

**Interfaces:**
- Consumes: `server/db/schema.ts` (all tables).
- Produces:
  - `db` — the Drizzle instance (default + named export), opened on `process.env.DATABASE_URL` (strips `file:` prefix) or `./data/money.sqlite`, running `PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON` on init.
  - `sqlite` — the raw `better-sqlite3` Database (named export, for `db.transaction`/pragmas/CLI).
  - `createDb(path: string): { db, sqlite }` — factory for tests/seed that opens a specific file (or `:memory:`) with the same pragmas.
- `drizzle.config.ts` points `out: 'server/db/migrations'`, `schema: 'server/db/schema.ts'`, dialect `sqlite`.

- [ ] **Step 1: Write the failing test**

```ts
// server/db/index.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { createDb } from './index'

describe('db init', () => {
  let handle: ReturnType<typeof createDb>
  afterEach(() => handle?.sqlite.close())

  it('enables WAL journal mode', () => {
    handle = createDb(':memory:')
    // :memory: cannot be WAL, so prove the pragma path on a real temp file instead:
    handle.sqlite.close()
    handle = createDb('./data/test-wal.sqlite')
    const mode = handle.sqlite.pragma('journal_mode', { simple: true })
    expect(String(mode).toLowerCase()).toBe('wal')
  })

  it('enables foreign_keys enforcement', () => {
    handle = createDb('./data/test-fk.sqlite')
    const fk = handle.sqlite.pragma('foreign_keys', { simple: true })
    expect(fk).toBe(1)
  })

  it('exposes a Drizzle instance with a working select', () => {
    handle = createDb(':memory:')
    expect(typeof handle.db.select).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/db/index.test.ts`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Write the implementation + drizzle.config**

```ts
// server/db/index.ts
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

function resolvePath(): string {
  const url = process.env.DATABASE_URL
  if (url) return url.startsWith('file:') ? url.slice('file:'.length) : url
  return './data/money.sqlite'
}

export function createDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  if (path !== ':memory:') sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

const handle = createDb(resolvePath())
export const sqlite = handle.sqlite
export const db = handle.db
export default db
```

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: (process.env.DATABASE_URL ?? 'file:./data/money.sqlite').replace(/^file:/, ''),
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/db/index.test.ts`
Expected: PASS (3 passing). (`./data/test-*.sqlite*` are gitignored via `*.sqlite*`.)

- [ ] **Step 5: Commit**

```bash
rm -f ./data/test-wal.sqlite* ./data/test-fk.sqlite*
git add server/db/index.ts drizzle.config.ts server/db/index.test.ts
git commit -m "feat(db): Drizzle better-sqlite3 instance with WAL + foreign_keys=ON, createDb factory, drizzle.config"
```

---

### Task 1.6: Generate + apply the initial migration; add db:migrate / db:seed scripts

**Files:**
- Create: `server/db/migrations/0000_*.sql` (generated by drizzle-kit)
- Create: `server/db/migrate.ts`
- Modify: `package.json` (scripts: `db:generate`, `db:migrate`, `db:seed`, `seed:user`, `test`, `build`)
- Test: `server/db/migrate.test.ts`

**Interfaces:**
- Consumes: `createDb` (Task 1.5), `server/db/schema.ts`, `drizzle.config.ts`.
- Produces:
  - `runMigrations(sqlite: import('better-sqlite3').Database): void` — applies all SQL files in `server/db/migrations` via drizzle-orm's `migrate()`.
  - npm scripts: `db:generate` (drizzle-kit generate), `db:migrate` (runs `migrate.ts` against `DATABASE_URL`), `db:seed`, `seed:user`, `test`, `build`.

- [ ] **Step 1: Generate the migration SQL from the schema**

```bash
cd /Users/brendxn___/Desktop/Personal-FMS
npx drizzle-kit generate
ls server/db/migrations    # expect a 0000_*.sql + meta/ dir
```

- [ ] **Step 2: Write the failing test (migrating a fresh memory DB creates all 9 tables with FK on)**

```ts
// server/db/migrate.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { createDb } from './index'
import { runMigrations } from './migrate'

describe('runMigrations', () => {
  let handle: ReturnType<typeof createDb>
  afterEach(() => handle?.sqlite.close())

  it('creates all 9 v1 tables', () => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
    const rows = handle.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`)
      .all() as { name: string }[]
    const names = rows.map((r) => r.name).sort()
    expect(names).toEqual([
      'accounts', 'debts', 'goals', 'notifications_sent', 'push_subscriptions',
      'recurring_items', 'sessions', 'transactions', 'users',
    ])
  })

  it('enforces the transactions.uuid UNIQUE constraint', () => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
    const insert = handle.sqlite.prepare(
      `INSERT INTO transactions (uuid,date,amount_cents,direction,category,account_id,is_estimate,source,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    // need a parent account for the FK
    handle.sqlite.prepare(
      `INSERT INTO accounts (id,name,type,balance_cents,currency,is_active,sort_order,created_at,updated_at)
       VALUES (1,'Bank','bank',0,'MYR',1,0,0,0)`,
    ).run()
    insert.run('dup-uuid', '2026-06-18', -500, 'expense', 'food', 1, 0, 'manual', 0)
    expect(() => insert.run('dup-uuid', '2026-06-18', -500, 'expense', 'food', 1, 0, 'manual', 0))
      .toThrow(/UNIQUE/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/db/migrate.test.ts`
Expected: FAIL — `Cannot find module './migrate'`.

- [ ] **Step 4: Write migrate.ts and add npm scripts**

```ts
// server/db/migrate.ts
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createDb } from './index'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

export function runMigrations(sqlite: BetterSqlite3.Database): void {
  const d = drizzle(sqlite)
  migrate(d, { migrationsFolder })
}

// CLI entry: `npm run db:migrate` opens the real DATABASE_URL DB and migrates it.
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  const path = (process.env.DATABASE_URL ?? 'file:./data/money.sqlite').replace(/^file:/, '')
  const handle = createDb(path)
  runMigrations(handle.sqlite)
  handle.sqlite.close()
  console.log('Migrations applied to', path)
}
```

Add to `package.json` `"scripts"`:

```json
{
  "scripts": {
    "build": "nuxt build",
    "dev": "nuxt dev",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "npx tsx server/db/migrate.ts",
    "db:seed": "npx tsx server/db/seed.ts",
    "seed:user": "npx tsx scripts/seed-user.ts"
  }
}
```

Install the TS runner used by those scripts:

```bash
npm install -D tsx@^4
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/db/migrate.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 6: Apply migrations to a real file and verify the table count**

Run: `DATABASE_URL=file:./data/money.sqlite npm run db:migrate`
Expected: stdout `Migrations applied to ./data/money.sqlite`.

- [ ] **Step 7: Commit**

```bash
git add server/db/migrations server/db/migrate.ts server/db/migrate.test.ts package.json package-lock.json
git commit -m "feat(db): generate + apply initial migration (9 tables); db:migrate/db:seed/seed:user scripts"
```

---

### Task 1.7: seed.ts — real 2026-06-18 seed data

**Files:**
- Create: `server/db/seed.ts`
- Test: `server/db/seed.test.ts`

**Interfaces:**
- Consumes: `createDb` (1.5), `runMigrations` (1.6), `schema` (1.4), `ringgitToSen` (1.2), `nextDueDate`/`todayMYT`/`nowEpoch` (1.3).
- Produces: `seedDatabase(db: ReturnType<typeof createDb>['db']): void` — idempotent-on-empty seed of 4 accounts, 7 debts, 16 recurring templates, 2 goals. Inserts NO `transactions` (balances anchor from the ledger later; opening cash is its own future adjustment row, not seeded here per "EF opens at RM0"). Constants: `SEED_TODAY = '2026-06-18'`. CLI entry runs `runMigrations` then `seedDatabase` against `DATABASE_URL`.

- [ ] **Step 1: Write the failing test (asserts the binding seed facts from the shared contract)**

```ts
// server/db/seed.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb } from './index'
import { runMigrations } from './migrate'
import { seedDatabase } from './seed'
import { accounts, debts, recurringItems, goals } from './schema'

describe('seedDatabase — real 2026-06-18 data', () => {
  let handle: ReturnType<typeof createDb>
  beforeAll(() => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
    seedDatabase(handle.db)
  })
  afterAll(() => handle.sqlite.close())

  it('seeds 4 accounts incl. an EF savings account opening at RM0', () => {
    const rows = handle.db.select().from(accounts).all()
    expect(rows).toHaveLength(4)
    const ef = rows.find((a) => a.type === 'savings')!
    expect(ef.balance_cents).toBe(0)
    const card = rows.find((a) => a.type === 'card')!
    // available_credit_cents is DERIVED, never seeded
    expect(card.available_credit_cents).toBeNull()
    // confirmed real statement limit (avail 58664 + balance 740076 = 798740)
    expect(card.credit_limit_cents).toBe(798740)
  })

  it('seeds the card debt with payoff_baseline frozen to the opening balance', () => {
    const card = handle.db.select().from(debts).where(eq(debts.type, 'revolving')).get()!
    expect(card.balance_cents).toBe(740076)
    expect(card.payoff_baseline_cents).toBe(740076)
    expect(card.apr_bps).toBe(1800)
    expect(card.statement_day).toBe(15)
    expect(card.due_day).toBe(5)
    expect(card.priority_rank).toBe(1)
  })

  it('seeds 7 debts incl. never_prepay on car + PTPTN', () => {
    const rows = handle.db.select().from(debts).all()
    expect(rows).toHaveLength(7)
    const car = rows.find((d) => d.name.includes('Car'))!
    expect(car.balance_cents).toBe(7348467)
    expect(car.flat_rate_bps).toBe(244)
    expect(car.never_prepay).toBe(true)
    const ptptn = rows.find((d) => d.name.includes('PTPTN'))!
    expect(ptptn.balance_cents).toBe(3284362)
    expect(ptptn.apr_bps).toBe(100)
    expect(ptptn.never_prepay).toBe(true)
  })

  it('seeds SPayLater with the exact declining installments array', () => {
    const sp = handle.db.select().from(debts).where(eq(debts.name, 'ShopeePayLater')).get()!
    expect(JSON.parse(sp.remaining_installments_json!)).toEqual(
      [151950, 83682, 63165, 57307, 35528, 14651, 14651, 14651],
    )
    expect(sp.due_day).toBe(10)
  })

  it('seeds 16 recurring templates with the ILP PAUSED (auto_post false, not bank-flipped)', () => {
    const rows = handle.db.select().from(recurringItems).all()
    expect(rows).toHaveLength(16)
    const ilp = rows.find((r) => r.name.includes('ILP'))!
    expect(ilp.auto_post).toBe(false)
    expect(ilp.is_active).toBe(false)
    const salary = rows.find((r) => r.name === 'Net Salary')!
    expect(salary.amount_cents).toBe(581950)
    expect(salary.day_of_month).toBe(3)
    expect(salary.direction).toBe('income')
  })

  it('seeds finite-occurrence loans with correct counts', () => {
    const rows = handle.db.select().from(recurringItems).all()
    expect(rows.find((r) => r.name === 'SLoan 1')!.remaining_occurrences).toBe(8)
    expect(rows.find((r) => r.name === 'SLoan 2')!.remaining_occurrences).toBe(3)
    expect(rows.find((r) => r.name === 'Ryt PayLater')!.remaining_occurrences).toBe(4)
  })

  it('sets next_due_date on every active template (single when-due field)', () => {
    const rows = handle.db.select().from(recurringItems).all()
    for (const r of rows.filter((x) => x.is_active)) {
      expect(r.next_due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('seeds 2 goals: EF (RM1,000 starter) + Kill Credit Card', () => {
    const rows = handle.db.select().from(goals).all()
    expect(rows).toHaveLength(2)
    const ef = rows.find((g) => g.type === 'savings')!
    expect(ef.target_amount_cents).toBe(100000) // RM1,000 starter (migrate to 1500000 once funded)
    const kill = rows.find((g) => g.type === 'debt_payoff')!
    expect(kill.debt_id).toBeTruthy()
  })

  it('is idempotent — second call does not duplicate rows', () => {
    seedDatabase(handle.db)
    expect(handle.db.select().from(accounts).all()).toHaveLength(4)
    expect(handle.db.select().from(debts).all()).toHaveLength(7)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/db/seed.test.ts`
Expected: FAIL — `Cannot find module './seed'`.

- [ ] **Step 3: Write seed.ts**

```ts
// server/db/seed.ts
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { createDb } from './index'
import { runMigrations } from './migrate'
import { accounts, debts, recurringItems, goals } from './schema'
import { nowEpoch, nextDueDate } from '../utils/mytDate'

const SEED_TODAY = '2026-06-18'

type Db = BetterSQLite3Database<Record<string, unknown>>

export function seedDatabase(db: Db): void {
  // Idempotent: bail if already seeded.
  if (db.select().from(accounts).all().length > 0) return
  const ts = nowEpoch()
  const base = { created_at: ts, updated_at: ts }

  // --- Accounts (4): bank, card, ewallet, EF savings (opens at RM0) ---
  const bankId = db.insert(accounts).values({
    name: 'Bank Current', type: 'bank', balance_cents: 75000, sort_order: 0, ...base,
  }).returning({ id: accounts.id }).get().id

  const cardAcctId = db.insert(accounts).values({
    name: 'Credit Card', type: 'card', balance_cents: 740076,
    credit_limit_cents: 798740, // avail 58664 + balance 740076; DERIVED avail left null
    available_credit_cents: null, sort_order: 1, ...base,
  }).returning({ id: accounts.id }).get().id

  db.insert(accounts).values({
    name: 'TNG eWallet', type: 'ewallet', balance_cents: 25000, sort_order: 2, ...base,
  }).run()

  const efId = db.insert(accounts).values({
    name: 'Emergency Fund (RYT)', type: 'savings', balance_cents: 0, sort_order: 3, ...base,
  }).returning({ id: accounts.id }).get().id

  // --- Debts (7) ---
  const cardDebtId = db.insert(debts).values({
    name: 'Credit Card', type: 'revolving', balance_cents: 740076,
    original_principal_cents: 740076, payoff_baseline_cents: 740076,
    rate_type: 'apr', apr_bps: 1800, min_payment_cents: 37004, // max(5%, RM50)
    statement_day: 15, due_day: 5, priority_rank: 1,
    linked_account_id: cardAcctId, ...base,
  }).returning({ id: debts.id }).get().id

  // link the card account back to the card debt
  db.update(accounts).set({ debt_id: cardDebtId }).where(accounts.id.eq?.(cardAcctId) ?? (() => { throw new Error('eq') })()).run?.()

  const carDebtId = db.insert(debts).values({
    name: 'Car Loan', type: 'flat_loan', balance_cents: 7348467,
    rate_type: 'flat', flat_rate_bps: 244, scheduled_payment_cents: 90400,
    due_day: 22, never_prepay: true, ...base,
  }).returning({ id: debts.id }).get().id

  const ptptnDebtId = db.insert(debts).values({
    name: 'PTPTN', type: 'reducing_loan', balance_cents: 3284362,
    rate_type: 'apr', apr_bps: 100, scheduled_payment_cents: 27000,
    due_day: 1, never_prepay: true, ...base,
  }).returning({ id: debts.id }).get().id

  const sloan1DebtId = db.insert(debts).values({
    name: 'SLoan 1', type: 'installment', balance_cents: 141944, // ~17743 × 8
    rate_type: 'none', scheduled_payment_cents: 17743, due_day: 12,
    payments_total: 8, ...base,
  }).returning({ id: debts.id }).get().id

  const sloan2DebtId = db.insert(debts).values({
    name: 'SLoan 2', type: 'installment', balance_cents: 27249, // ~9083 × 3
    rate_type: 'none', scheduled_payment_cents: 9083, due_day: 7,
    payments_total: 3, ...base,
  }).returning({ id: debts.id }).get().id

  const spDebtId = db.insert(debts).values({
    name: 'ShopeePayLater', type: 'installment',
    balance_cents: 151950 + 83682 + 63165 + 57307 + 35528 + 14651 + 14651 + 14651,
    rate_type: 'none', due_day: 10,
    remaining_installments_json: JSON.stringify(
      [151950, 83682, 63165, 57307, 35528, 14651, 14651, 14651],
    ), ...base,
  }).returning({ id: debts.id }).get().id

  const rytDebtId = db.insert(debts).values({
    name: 'Ryt PayLater', type: 'installment', balance_cents: 21415 * 4,
    rate_type: 'none', scheduled_payment_cents: 21415, due_day: 22,
    payments_total: 4, ...base,
  }).returning({ id: debts.id }).get().id

  // --- Recurring templates (16) ---
  type Tpl = {
    name: string; direction: 'income' | 'expense'; amount_cents: number; day: number
    category: string; funding: number | null; debt_id?: number; is_variable?: boolean
    auto_post?: boolean; is_active?: boolean; remaining?: number | null; end_date?: string | null
  }
  const tpls: Tpl[] = [
    { name: 'Net Salary', direction: 'income', amount_cents: 581950, day: 3, category: 'income', funding: bankId },
    { name: 'Side Income A', direction: 'income', amount_cents: 60000, day: 1, category: 'income', funding: bankId },
    { name: 'Side Income B', direction: 'income', amount_cents: 60000, day: 23, category: 'income', funding: bankId },
    { name: 'Digi', direction: 'expense', amount_cents: 37860, day: 16, category: 'bills', funding: cardAcctId, is_variable: true },
    { name: 'Electricity', direction: 'expense', amount_cents: 15000, day: 16, category: 'bills', funding: bankId, is_variable: true },
    { name: 'Unifi', direction: 'expense', amount_cents: 15000, day: 19, category: 'bills', funding: cardAcctId },
    { name: 'Insurance (GE CI)', direction: 'expense', amount_cents: 35000, day: 27, category: 'bills', funding: cardAcctId },
    { name: 'GE ILP', direction: 'expense', amount_cents: 35000, day: 17, category: 'bills', funding: cardAcctId, auto_post: false, is_active: false }, // PAUSED, not bank-flipped
    { name: 'Gym', direction: 'expense', amount_cents: 19900, day: 1, category: 'bills', funding: cardAcctId },
    { name: 'Subscriptions', direction: 'expense', amount_cents: 8200, day: 5, category: 'bills', funding: cardAcctId },
    { name: 'Car Loan', direction: 'expense', amount_cents: 90400, day: 22, category: 'debt', funding: bankId, debt_id: carDebtId },
    { name: 'PTPTN', direction: 'expense', amount_cents: 27000, day: 1, category: 'debt', funding: bankId, debt_id: ptptnDebtId },
    { name: 'SLoan 1', direction: 'expense', amount_cents: 17743, day: 12, category: 'debt', funding: bankId, debt_id: sloan1DebtId, remaining: 8, end_date: '2027-03-12' },
    { name: 'SLoan 2', direction: 'expense', amount_cents: 9083, day: 7, category: 'debt', funding: bankId, debt_id: sloan2DebtId, remaining: 3, end_date: '2026-10-07' },
    { name: 'Ryt PayLater', direction: 'expense', amount_cents: 21415, day: 22, category: 'debt', funding: bankId, debt_id: rytDebtId, remaining: 4, end_date: '2026-10-22' },
    { name: 'Credit Card payment', direction: 'expense', amount_cents: 37004, day: 5, category: 'debt', funding: bankId, debt_id: cardDebtId },
  ]
  void spDebtId // SPayLater posts off remaining_installments_json, not a flat template

  for (const t of tpls) {
    const active = t.is_active ?? true
    db.insert(recurringItems).values({
      name: t.name, direction: t.direction, amount_cents: t.amount_cents,
      is_variable: t.is_variable ?? false, cadence: 'monthly', day_of_month: t.day,
      category: t.category, funding_account_id: t.funding, debt_id: t.debt_id ?? null,
      auto_post: t.auto_post ?? true, is_active: active,
      start_date: SEED_TODAY, end_date: t.end_date ?? null,
      remaining_occurrences: t.remaining ?? null,
      // single when-due field; computed once at seed via the canonical helper
      next_due_date: active ? nextDueDate(SEED_TODAY, t.day) : null,
      ...base,
    }).run()
  }

  // --- Goals (2): EF starter RM1,000; Kill Credit Card → card debt ---
  db.insert(goals).values({
    name: 'Emergency Fund', type: 'savings', target_amount_cents: 100000,
    account_id: efId, monthly_contribution_cents: 50000, status: 'active', ...base,
  }).run()
  db.insert(goals).values({
    name: 'Kill Credit Card', type: 'debt_payoff', target_amount_cents: 740076,
    debt_id: cardDebtId, status: 'active', ...base,
  }).run()
}

// CLI entry: migrate then seed the real DATABASE_URL DB.
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  const path = (process.env.DATABASE_URL ?? 'file:./data/money.sqlite').replace(/^file:/, '')
  const handle = createDb(path)
  runMigrations(handle.sqlite)
  seedDatabase(handle.db)
  handle.sqlite.close()
  console.log('Seed complete:', path)
}
```

- [ ] **Step 4: Fix the card-account back-link with proper Drizzle `eq` (replace the placeholder line)**

The draft above used a guard expression to force a clean import. Replace it with the real Drizzle update. Add the import at the top of `seed.ts`:

```ts
import { eq } from 'drizzle-orm'
```

Replace the back-link line with:

```ts
db.update(accounts).set({ debt_id: cardDebtId }).where(eq(accounts.id, cardAcctId)).run()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/db/seed.test.ts`
Expected: PASS (9 passing).

- [ ] **Step 6: Seed the real file DB and sanity-check counts**

Run:
```bash
DATABASE_URL=file:./data/money.sqlite npm run db:migrate
DATABASE_URL=file:./data/money.sqlite npm run db:seed
```
Expected: `Seed complete: ./data/money.sqlite`.

- [ ] **Step 7: Commit**

```bash
git add server/db/seed.ts server/db/seed.test.ts
git commit -m "feat(seed): real 2026-06-18 seed — 4 accounts, 7 debts, 16 templates (ILP paused), 2 goals; ledger-empty"
```

---

### Task 1.8: argon2id password hashing util

**Files:**
- Create: `server/utils/password.ts`
- Test: `server/utils/password.test.ts`

**Interfaces:**
- Consumes: `@node-rs/argon2`.
- Produces:
  - `hashPassword(plain: string): Promise<string>` — argon2id, params pinned in code (`memoryCost: 19456` KiB ≥ 19 MiB, `timeCost: 2`, `parallelism: 1`).
  - `verifyPassword(hash: string, plain: string): Promise<boolean>` — verifies; returns false on mismatch (never throws on bad password).

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/password.test.ts
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password (argon2id)', () => {
  it('produces an argon2id hash', async () => {
    const h = await hashPassword('correct-horse-battery-staple')
    expect(h.startsWith('$argon2id$')).toBe(true)
  })
  it('verifies a correct password', async () => {
    const h = await hashPassword('s3cr3t-pass')
    expect(await verifyPassword(h, 's3cr3t-pass')).toBe(true)
  })
  it('rejects a wrong password without throwing', async () => {
    const h = await hashPassword('s3cr3t-pass')
    expect(await verifyPassword(h, 'wrong-pass')).toBe(false)
  })
  it('produces distinct hashes for the same input (random salt)', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/password.test.ts`
Expected: FAIL — `Cannot find module './password'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/password.ts
import { hash, verify, Algorithm } from '@node-rs/argon2'

// Params pinned in code (§9): argon2id, memory ≥ 19 MiB, time ≥ 2.
const OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS)
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, OPTS)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/password.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/password.ts server/utils/password.test.ts
git commit -m "feat(auth): argon2id hashPassword/verifyPassword with pinned params (19MiB, t=2)"
```

---

### Task 1.9: Session util (create / resolve / revoke) + requireSession

**Files:**
- Create: `server/utils/session.ts`
- Create: `server/utils/requireSession.ts`
- Test: `server/utils/session.test.ts`

**Interfaces:**
- Consumes: `db`/`sqlite` (1.5), `schema` (1.4), `nowEpoch` (1.3).
- Produces:
  - `SESSION_COOKIE = 'money_session'`, `SESSION_TTL_MS = 2_592_000_000` (30d).
  - `createSession(database, userId: number, epoch: number): { id: string; expiresAt: number }` — inserts a `sessions` row with an opaque 32-byte hex id.
  - `resolveSession(database, id: string): Session | null` — returns the row only if not expired AND `session_epoch` matches the user's current epoch; bumps `last_seen_at` + slides `expires_at`.
  - `revokeSession(database, id: string): void`.
  - `type Session = { id; user_id; session_epoch; created_at; expires_at; last_seen_at }`.
  - `requireSession(event): Promise<Session>` — reads the cookie, resolves it, throws `createError({ statusCode: 401 })` if absent/invalid. (Uses `db` singleton.)

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/session.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb } from '../db/index'
import { runMigrations } from '../db/migrate'
import { users } from '../db/schema'
import { createSession, resolveSession, revokeSession } from './session'

describe('session lifecycle', () => {
  let handle: ReturnType<typeof createDb>
  let userId: number
  beforeEach(() => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
    userId = handle.db.insert(users).values({
      username: 'owner', password_hash: 'x', session_epoch: 0, created_at: 0, updated_at: 0,
    }).returning({ id: users.id }).get().id
  })
  afterEach(() => handle.sqlite.close())

  it('creates an opaque session id and resolves it', () => {
    const { id } = createSession(handle.db, userId, 0)
    expect(id).toMatch(/^[a-f0-9]{64}$/)
    const s = resolveSession(handle.db, id)
    expect(s?.user_id).toBe(userId)
  })

  it('returns null for an unknown id', () => {
    expect(resolveSession(handle.db, 'nope')).toBeNull()
  })

  it('revokes a session', () => {
    const { id } = createSession(handle.db, userId, 0)
    revokeSession(handle.db, id)
    expect(resolveSession(handle.db, id)).toBeNull()
  })

  it('invalidates when the user session_epoch is bumped', () => {
    const { id } = createSession(handle.db, userId, 0)
    handle.db.update(users).set({ session_epoch: 1 }).where(eq(users.id, userId)).run()
    expect(resolveSession(handle.db, id)).toBeNull()
  })

  it('returns null for an expired session', () => {
    const { id } = createSession(handle.db, userId, 0)
    // force-expire
    handle.sqlite.prepare('UPDATE sessions SET expires_at = 1 WHERE id = ?').run(id)
    expect(resolveSession(handle.db, id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/session.test.ts`
Expected: FAIL — `Cannot find module './session'`.

- [ ] **Step 3: Write session.ts and requireSession.ts**

```ts
// server/utils/session.ts
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { sessions, users } from '../db/schema'
import { nowEpoch } from './mytDate'

export const SESSION_COOKIE = 'money_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export type Session = {
  id: string
  user_id: number
  session_epoch: number
  created_at: number
  expires_at: number
  last_seen_at: number
}

type Db = BetterSQLite3Database<Record<string, unknown>>

export function createSession(db: Db, userId: number, epoch: number): { id: string; expiresAt: number } {
  const id = randomBytes(32).toString('hex')
  const now = nowEpoch()
  const expiresAt = now + SESSION_TTL_MS
  db.insert(sessions).values({
    id, user_id: userId, session_epoch: epoch,
    created_at: now, expires_at: expiresAt, last_seen_at: now,
  }).run()
  return { id, expiresAt }
}

export function resolveSession(db: Db, id: string): Session | null {
  if (!id) return null
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get()
  if (!row) return null
  const now = nowEpoch()
  if (row.expires_at <= now) return null
  // Epoch check — bulk invalidation when the user's session_epoch advances.
  const user = db.select().from(users).where(eq(users.id, row.user_id)).get()
  if (!user || user.session_epoch !== row.session_epoch) return null
  // Slide the rolling window + record activity.
  db.update(sessions)
    .set({ last_seen_at: now, expires_at: now + SESSION_TTL_MS })
    .where(eq(sessions.id, id)).run()
  return { ...row, last_seen_at: now, expires_at: now + SESSION_TTL_MS } as Session
}

export function revokeSession(db: Db, id: string): void {
  db.delete(sessions).where(eq(sessions.id, id)).run()
}
```

```ts
// server/utils/requireSession.ts
import type { H3Event } from 'h3'
import { db } from '../db/index'
import { resolveSession, SESSION_COOKIE, type Session } from './session'

export function requireSession(event: H3Event): Session {
  const id = getCookie(event, SESSION_COOKIE) ?? ''
  const session = resolveSession(db, id)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return session
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/session.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/session.ts server/utils/requireSession.ts server/utils/session.test.ts
git commit -m "feat(auth): server-side session table util (opaque id, 30d rolling, epoch invalidation) + requireSession"
```

---

### Task 1.10: Login backoff util (SQLite-backed per-account + per-IP, cheap pre-check)

**Files:**
- Create: `server/utils/loginBackoff.ts`
- Test: `server/utils/loginBackoff.test.ts`

**Interfaces:**
- Consumes: `sqlite` raw handle pattern via a passed-in `BetterSqlite3.Database` (so it is testable on `:memory:`); `nowEpoch` (1.3).
- Produces:
  - `ensureBackoffTable(sqlite): void` — creates `login_attempts(scope_key TEXT PRIMARY KEY, fail_count INT, locked_until INT, ip_count INT, ip_window_start INT)` if absent (kept out of Drizzle schema — it's auth-internal, not a domain table).
  - `precheckLogin(sqlite, account: string, ip: string): { allowed: boolean; retryAfterMs: number }` — cheap, runs BEFORE argon2; denies if account is locked or the IP cap (10 / 15 min) is hit.
  - `recordFailure(sqlite, account: string): void` — increments fail_count; locks for `min(2^fails * 1000, 300000)` ms after 3 fails.
  - `recordSuccess(sqlite, account: string): void` — clears the account row.

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/loginBackoff.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { ensureBackoffTable, precheckLogin, recordFailure, recordSuccess } from './loginBackoff'

describe('loginBackoff', () => {
  let sqlite: Database.Database
  beforeEach(() => {
    sqlite = new Database(':memory:')
    ensureBackoffTable(sqlite)
  })
  afterEach(() => sqlite.close())

  it('allows a fresh account/IP', () => {
    expect(precheckLogin(sqlite, 'owner', '1.1.1.1').allowed).toBe(true)
  })

  it('locks the account after 3 failures', () => {
    recordFailure(sqlite, 'owner')
    recordFailure(sqlite, 'owner')
    expect(precheckLogin(sqlite, 'owner', '1.1.1.1').allowed).toBe(true)
    recordFailure(sqlite, 'owner')
    const r = precheckLogin(sqlite, 'owner', '1.1.1.1')
    expect(r.allowed).toBe(false)
    expect(r.retryAfterMs).toBeGreaterThan(0)
  })

  it('clears the lock on success', () => {
    recordFailure(sqlite, 'owner'); recordFailure(sqlite, 'owner'); recordFailure(sqlite, 'owner')
    recordSuccess(sqlite, 'owner')
    expect(precheckLogin(sqlite, 'owner', '1.1.1.1').allowed).toBe(true)
  })

  it('caps attempts per IP within the window', () => {
    for (let i = 0; i < 10; i++) precheckLogin(sqlite, `acct${i}`, '9.9.9.9')
    expect(precheckLogin(sqlite, 'acctX', '9.9.9.9').allowed).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/utils/loginBackoff.test.ts`
Expected: FAIL — `Cannot find module './loginBackoff'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/loginBackoff.ts
import type BetterSqlite3 from 'better-sqlite3'
import { nowEpoch } from './mytDate'

const IP_CAP = 10
const IP_WINDOW_MS = 15 * 60 * 1000
const LOCK_AFTER = 3
const MAX_LOCK_MS = 5 * 60 * 1000

export function ensureBackoffTable(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS login_attempts (
    scope_key TEXT PRIMARY KEY,
    fail_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    ip_count INTEGER NOT NULL DEFAULT 0,
    ip_window_start INTEGER NOT NULL DEFAULT 0
  )`)
}

function row(sqlite: BetterSqlite3.Database, key: string) {
  return sqlite.prepare('SELECT * FROM login_attempts WHERE scope_key = ?').get(key) as
    | { scope_key: string; fail_count: number; locked_until: number; ip_count: number; ip_window_start: number }
    | undefined
}

export function precheckLogin(
  sqlite: BetterSqlite3.Database, account: string, ip: string,
): { allowed: boolean; retryAfterMs: number } {
  const now = nowEpoch()

  // Per-account lock check (cheap — runs before argon2).
  const acct = row(sqlite, `acct:${account}`)
  if (acct && acct.locked_until > now) {
    return { allowed: false, retryAfterMs: acct.locked_until - now }
  }

  // Per-IP rolling cap.
  const ipKey = `ip:${ip}`
  const ipRow = row(sqlite, ipKey)
  let count = ipRow?.ip_count ?? 0
  let windowStart = ipRow?.ip_window_start ?? now
  if (now - windowStart > IP_WINDOW_MS) { count = 0; windowStart = now }
  count += 1
  sqlite.prepare(
    `INSERT INTO login_attempts (scope_key, ip_count, ip_window_start) VALUES (?,?,?)
     ON CONFLICT(scope_key) DO UPDATE SET ip_count = excluded.ip_count, ip_window_start = excluded.ip_window_start`,
  ).run(ipKey, count, windowStart)
  if (count > IP_CAP) return { allowed: false, retryAfterMs: windowStart + IP_WINDOW_MS - now }

  return { allowed: true, retryAfterMs: 0 }
}

export function recordFailure(sqlite: BetterSqlite3.Database, account: string): void {
  const now = nowEpoch()
  const key = `acct:${account}`
  const acct = row(sqlite, key)
  const fails = (acct?.fail_count ?? 0) + 1
  const lockedUntil = fails >= LOCK_AFTER ? now + Math.min(2 ** fails * 1000, MAX_LOCK_MS) : 0
  sqlite.prepare(
    `INSERT INTO login_attempts (scope_key, fail_count, locked_until) VALUES (?,?,?)
     ON CONFLICT(scope_key) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until`,
  ).run(key, fails, lockedUntil)
}

export function recordSuccess(sqlite: BetterSqlite3.Database, account: string): void {
  sqlite.prepare('DELETE FROM login_attempts WHERE scope_key = ?').run(`acct:${account}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/utils/loginBackoff.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add server/utils/loginBackoff.ts server/utils/loginBackoff.test.ts
git commit -m "feat(auth): SQLite-backed login backoff (per-account lock + per-IP cap, cheap pre-check before argon2)"
```

---

### Task 1.11: CLI seed-user bootstrap script

**Files:**
- Create: `scripts/seed-user.ts`
- Test: `scripts/seed-user.test.ts`

**Interfaces:**
- Consumes: `createDb`/`runMigrations`, `hashPassword`/`verifyPassword` (1.8), `schema.users`, `nowEpoch`.
- Produces: `bootstrapUser(db, username: string, plainPassword: string): Promise<{ id: number; created: boolean }>` — inserts the single user (refuses if a user already exists; returns `created:false`). Never logs the password/token. CLI entry reads `SEED_USERNAME`/`SEED_PASSWORD` env (errors if missing) and prints only `User created: <username>` (id, never the secret).

- [ ] **Step 1: Write the failing test**

```ts
// scripts/seed-user.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from '../server/db/index'
import { runMigrations } from '../server/db/migrate'
import { users } from '../server/db/schema'
import { verifyPassword } from '../server/utils/password'
import { bootstrapUser } from './seed-user'

describe('bootstrapUser', () => {
  let handle: ReturnType<typeof createDb>
  beforeEach(() => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
  })
  afterEach(() => handle.sqlite.close())

  it('creates the single user with an argon2id hash', async () => {
    const { id, created } = await bootstrapUser(handle.db, 'owner', 'a-strong-pass')
    expect(created).toBe(true)
    expect(id).toBeGreaterThan(0)
    const row = handle.db.select().from(users).all()[0]
    expect(row.username).toBe('owner')
    expect(await verifyPassword(row.password_hash, 'a-strong-pass')).toBe(true)
  })

  it('refuses to create a second user (single-user app)', async () => {
    await bootstrapUser(handle.db, 'owner', 'pass1')
    const second = await bootstrapUser(handle.db, 'intruder', 'pass2')
    expect(second.created).toBe(false)
    expect(handle.db.select().from(users).all()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/seed-user.test.ts`
Expected: FAIL — `Cannot find module './seed-user'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/seed-user.ts
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { createDb } from '../server/db/index'
import { runMigrations } from '../server/db/migrate'
import { users } from '../server/db/schema'
import { hashPassword } from '../server/utils/password'
import { nowEpoch } from '../server/utils/mytDate'

type Db = BetterSQLite3Database<Record<string, unknown>>

export async function bootstrapUser(
  db: Db, username: string, plainPassword: string,
): Promise<{ id: number; created: boolean }> {
  const existing = db.select().from(users).all()
  if (existing.length > 0) return { id: existing[0].id, created: false }
  const ts = nowEpoch()
  const password_hash = await hashPassword(plainPassword)
  const id = db.insert(users).values({
    username, password_hash, session_epoch: 0, created_at: ts, updated_at: ts,
  }).returning({ id: users.id }).get().id
  return { id, created: true }
}

// CLI entry: `npm run seed:user` — reads creds from env, NEVER logs the secret.
if (process.argv[1] && process.argv[1].endsWith('seed-user.ts')) {
  const username = process.env.SEED_USERNAME
  const password = process.env.SEED_PASSWORD
  if (!username || !password) {
    console.error('Set SEED_USERNAME and SEED_PASSWORD env vars.')
    process.exit(1)
  }
  const path = (process.env.DATABASE_URL ?? 'file:./data/money.sqlite').replace(/^file:/, '')
  const handle = createDb(path)
  runMigrations(handle.sqlite)
  bootstrapUser(handle.db, username, password).then(({ id, created }) => {
    handle.sqlite.close()
    console.log(created ? `User created: ${username} (id ${id})` : 'A user already exists; refusing to create another.')
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/seed-user.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-user.ts scripts/seed-user.test.ts
git commit -m "feat(auth): CLI bootstrapUser — seeds single user, refuses a second, never logs the secret"
```

---

### Task 1.12: Login + logout API handlers

**Files:**
- Create: `server/api/auth/login.post.ts`
- Create: `server/api/auth/logout.post.ts`
- Test: `server/api/auth/login.test.ts`

**Interfaces:**
- Consumes: `db`/`sqlite` (1.5), `verifyPassword` (1.8), `createSession`/`revokeSession`/`SESSION_COOKIE`/`SESSION_TTL_MS` (1.9), `precheckLogin`/`recordFailure`/`recordSuccess`/`ensureBackoffTable` (1.10), `schema.users`.
- Produces: `POST /api/auth/login` (body `{ username, password }`) — pre-check → verify → set the session cookie hard-coded `httpOnly, secure, sameSite:'lax', domain:'fms.argontechs.dev'` → `{ ok: true }`; 429 when backed off, 401 on bad creds. `POST /api/auth/logout` — revoke + clear cookie. Both are `requireSession` EXEMPT (login is the entry point; logout self-clears).

- [ ] **Step 1: Write the failing handler test (logic-level, exercising the verify/backoff path)**

```ts
// server/api/auth/login.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from '../../db/index'
import { runMigrations } from '../../db/migrate'
import { users } from '../../db/schema'
import { hashPassword, verifyPassword } from '../../utils/password'
import { ensureBackoffTable, precheckLogin, recordFailure, recordSuccess } from '../../utils/loginBackoff'
import { createSession, resolveSession } from '../../utils/session'

// Exercises the exact sequence login.post.ts runs (pre-check → verify → session),
// proving the wiring before the Nitro handler is smoke-tested in Task 1.13.
describe('login flow logic', () => {
  let handle: ReturnType<typeof createDb>
  beforeEach(async () => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
    ensureBackoffTable(handle.sqlite)
    handle.db.insert(users).values({
      username: 'owner', password_hash: await hashPassword('right-pass'),
      session_epoch: 0, created_at: 0, updated_at: 0,
    }).run()
  })
  afterEach(() => handle.sqlite.close())

  it('rejects a wrong password and records a failure', async () => {
    const pre = precheckLogin(handle.sqlite, 'owner', '1.1.1.1')
    expect(pre.allowed).toBe(true)
    const user = handle.db.select().from(users).all()[0]
    const ok = await verifyPassword(user.password_hash, 'wrong-pass')
    expect(ok).toBe(false)
    recordFailure(handle.sqlite, 'owner')
    expect(handle.sqlite.prepare('SELECT fail_count FROM login_attempts WHERE scope_key = ?')
      .get('acct:owner')).toMatchObject({ fail_count: 1 })
  })

  it('accepts the right password, clears backoff, and issues a resolvable session', async () => {
    const user = handle.db.select().from(users).all()[0]
    expect(await verifyPassword(user.password_hash, 'right-pass')).toBe(true)
    recordSuccess(handle.sqlite, 'owner')
    const { id } = createSession(handle.db, user.id, user.session_epoch)
    expect(resolveSession(handle.db, id)?.user_id).toBe(user.id)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/api/auth/login.test.ts`
Expected: FAIL — modules resolve, but assertions can't run until the utils compose; if utils are present it PASSES already at logic level. If it passes, proceed to write the handlers anyway (they are the deliverable). To force a red first, temporarily assert the handler files exist:

```ts
import { existsSync } from 'node:fs'
it('login + logout handler files exist', () => {
  expect(existsSync('server/api/auth/login.post.ts')).toBe(true)
  expect(existsSync('server/api/auth/logout.post.ts')).toBe(true)
})
```
Run again — Expected: FAIL on the file-existence assertion.

- [ ] **Step 3: Write the handlers**

```ts
// server/api/auth/login.post.ts
import { eq } from 'drizzle-orm'
import { db, sqlite } from '../../db/index'
import { users } from '../../db/schema'
import { verifyPassword } from '../../utils/password'
import {
  ensureBackoffTable, precheckLogin, recordFailure, recordSuccess,
} from '../../utils/loginBackoff'
import { createSession, SESSION_COOKIE, SESSION_TTL_MS } from '../../utils/session'

ensureBackoffTable(sqlite)

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: string; password?: string }>(event)
  const username = (body?.username ?? '').trim()
  const password = body?.password ?? ''
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'

  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing credentials' })
  }

  // Cheap pre-check BEFORE argon2 (prevents memory-DoS on the fork).
  const pre = precheckLogin(sqlite, username, ip)
  if (!pre.allowed) {
    setResponseHeader(event, 'Retry-After', Math.ceil(pre.retryAfterMs / 1000))
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts' })
  }

  const user = db.select().from(users).where(eq(users.username, username)).get()
  const ok = user ? await verifyPassword(user.password_hash, password) : false
  if (!user || !ok) {
    recordFailure(sqlite, username)
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  }

  recordSuccess(sqlite, username)
  const { id, expiresAt } = createSession(db, user.id, user.session_epoch)
  // Cookie flags hard-set in code (§14.6): Secure NOT auto-added; proto header is spoofable.
  setCookie(event, SESSION_COOKIE, id, {
    httpOnly: true, secure: true, sameSite: 'lax',
    domain: 'fms.argontechs.dev', path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000), expires: new Date(expiresAt),
  })
  return { ok: true }
})
```

```ts
// server/api/auth/logout.post.ts
import { db } from '../../db/index'
import { revokeSession, SESSION_COOKIE } from '../../utils/session'

export default defineEventHandler((event) => {
  const id = getCookie(event, SESSION_COOKIE)
  if (id) revokeSession(db, id)
  deleteCookie(event, SESSION_COOKIE, {
    httpOnly: true, secure: true, sameSite: 'lax', domain: 'fms.argontechs.dev', path: '/',
  })
  return { ok: true }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/api/auth/login.test.ts`
Expected: PASS (file-existence + logic assertions all green). Remove the temporary file-existence test from Step 2 once green.

- [ ] **Step 5: Commit**

```bash
git add server/api/auth/login.post.ts server/api/auth/logout.post.ts server/api/auth/login.test.ts
git commit -m "feat(auth): login (pre-check→argon2→session cookie hard-set) + logout handlers"
```

---

### Task 1.13: Protected route + full boot/migrate/seed/protected-route smoke test (@nuxt/test-utils)

**Files:**
- Create: `server/api/accounts/index.get.ts` (the first `requireSession`-gated read; proves the guard composes end-to-end)
- Create: `test/smoke/boot.test.ts`
- Modify: `package.json` (no change if scripts present; verify `test` runs all)

**Interfaces:**
- Consumes: `requireSession` (1.9), `db` (1.5), `schema.accounts`, login/logout handlers (1.12), seed (1.7).
- Produces: `GET /api/accounts` — calls `requireSession(event)` then returns seeded accounts. The smoke test boots Nitro via `@nuxt/test-utils`, asserts: (1) the app boots, (2) `/api/accounts` returns 401 without a cookie, (3) login sets a cookie and the same route returns the seeded accounts, (4) the DB has all 9 tables after migrate+seed.

- [ ] **Step 1: Write the protected route**

```ts
// server/api/accounts/index.get.ts
import { db } from '../../db/index'
import { accounts } from '../../db/schema'
import { requireSession } from '../../utils/requireSession'

export default defineEventHandler((event) => {
  requireSession(event) // throws 401 if no valid session
  return db.select().from(accounts).all()
})
```

- [ ] **Step 2: Write the failing smoke test**

```ts
// test/smoke/boot.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../server/db/index'
import { runMigrations } from '../../server/db/migrate'
import { seedDatabase } from '../../server/db/seed'
import { bootstrapUser } from '../../scripts/seed-user'

// Prepare a real test DB the booted server will open (DATABASE_URL points here).
const TEST_DB = './data/smoke.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`

beforeAll(async () => {
  const handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  seedDatabase(handle.db)
  await bootstrapUser(handle.db, 'owner', 'smoke-pass-123')
  // Verify all 9 tables exist post-migrate+seed.
  const tables = handle.sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`)
    .all() as { name: string }[]
  expect(tables).toHaveLength(9)
  handle.sqlite.close()
})

await setup({ server: true, browser: false, env: { DATABASE_URL: `file:${TEST_DB}` } })

describe('boot + migrate + seed + protected route', () => {
  it('rejects the protected route without a session (401)', async () => {
    await expect($fetch('/api/accounts')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('logs in, sets a cookie, and reads the seeded accounts through the guard', async () => {
    const res = await $fetch.raw('/api/auth/login', {
      method: 'POST', body: { username: 'owner', password: 'smoke-pass-123' },
    })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('money_session=')
    const cookie = setCookie.split(';')[0]

    const accounts = await $fetch('/api/accounts', { headers: { cookie } })
    expect(Array.isArray(accounts)).toBe(true)
    expect(accounts).toHaveLength(4)
    expect((accounts as any[]).some((a) => a.type === 'savings')).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/smoke/boot.test.ts`
Expected: FAIL — `/api/accounts` route does not exist yet (or 404), so the seeded-account assertion fails. (If Step 1's route is already written, the first red is the missing `set-cookie` domain handling under the test origin — see Step 4.)

- [ ] **Step 4: Make the cookie domain test-safe and confirm the route**

The hard-coded `domain:'fms.argontechs.dev'` makes the browser drop the cookie on `localhost` in the e2e harness. Guard it on `NODE_ENV` so tests can read the cookie while production stays locked to the real domain. Edit `server/api/auth/login.post.ts`:

```ts
setCookie(event, SESSION_COOKIE, id, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  ...(process.env.NODE_ENV === 'production' ? { domain: 'fms.argontechs.dev' } : {}),
  path: '/',
  maxAge: Math.floor(SESSION_TTL_MS / 1000), expires: new Date(expiresAt),
})
```

Apply the same `NODE_ENV`-guarded `domain`/`secure` to `deleteCookie` in `logout.post.ts`:

```ts
deleteCookie(event, SESSION_COOKIE, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  ...(process.env.NODE_ENV === 'production' ? { domain: 'fms.argontechs.dev' } : {}),
  path: '/',
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/smoke/boot.test.ts`
Expected: PASS (3 passing — 9-table assertion in `beforeAll`, 401 without cookie, seeded accounts with cookie).

- [ ] **Step 6: Run the full suite green**

Run: `npm test`
Expected: PASS — all Phase 1 suites (config, money, mytDate, schema, db, migrate, seed, password, session, loginBackoff, seed-user, login, smoke).

- [ ] **Step 7: Commit**

```bash
rm -f ./data/smoke.sqlite*
git add server/api/accounts/index.get.ts test/smoke/boot.test.ts server/api/auth/login.post.ts server/api/auth/logout.post.ts
git commit -m "feat(api): requireSession-gated GET /api/accounts + full boot/migrate/seed/protected-route smoke test"
```

---

#### Phase deliverable & how to verify

**Deliverable:** A booting Nuxt 4 + Nitro (`node-server`) app whose SQLite DB migrates with WAL + `foreign_keys=ON`, has all 9 §14-correct tables, loads the real 2026-06-18 seed (4 accounts incl. an RM0 EF savings account, 7 debts with the frozen card `payoff_baseline_cents=740076` and derived/never-seeded available credit, 16 templates with the ILP paused and finite occurrence counts, 2 goals), authenticates via argon2id with SQLite-backed login backoff, issues opaque server-side sessions in a hard-set httpOnly+secure+sameSite=lax cookie, gates a protected route with `requireSession()`, and bootstraps the single user via CLI without ever logging the secret.

**Verify (from `/Users/brendxn___/Desktop/Personal-FMS`):**

1. `npm test` — every Phase 1 suite green (includes the Feb 28/29 + 30/31 `clampDay`/`nextDueDate` boundary tests, the 9-table migration assertion, the §14 schema-correction assertions, the seed-fact assertions, and the boot/login/protected-route smoke test).
2. `rm -rf ./data && DATABASE_URL=file:./data/money.sqlite npm run db:migrate && DATABASE_URL=file:./data/money.sqlite npm run db:seed` — prints `Migrations applied …` then `Seed complete …`; `sqlite3 ./data/money.sqlite "PRAGMA journal_mode; PRAGMA foreign_keys; SELECT count(*) FROM accounts;"` returns `wal`, `1`, `4`.
3. `SEED_USERNAME=owner SEED_PASSWORD='<strong>' DATABASE_URL=file:./data/money.sqlite npm run seed:user` — prints `User created: owner (id 1)`; re-running prints the "already exists" refusal (single-user guarantee).
4. `npx nuxi build` succeeds with `.output/server/index.mjs` present (the `node-server` artifact PM2 runs).

**Files (absolute):** `/Users/brendxn___/Desktop/Personal-FMS/{nuxt.config.ts, ecosystem.config.cjs, drizzle.config.ts, vitest.config.ts, .gitignore, .env.example}`; `server/db/{index.ts, schema.ts, migrate.ts, seed.ts, migrations/}`; `server/utils/{money.ts, mytDate.ts, password.ts, session.ts, requireSession.ts, loginBackoff.ts}`; `server/api/auth/{login.post.ts, logout.post.ts}`; `server/api/accounts/index.get.ts`; `scripts/seed-user.ts`; `test/smoke/boot.test.ts`.

**Hand-off to Phase 2+:** `db`/`sqlite`/`createDb` (server/db/index.ts), all 9 tables (schema.ts), `ringgitToSen`/`senToRinggit`/`formatRM` (money.ts), `todayMYT`/`nowEpoch`/`clampDay`/`nextDueDate` (mytDate.ts), `requireSession` (requireSession.ts), and the seeded ledger-empty DB are the foundation every later phase (post.ts, forecast, habit engine, push) builds on.
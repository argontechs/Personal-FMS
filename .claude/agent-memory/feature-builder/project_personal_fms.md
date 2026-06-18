---
name: project-personal-fms
description: Key facts about the Personal-FMS project — stack, test patterns, db conventions, task patterns
metadata:
  type: project
---

Personal-FMS is a Nuxt 4 + Nitro + Drizzle (better-sqlite3) personal finance tracker.

**Stack:**
- Nuxt 4, Nitro, `@vite-pwa/nuxt`, better-sqlite3 (synchronous), Drizzle ORM
- Tests: Vitest 3, `DATABASE_URL=':memory:'` in vitest.config.ts, `beforeAll(() => runMigrations(sqlite))`
- Test files in `test/server/utils/`, `test/server/api/`, `test/smoke/`, `server/**/*.test.ts`

**Key conventions:**
- `postTransaction(input, db?)` in `server/utils/post.ts` is the atomic ledger writer — handles account delta, counter-account, debt delta, recurring_item decrement + next_due_date advance, all in one `db.transaction`
- Card accounts store balance as NEGATIVE (outstanding debt). Posting positive `amount_cents` on a card account: `acctDelta = -amount_cents` (makes balance more negative). A1 debt leg: `debt.balance += amount_cents`.
- `todayMYT()` and `nextDueDate(fromISO, dom)` in `server/utils/mytDate.ts`
- Nitro tasks: flat file names in `server/tasks/<name>.ts`, registered in `nuxt.config.ts` under `nitro.scheduledTasks`, `experimental.tasks: true`
- `UNIQUE(recurring_item_id, date)` on transactions — idempotency backstop for recurring auto-posts
- Interest rows use UUID `interest-<debt_id>-<YYYY-MM>` for per-month idempotency

**Why:** Learned during Task 2.4 implementation (2026-06-19)

**How to apply:** When working on any server-side feature in this repo — respect the synchronous db pattern, always use postTransaction for balance mutations, follow test file placement conventions.

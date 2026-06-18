# Personal-FMS v1 — Cross-Phase Corrections (BINDING)

> Read this **before executing any phase**. These canonical decisions come from the cross-phase consistency review (verdict: *ready-with-fixes*) and **supersede any conflicting code** in the phase plans. Where a phase's inline code disagrees with an item here, this file wins.

The five phase plans are individually sound and TDD-driven; the issues below are all at the *seams* between phases (the shared contract wasn't perfectly honored by every parallel author). Apply each fix and the plan is buildable.

---

## A. Correctness-critical (would break tests/runtime)

**A1 — Debt-leg sign: `debts.balance_cents = balance + amount_cents` (everywhere).**
Payment rows are **negative** (shrink the debt), interest-accrual rows are **positive** (grow it). Phase 2 `postTransaction` must add (`+ amount_cents`) to the debt leg, **not** subtract. Check: payment −50000 on 740076 → 690076 ✓; interest +11101 on 740076 → 751177 ✓.

**A2 — `recomputeBalances()` debts = `SUM(+amount_cents)`** (not `sum(-amount_cents)`), matching A1. With interest +11101 and payment −50000 the delta is −38899 — which is what the Task 2.4 and Task 2.9 fixtures expect. As originally written, `postTransaction` and `recomputeBalances` used **opposite** debt signs, so the Phase 2 recompute-parity test could never pass. Both now use `+amount`.

**A3 — EF balance reads BOTH legs.** A transfer is **one signed row**: `account_id = bank`, `counter_account_id = EF`, `amount = −X` (debits bank; EF gains X). Therefore:
```
efBalanceCents = SUM(amount WHERE account_id = EF) − SUM(amount WHERE counter_account_id = EF)
```
Phase 3 `efBalanceCents` (Task 3.10) must use this — **not** "rows WHERE account_id = EF" only (which finds zero rows for a real Phase 4 transfer and silently zeroes the north-star progress bar). Apply the same counter convention in `recomputeBalances`.

**A4 — Savings-target carve-out reads the EF-inbound leg.** `savingsTargetRemainingCents` must measure money that actually landed in EF this cycle = `−SUM(amount WHERE counter_account_id = EF AND date in cycle)`. **Not** `category='savings' AND amount>0` (matches nothing — the savings row's amount is negative on the bank leg).

## B. Single source of truth

**B1 — ONE savings-target function + constant** feeds *both* `forecast.get`'s STS carve-out *and* the payday-prompt's suggested amount. Create `server/utils/savingsTarget.ts` exporting `savingsTargetRemainingSen(cycleStartISO, cycleEndISO): number` and a single `SAVINGS_TARGET_PER_CYCLE_SEN`. **Value:** Buffer phase = RM500/mo split across the 3 inflow cycles → **16667 sen (~RM167)/cycle**; once the RM1,000 starter buffer is funded (Attack phase) it returns **0** (surplus routes to the card, not EF). Delete the duplicate `SAVINGS_TARGET=30000` in Phase 3 forecastConstants and the separate `BUFFER_PHASE_MONTHLY_SEN/3` in Phase 4 — both import this one function.

**B2 — `remaining_installments_json` lives on `recurring_items`** (Phase 1 schema adds the column there; it may stay on `debts` too but `recurring_items` is the operative one). Phase 2 post-recurring (by-index auto-post) and Phase 4 declining-amount reminders both read it there.

**B3 — Seed the ShopeePayLater recurring template** (Phase 1 seed). It was wrongly excluded. Add a template: `direction:'expense'`, amount = `remaining_installments_json[0]`, `due_day:10`, funding = bank, `debt_id` → SPayLater debt, `remaining_installments_json` set, `next_due_date` computed. **The seed template count is therefore 17, not 16** (update Phase 1 Task 1.7 and the spec §10/§13 count note).

## C. Env-var / import naming (silent runtime breaks)

**C1 — run-due watchdog secret:** ONE env name **`NUXT_RUN_DUE_SECRET`** → `runtimeConfig.runDueSecret`; ONE header **`x-run-due-secret`**. Fix Phase 1 `.env.example` (was `INTERNAL_CRON_SECRET`), keep Phase 4 handler as-is, fix Phase 5 `.env` + watchdog `curl` (were `INTERNAL_RUN_DUE_SECRET` / `x-internal-secret`).

**C2 — VAPID private key env:** **`NUXT_VAPID_PRIVATE_KEY`** + **`NUXT_VAPID_SUBJECT`** (the `NUXT_`-prefix is required for Nitro to map them to `runtimeConfig.vapidPrivateKey`/`vapidSubject`). Public stays `NUXT_PUBLIC_VAPID_PUBLIC_KEY`. Fix Phase 5 `.env` + `.env.example` (were un-prefixed → web-push gets an empty key → all push signing fails silently).

**C3 — Schema re-export:** Phase 1 `server/db/index.ts` adds `export * from './schema'` so `import { db, pushSubscriptions } from '../db'` (used throughout Phase 4) resolves. (Phases 2–3 import from `../db/schema`; both work once index re-exports.)

**C4 — `requireSession(event): Session`** — synchronous return type. The impl is sync; correct the Phase 1 Interfaces doc line (was `Promise<Session>`).

## D. Spec-coverage / wiring

**D1 — Remove `REGISTER_TOKEN` everywhere.** Bootstrap is the CLI `seed-user` script only (§14.12 permits CLI *or* token; we chose CLI). Drop `REGISTER_TOKEN` from Phase 1 `.env.example`, Phase 5 `.env`, and the stale `/api/auth/register` references in Phase 5.

**D2 — Wire the surplus-leak Δcash flag.** Add `deltaCashThisMonthCents` (Σ of this-month ledger rows on cash/bank accounts) to `/api/forecast`, and read it in `index.vue` (currently hardcoded `0`, so the §4 "you cleared RMx but it didn't land in savings" insight can never fire). It's a north-star insight — wire it.

**D3 — Card-free date uses card-routed surplus.** Feed `cardFreeDate` the surplus **after** subtracting the savings-target/EF allocation (the amount actually routed to the card per §5), not the whole `surplusAfterInterestCents` — otherwise the payoff date is optimistic.

## E. Placeholders → ship the final form only

**E1 — Phase 1 Task 1.7 seed back-link:** use the real `eq(accounts.id, cardAcctId)` (import `eq` from `drizzle-orm`); drop the non-compiling scratch expression.
**E2 — Phase 2 Task 2.4 `acctDelta`:** ship only the final `const acctDelta = isCard ? -input.amount_cents : input.amount_cents`; drop the scratch line.
**E3 — Phase 2 `recomputeBalances` stub** at Step 3 is acceptable TDD scaffolding, but its final impl (Step 26) must use `SUM(+amount_cents)` per A2.
**E4 — Phase 2 Task 2.3 `remaining_installments_json` NOTE:** resolved by B2 — it's on `recurring_items`. Remove the deferred decision from the handler comment.

## F. Task ordering (within Phase 4)

**F1 — Build `savingsTarget.ts` (B1) before `dispatchRun.ts`.** Phase 4 Task 4.6 imports `savingsTargetRemainingSen`; move that function ahead of Task 4.6 (e.g. make it Task 4.5a) so the payday-prompt path's test can run.
**F2 — Build `canary.post.ts` before `usePush.enable()`** references `/api/push/canary` (or note the dependency; unit test mocks `$fetch`, so runtime-only).

---

### Net schema/seed deltas vs the phase plans
- `recurring_items` gains `remaining_installments_json` (B2); seed gains the SPayLater template → **17 templates** (B3).
- `server/db/index.ts` gains `export * from './schema'` (C3).
- New util `server/utils/savingsTarget.ts` (B1), consumed by Phase 3 forecast + Phase 4 dispatch.
- Env canon: `NUXT_RUN_DUE_SECRET`, `NUXT_VAPID_PRIVATE_KEY`, `NUXT_VAPID_SUBJECT`, `NUXT_PUBLIC_VAPID_PUBLIC_KEY`; **no** `REGISTER_TOKEN`, no `INTERNAL_*` secret names.

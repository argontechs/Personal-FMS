# Personal-FMS v1 — Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement these plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ **Read [`CORRECTIONS.md`](./2026-06-18-personal-fms-CORRECTIONS.md) before executing any phase.** It resolves cross-phase seam fixes that SUPERSEDE conflicting code in the phase files.
> Source spec: [`../specs/2026-06-18-personal-fms-design.md`](../specs/2026-06-18-personal-fms-design.md) — esp. **§14 (binding corrections)**.

**Goal:** A self-hosted, single-user financial-habit PWA at `fms.argontechs.dev` that captures the user's leaking surplus into a RYT-Bank emergency fund and visibly shrinks his 18% credit card.

**Architecture:** One Nuxt 4 app — Vue 3 SPA + service worker on the client, Nitro `node-server` backend — persisting to SQLite via better-sqlite3 + Drizzle, with an in-process Nitro `scheduledTasks` (croner) habit engine sending Web Push. PM2 fork behind CloudPanel nginx + Let's Encrypt. The `transactions` ledger is the single balance authority; all four product views are reads over it.

**Tech Stack:** Nuxt 4 · Nitro (node-server) · Vue 3 · better-sqlite3 + Drizzle + drizzle-kit · @vite-pwa/nuxt (injectManifest) · web-push (VAPID) · @node-rs/argon2 · croner · PM2 / CloudPanel · vitest (+ @nuxt/test-utils). TypeScript throughout.

## Global Constraints (every task inherits these — verbatim from the spec + §14)

- **single-user**; **MYR only**; **integer sen, never float** (RM × 100).
- DB pragmas on init: **WAL + `foreign_keys=ON`**.
- Timestamps = **UTC epoch ms**; business dates = **MYT `YYYY-MM-DD`** (TZ pinned `Asia/Kuala_Lumpur`, env `TZ` + croner `{timezone}`).
- **Idempotency:** `transactions.uuid` UNIQUE; `UNIQUE(recurring_item_id, date)`; `notifications_sent` UNIQUE(kind, ref_id, scheduled_for); `push_subscriptions.endpoint` UNIQUE.
- **Single ledger authority:** account/debt balances change ONLY via `transactions` rows carrying `account_id`/`debt_id`. **Debt leg = `balance + amount_cents`** (payments negative, interest positive — see CORRECTIONS A1/A2).
- All mutations are `requireSession`-gated **POST/PATCH/DELETE** (no state-changing GET); exemptions = login + callback only.
- **available_credit_cents is DERIVED** (limit − card balance), never seeded.
- `debts.payoff_baseline_cents` frozen at goal creation; payoff progress = `clamp((baseline − current)/baseline, 0, 1)`.
- `transactions.category` enum INCLUDES `'other'`; `transactions.is_estimate` boolean for estimated bills.
- **Card interest** = a separate carrying-cost ledger line (`category:'interest'`), excluded from `living` and `debt_service` in the rollup.
- **`next_due_date`** is the single "when due" field, recomputed inside the atomic post.
- VAPID public key is RUNTIME config (`runtimeConfig.public.vapidPublicKey`, env `NUXT_PUBLIC_VAPID_PUBLIC_KEY`) — never `import.meta.env`, no build-time `.env` sourcing.
- Session cookie hard-set `httpOnly + secure + sameSite=lax + domain=fms.argontechs.dev` in code (not via a spoofable proxy header).
- Scheduler: **flat task names ↔ flat files** (`server/tasks/notify-dispatch.ts` ↔ `'notify-dispatch'`); OS-cron `/api/internal/run-due` (loopback-bound, secret-gated) is a **permanent** watchdog.
- better-sqlite3 transactions are **synchronous** — `db.transaction(() => {…})`, no `await`/network inside.
- `.gitignore` covers `.env`, `*.sqlite*`, `/data`, `/backups`. No Maybank; RYT EF rate ~3% (verify at build); backups → Google Drive.

## Phases (build in order; each is independently testable working software)

| # | Plan file | Deliverable |
|---|---|---|
| **1** | [`phase1-foundation-auth`](./2026-06-18-personal-fms-phase1-foundation-auth.md) | App boots; DB migrates (WAL+FK); 9 tables; seed loads real data; argon2id login; `requireSession()` guards a route; CLI bootstraps the user. |
| **2** | [`phase2-ledger-recurring-quicklog`](./2026-06-18-personal-fms-phase2-ledger-recurring-quicklog.md) | Log a transaction (online + offline-queued); recurring templates auto-post; card interest accrues to the ledger; single-field cash correction. |
| **3** | [`phase3-forecast-debt`](./2026-06-18-personal-fms-phase3-forecast-debt.md) | Dashboard: Safe-to-Spend hero + monthly surplus rollup + debt view (card balance, interest, card-free date, BT-first rec) + EF progress. |
| **4** | [`phase4-habit-engine`](./2026-06-18-personal-fms-phase4-habit-engine.md) | Bill reminders + 3 payday prompts via Web Push; EF "Transfer logged" writes a real two-leg transfer; iOS install/health + email fallback; cron watchdog. |
| **5** | [`phase5-deploy-runbook`](./2026-06-18-personal-fms-phase5-deploy-runbook.md) | Live at `fms.argontechs.dev` (HTTPS); PM2 fork surviving reboot; daily verified backups to Google Drive. |

**Sequencing:** 1 → 2 → 3 → 4, then 5 to ship. Phases 1–4 are local/testable; Phase 5 is a deployment runbook. Streaks/milestones/budgets/categories table/daily-forecast-chart/WebAuthn are **phase 2+ of the product** (deferred — do not build in v1).

## First-run real-world actions (the user does these, outside the code)
Switch card auto-charges (gym, Digi, Unifi, insurance, subs) to bank/debit; **pause the GE ILP** with Great Eastern; open/confirm the RYT "Emergency Fund" Save Pocket; ask the card issuer about a sub-18% installment conversion. These make the in-app plan real.

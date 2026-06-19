# Phase 1 + Critical Reliability — build plan (tailored fully-functional PFM)

Branch: feat/v1 (sequential, clean history). Each task: implement → test → build → commit.

## v2 — Trends over time (snapshots + daily snapshot task + trends charts)
- [x] T1. snapshotReads util: net_worth = liquid + holdings − debts; card/EF/liquid (reuse canonical reads)
- [x] T2. Schema: snapshots table (date UNIQUE) + generate migration 0005 (additive, contiguous meta chain)
- [x] T3. server/tasks/daily-snapshot.ts (flat) + register in nuxt.config (30 6 * * * MYT) — UPSERT idempotent, first-run writes today
- [x] T4. GET /api/trends — requireSession-gated, READ-ONLY: snapshot series + spend-by-category (expenses, last few months)
- [x] T5. UI /trends page (hand-rolled SVG line/sparkline/bars + a11y table + empty state) + Goals link (NO 6th tab)
- [x] T6. Tests: snapshot upsert idempotent + net-worth formula; /api/trends gated + series + categories; trends view charts/empty/a11y
- [x] T7. npm test (820 green) + npm run build green; migration 0005 applies; chain contiguous; committed

## Phase 1 — turn on built-but-hidden features
- [x] 1. Dashboard: Move-to-EF action + payday prompt (uses /api/transfers) + dashboard error state (H3)
- [x] 2. Dashboard: "Turn on reminders" push-subscribe button + iOS install hint + attention/push-health card (usePush, /api/health/push, attention)
- [x] 3. Nav: header "More" menu → Debts / Bills / Settings routes (stubs)
- [x] 4. All-debts view: GET /api/debts list + /debts page (all 7 debts, avalanche order)
- [x] 5. Bills & subscriptions management: /bills page wiring recurring CRUD (view/add/edit/pause, flip-off-card)
- [x] 6. Settings: /settings (correct-cash UI, EF target RM1k→RM15k migration, reminders toggle, logout)

## Critical reliability (Phase 3 critical)
- [x] 7. Ops: bin/backup-db.sh + restore-verify.sh + alerting util (C1/C2) + schedule weekly attention email (C3) + fix runbook /home/fms→/home/argontechs-fms
- [x] 8. Offline: 4xx dead-letter + retry cap/backoff + sync-error/offline banner (C4) + undo double-post guard (H7)

Deferred to later: holdings/net-worth (Phase 2), reports/trends, search/export, CSRF/rate-limit hardening (H4/H5), interest catch-up (H2), patch fields (H1).

## Phase 2 — Net-worth / holdings (tailored)
- [x] P2a. holdings table + migration + seed (AIA/GE/ASNB from §15) + GET/POST/PATCH/DELETE API
- [x] P2b. Holdings section in /accounts + TRUE net worth (liquid + holdings − debts); add/edit holding values
- [x] P2c. Money-move levers: AIA Assurance withdrawal (clear the 18% card) + GE ILP pause confirmation (tracked action items)

# Phase 1 + Critical Reliability — build plan (tailored fully-functional PFM)

Branch: feat/v1 (sequential, clean history). Each task: implement → test → build → commit.

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
- [ ] P2a. holdings table + migration + seed (AIA/GE/ASNB from §15) + GET/POST/PATCH/DELETE API
- [ ] P2b. Holdings section in /accounts + TRUE net worth (liquid + holdings − debts); add/edit holding values
- [ ] P2c. Money-move levers: AIA Assurance withdrawal (clear the 18% card) + GE ILP pause confirmation (tracked action items)

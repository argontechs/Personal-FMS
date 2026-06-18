# Habit Engine Runbook

This runbook covers the production deployment and operational verification of the Personal-FMS habit engine — the bill-due reminder and payday-save push-notification pipeline.

---

## 1. Architecture overview

| Layer | Component | Notes |
|---|---|---|
| In-process scheduler | Nitro `scheduledTasks` (croner) | Requires `preset: 'node-server'` + `experimental: { tasks: true }` |
| Bill/payday dispatch | `server/tasks/notify-dispatch.ts` | Every 5 min; MYT ≥ 09:00 gate enforced in `runDispatch` |
| Recurring auto-post | `server/tasks/post-recurring.ts` | Daily 06:00 UTC (post-MYT-midnight) |
| OS-cron watchdog | crontab on `money` user | Hits `127.0.0.1:3000` loopback — **permanent insurance** |
| Web Push | VAPID (`NUXT_VAPID_PRIVATE_KEY` + `NUXT_PUBLIC_VAPID_PUBLIC_KEY`) | iOS requires Home Screen install (standalone) |

---

## 2. Required environment variables

Set these in `/home/fms/htdocs/fms.argontechs.dev/.env` and reload with `pm2 reload --update-env`:

```
NUXT_VAPID_PRIVATE_KEY=<your-vapid-private-key>
NUXT_PUBLIC_VAPID_PUBLIC_KEY=<your-vapid-public-key>
NUXT_RUN_DUE_SECRET=<strong-random-32+-char-secret>
NUXT_SESSION_PASSWORD=<strong-random-32+-char-secret>
TZ=Asia/Kuala_Lumpur
```

**TZ=Asia/Kuala_Lumpur is mandatory.** The `notify-dispatch` task gates on MYT ≥ 09:00 via `todayMYT()`. If the process clock is UTC, the 09:00-MYT gate never aligns and no notifications fire during Malaysian business hours.

---

## 3. Production smoke check — croner (in-process scheduler)

After each deploy, verify the in-process croner actually fires:

```bash
# On the VPS, as the site user:
cd /home/fms/htdocs/fms.argontechs.dev

# 1. Build and reload
npm run build
pm2 reload ecosystem.config.cjs --update-env

# 2. Wait ~5-7 minutes, then check logs
pm2 logs money-fms --lines 200 --nostream | grep notify-dispatch
# Expected: at least one line like:
#   [notify-dispatch] 2026-06-19T03:05:00.000Z sent=0 skipped=2

# 3. Check post-recurring fired (after 06:00 UTC daily)
pm2 logs money-fms --lines 200 --nostream | grep post-recurring
# Expected: one line per day like:
#   [post-recurring] posted=2 interest=1
```

**If zero lines appear after 10 minutes:** croner did not start under the `node-server` preset (§13 concern). The OS-cron watchdog (§4 below) is then the **sole trigger** — confirm it is active before proceeding.

---

## 4. OS-cron watchdog — permanent setup

The watchdog is **permanent insurance** and must NOT be removed even after croner is confirmed working (§14 #10). It provides a fallback if the Nitro in-process scheduler fails to start, and a manual-trigger path during maintenance windows.

### Endpoint security model

- `/api/internal/run-due` is bound **only** to loopback (`127.0.0.1`).
- Nginx blocks all external access with `deny all` — no public internet exposure.
- A constant-time secret check (`x-run-due-secret: $NUXT_RUN_DUE_SECRET`) guards against loopback abuse.

Nginx config block (in the `money-fms` server block):

```nginx
location /api/internal/ {
    deny all;
    return 403;
}
```

### Install the watchdog cron (one-time)

Run as the `money` site user:

```bash
# Append the cron line (idempotent: check crontab -l first to avoid duplicates)
( crontab -l 2>/dev/null; \
  echo '*/5 * * * * TZ=Asia/Kuala_Lumpur curl -fsS -X POST -H "x-run-due-secret: '"$NUXT_RUN_DUE_SECRET"'" http://127.0.0.1:3000/api/internal/run-due >> /home/fms/logs/run-due.log 2>&1' \
) | crontab -

# Verify it was installed
crontab -l | grep run-due
```

**Critical details:**
- `TZ=Asia/Kuala_Lumpur` — sets the cron daemon's timezone so the 09:00-MYT gate in `runDispatch` receives the correct wall-clock time.
- `x-run-due-secret: $NUXT_RUN_DUE_SECRET` — must match `NUXT_RUN_DUE_SECRET` in PM2 process env (`pm2 env 0 | grep RUN_DUE`).
- `http://127.0.0.1:3000` — loopback only; never use the public hostname here.
- Log output to `/home/fms/logs/run-due.log` for audit trail.

### Verify the watchdog works

```bash
# Loopback call — must return 200
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST \
  -H "x-run-due-secret: $NUXT_RUN_DUE_SECRET" \
  http://127.0.0.1:3000/api/internal/run-due
# Expected: 200

# Public hostname — must return 403 (nginx deny block)
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST \
  https://fms.argontechs.dev/api/internal/run-due
# Expected: 403

# Wrong secret — must return 401
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST \
  -H "x-run-due-secret: wrong" \
  http://127.0.0.1:3000/api/internal/run-due
# Expected: 401
```

---

## 5. Web Push — end-to-end canary (real device)

1. Open `https://fms.argontechs.dev` in Safari on iPhone.
2. Share → Add to Home Screen → open from Home Screen (standalone mode required — notifications do not work in browser tab on iOS).
3. Tap "Turn on reminders" on the dashboard → grant permission.
4. Confirm the **"Reminders are working"** canary notification arrives within ~30 seconds.
5. On the VPS, confirm the subscription was stored:

```bash
sqlite3 /home/fms/data/money.sqlite \
  "SELECT id, substr(endpoint,1,40), failed_at FROM push_subscriptions;"
# Expected: one row, failed_at NULL
```

If `failed_at` is set, the push key mismatch is the most common cause — verify `NUXT_PUBLIC_VAPID_PUBLIC_KEY` in PM2 env matches the private key.

---

## 6. Payday "Transfer logged" action smoke (idempotency check)

1. Seed a payday income template with `next_due_date = todayMYT()`.
2. Wait for a `notify-dispatch` run (or trigger via watchdog curl).
3. Tap "Transfer logged" in the push notification.
4. Confirm exactly **one** transfer row and an EF balance increment:

```bash
sqlite3 /home/fms/data/money.sqlite \
  "SELECT id, amount_cents, uuid FROM transfers ORDER BY id DESC LIMIT 5;"
```

5. Tap "Transfer logged" again with the **same notification UUID** — confirm no second transfer row (idempotency guard).

---

## 7. Watchdog design notes

- **Why keep the watchdog even if croner works?** Croner is an in-process goroutine; it stops if the process crashes mid-interval, if PM2 restarts during a fire window, or if a future Nitro version changes scheduler behaviour. The OS-cron watchdog fires regardless of process state and provides a bounded 5-minute catch-up window.
- **Why loopback only?** The `/api/internal/run-due` endpoint triggers DB writes and push sends. Exposing it publicly (even with a secret) increases the attack surface. Loopback + nginx `deny all` means no secret leak exposes production.
- **Frequency:** `*/5 * * * *` matches the in-process `notify-dispatch` schedule. Both fire on the same 5-minute grid; only one will claim the `notifications_sent` dedup row per dispatch window (idempotent by design).

## Phase 5 — Deployment Runbook (CloudPanel + PM2)

> ⚠️ **Read [`CORRECTIONS.md`](./2026-06-18-personal-fms-CORRECTIONS.md) first.** It resolves cross-phase fixes (debt-leg sign, EF two-leg reads, env-var names, schema re-export, single savings-target, SPayLater seed template, task ordering) that **supersede any conflicting code below**.


> **GLOBAL CONSTRAINTS (binding on every task in this phase):** single-user; MYR only; integer sen, never float; WAL + foreign_keys=ON; idempotency = `transactions.uuid UNIQUE` + `UNIQUE(recurring_item_id,date)` + `notifications_sent UNIQUE(kind,ref_id,scheduled_for)`; all mutations are `requireSession`-gated POST/PATCH/DELETE (no state-changing GET); card interest is a separate carrying-cost ledger line (`category:'interest'`), excluded from `living` and `debt_service` in the rollup; `next_due_date` is the single "when due" field (recomputed in the atomic post); OS-cron `/api/internal/run-due` (loopback-bound, secret-gated) is a PERMANENT watchdog, not removed once croner works; `.gitignore` covers `.env`, `*.sqlite*`, `/data`, `/backups`; better-sqlite3 transactions are synchronous.

> **Phase nature:** this is a RUNBOOK. Unlike Phases 1–4 (TDD vitest cycles), the steps below are shell commands + verification assertions executed against the CloudPanel VPS. Each task lists **Files** (scripts/config Created on the box or committed to the repo), **Interfaces** (Consumes the artifacts produced by Phases 1–4 — `npm run db:migrate`, `npm run db:seed`, `npm run seed:user`, `.output/server/index.mjs`, `runtimeConfig.public.vapidPublicKey`, the `notify-dispatch`/`post-recurring` tasks, `/api/internal/run-due`, `/api/push/subscribe`), and **bite-sized Steps** each ending in a concrete **verification command + expected output**. "Commit" steps commit repo-tracked files (scripts, config, `.gitignore`); box-only files (`.env`, secrets) are NEVER committed.

> **Hard precondition for the whole phase (§12 note, §14.24):** the CloudPanel site-user naming on THIS box must be confirmed before any path is used. Task 5.0 establishes it. Every later task assumes site user `money`, home `/home/money`, docroot `/home/money/htdocs/money.argontechs.dev` — **substitute the real values from 5.0 if they differ**.

---

### Task 5.0: Confirm CloudPanel site-user naming + DNS (hard precondition)

**Files**
- Create (repo): `docs/deploy/RUNBOOK.md` (records the confirmed real values; living deploy doc)
- Modify: none
- Test: verification commands below (no vitest — infra check)

**Interfaces**
- Consumes: the existing PropertyCRM CloudPanel box as the naming reference (§12 note, §13).
- Produces: confirmed `SITE_USER`, `SITE_HOME`, `DOCROOT`, `NODE_VERSION` values reused by every later task; confirmed DNS A record.

**Steps**
- [ ] On the VPS as root, inspect existing CloudPanel sites to learn the real user convention: `ls -la /home && clpctl site:list 2>/dev/null || clpctl --help | head`. **Verify:** output lists the PropertyCRM site user and shows `/home/<user>` layout. Record the exact form (e.g. `money` vs `money-ssh`).
- [ ] Confirm no path mixing: `getent passwd | grep -E 'money|htdocs' || true` and `ls -d /home/*/htdocs/* 2>/dev/null`. **Verify:** the SSH user, docroot owner, and crontab owner will be ONE uniform name. Write it into `docs/deploy/RUNBOOK.md` under a `## Confirmed values (2026-06-18)` heading with literal lines `SITE_USER=money`, `SITE_HOME=/home/money`, `DOCROOT=/home/money/htdocs/money.argontechs.dev`, `NODE_VERSION=22`.
- [ ] Add the DNS A record `money` → VPS public IPv4 at the DNS provider (AAAA too if the box has IPv6). **Verify:** `dig +short money.argontechs.dev` returns the VPS public IP exactly (run `curl -s ifconfig.me` on the box to get the IP to compare). Do NOT proceed to the cert step (5.8) until this matches — Let's Encrypt HTTP-01 fails otherwise.
- [ ] Commit the runbook doc: `git add docs/deploy/RUNBOOK.md && git commit -m "docs(deploy): record confirmed CloudPanel site-user naming + DNS for money.argontechs.dev"`.

---

### Task 5.1: Repo hardening — `.gitignore` covers secrets, DB, data, backups (§14.12)

**Files**
- Modify (repo): `.gitignore`
- Test: `git check-ignore` assertions

**Interfaces**
- Consumes: the repo root (where `.env`, `/data`, `/backups` will live on the box; `*.sqlite*` is the dev/local DB).
- Produces: a repo guaranteed never to leak `.env`, the SQLite DB, or backups.

**Steps**
- [ ] Edit `.gitignore` to include exactly these lines (append if file exists, create if not):
  ```gitignore
  # secrets & runtime
  .env
  .env.*
  !.env.example
  # sqlite database + WAL/SHM sidecars
  *.sqlite
  *.sqlite-wal
  *.sqlite-shm
  *.sqlite3
  # box-local data & backups (never committed)
  /data
  /backups
  # build + deps
  node_modules
  .output
  .nuxt
  ```
- [ ] **Verify (this is the test):** run the assertions and confirm each prints the matching ignore rule (non-empty = ignored):
  ```bash
  git check-ignore -v .env data/money.sqlite data/money.sqlite-wal backups/money-20260618-030000.sqlite.gz .output/server/index.mjs
  ```
  Expected: five lines, each citing `.gitignore` (e.g. `.gitignore:2:.env  .env`). If any line is missing, the rule is wrong — fix before committing.
- [ ] **Verify** the allowlist exception works (so a documented template IS tracked): `git check-ignore .env.example || echo "TRACKED-OK"` → prints `TRACKED-OK` (the `!.env.example` negation un-ignores it).
- [ ] Create the committed template `.env.example` with the variable NAMES only and empty/placeholder values (no real secrets):
  ```bash
  NODE_ENV=production
  NITRO_HOST=127.0.0.1
  NITRO_PORT=3000
  TZ=Asia/Kuala_Lumpur
  DATABASE_URL=file:/home/money/data/money.sqlite
  VAPID_PUBLIC_KEY=
  NUXT_PUBLIC_VAPID_PUBLIC_KEY=
  VAPID_PRIVATE_KEY=
  VAPID_SUBJECT=mailto:yongwei1127@gmail.com
  NUXT_SESSION_PASSWORD=
  REGISTER_TOKEN=
  INTERNAL_RUN_DUE_SECRET=
  RCLONE_REMOTE=gdrive-money
  ```
- [ ] Commit: `git add .gitignore .env.example && git commit -m "chore(deploy): gitignore secrets/db/data/backups; add .env.example template"`.

---

### Task 5.2: Create the CloudPanel Node.js site (§12.1)

**Files**
- Create (on box): the site user, docroot, and nginx vhost (created by `clpctl`)
- Test: docroot + vhost existence checks

**Interfaces**
- Consumes: confirmed `SITE_USER`/`NODE_VERSION` from 5.0; `appPort=3000` matches `NITRO_PORT` (5.5) and the PM2 `script` port (5.6).
- Produces: Linux site user `money`, docroot `/home/money/htdocs/money.argontechs.dev`, nginx vhost reverse-proxying `→ 127.0.0.1:3000`.

**Steps**
- [ ] As root, create the site (use a strong generated password; capture it once into a password manager, never into the repo or logs):
  ```bash
  SITE_PW="$(openssl rand -base64 24)"
  clpctl site:add:nodejs \
    --domainName=money.argontechs.dev \
    --nodejsVersion=22 \
    --appPort=3000 \
    --siteUser=money \
    --siteUserPassword="$SITE_PW"
  ```
  Then store `$SITE_PW` in the password manager and `unset SITE_PW`.
- [ ] **Verify** the site user + docroot exist with correct ownership: `ls -ld /home/money/htdocs/money.argontechs.dev && stat -c '%U:%G' /home/money/htdocs/money.argontechs.dev`. Expected: directory exists, owned `money:money`.
- [ ] **Verify** the nginx vhost was generated and targets the loopback app port: `grep -Rn '127.0.0.1:3000' /etc/nginx/ 2>/dev/null || clpctl site:list`. Expected: a `proxy_pass http://127.0.0.1:3000;` line (or equivalent CloudPanel vhost config) exists for `money.argontechs.dev`.
- [ ] Append the confirmed site password location (not the value) and the vhost path to `docs/deploy/RUNBOOK.md`, then commit: `git add docs/deploy/RUNBOOK.md && git commit -m "docs(deploy): record CloudPanel nodejs site creation for money.argontechs.dev"`.

---

### Task 5.3: Clone code as the site user + verify the pinned Nitro preset (§12.2, §14.1, §14.4)

**Files**
- Create (on box): cloned repo at the docroot
- Modify: none (preset/tasks/runtimeConfig were authored in Phase 1 `nuxt.config.ts`; this task only VERIFIES them)
- Test: config-assertion commands

**Interfaces**
- Consumes: the Phase-1 `nuxt.config.ts` (`nitro.preset='node-server'`, `nitro.experimental.tasks=true`, FLAT `scheduledTasks` names — `notify-dispatch`, `post-recurring`, plus phase-2 `streak-rollover`/`checkin-weekly`; `runtimeConfig.public.vapidPublicKey=''`).
- Produces: source on the box ready to build; confirmation the deploy-critical config is correct BEFORE building.

**Steps**
- [ ] SSH as the **site user** (`ssh money@<vps>`), then clone into the docroot (note the trailing `.` to clone into the existing dir):
  ```bash
  cd /home/money/htdocs/money.argontechs.dev
  git clone https://github.com/<owner>/money-fms.git . 2>/dev/null || git clone git@github.com:<owner>/money-fms.git .
  ```
  **Verify:** `git -C /home/money/htdocs/money.argontechs.dev rev-parse --short HEAD` prints a commit SHA.
- [ ] **Verify the preset + experimental tasks flag are pinned** (deploy correctness gate): `node -e "const c=require('fs').readFileSync('nuxt.config.ts','utf8'); if(!/preset:\s*'node-server'/.test(c)) throw 'preset not node-server'; if(!/experimental:\s*{\s*tasks:\s*true/.test(c.replace(/\s+/g,' '))) throw 'tasks flag missing'; console.log('preset+tasks OK')"`. Expected stdout: `preset+tasks OK`.
- [ ] **Verify FLAT scheduledTask names match FLAT files (§14.1 — colon names would silently never fire):** confirm both the registration names and the files exist:
  ```bash
  grep -E "'(notify-dispatch|post-recurring)'" nuxt.config.ts && ls server/tasks/notify-dispatch.ts server/tasks/post-recurring.ts
  ```
  Expected: both names appear in `nuxt.config.ts` AND both files exist. If a name contains a colon (`notify:dispatch`) this FAILS the runbook — go back to Phase 1.
- [ ] **Verify `runtimeConfig.public.vapidPublicKey` is declared (§14.4 — runtime, not build-time):** `grep -E "vapidPublicKey:\s*''" nuxt.config.ts`. Expected: one match (declared empty, read via `useRuntimeConfig()` at runtime from `NUXT_PUBLIC_VAPID_PUBLIC_KEY`). **Also verify** no client code reads `import.meta.env` for the VAPID key: `! grep -rn "import.meta.env.*VAPID" app/ || (echo 'FAIL: build-time VAPID read found' && false)`. Expected: no output, exit 0.

---

### Task 5.4: Generate VAPID + secrets, write `.env` outside docroot, lock perms (§12.3, §14.4, §14.21, §14.23)

**Files**
- Create (on box, NEVER committed): `/home/money/htdocs/money.argontechs.dev/.env`
- Test: env-presence + perms + WAL-path assertions

**Interfaces**
- Consumes: `web-push generate-vapid-keys` (the `web-push` dep from Phase 1); `openssl`; the Phase-1 `server/plugins/webpush.ts` (reads `VAPID_*`), `requireSession`/session sealing (`NUXT_SESSION_PASSWORD`), `/api/auth/register` (`REGISTER_TOKEN`), `/api/internal/run-due` (`INTERNAL_RUN_DUE_SECRET`).
- Produces: a 600-perm `.env` with DB path OUTSIDE docroot, both VAPID public copies, the private key, session secret, register token, watchdog secret, and `TZ=Asia/Kuala_Lumpur` (§14.21).

**Steps**
- [ ] As the site user, generate the VAPID keypair ONCE and capture both keys (never rotate casually — rotation invalidates every push subscription, §8): `npx web-push generate-vapid-keys`. Copy the `Public Key:` and `Private Key:` values. The **public key is used twice** — server-side `VAPID_PUBLIC_KEY` and the client-exposed `NUXT_PUBLIC_VAPID_PUBLIC_KEY` (same value).
- [ ] Write `/home/money/htdocs/money.argontechs.dev/.env` with real values (DB path is OUTSIDE the docroot at `/home/money/data`; secrets via `openssl rand`):
  ```bash
  NODE_ENV=production
  NITRO_HOST=127.0.0.1
  NITRO_PORT=3000
  TZ=Asia/Kuala_Lumpur
  DATABASE_URL=file:/home/money/data/money.sqlite
  VAPID_PUBLIC_KEY=<public-key-from-web-push>
  NUXT_PUBLIC_VAPID_PUBLIC_KEY=<same-public-key>
  VAPID_PRIVATE_KEY=<private-key-from-web-push>
  VAPID_SUBJECT=mailto:yongwei1127@gmail.com
  NUXT_SESSION_PASSWORD=<openssl rand -hex 32>
  REGISTER_TOKEN=<openssl rand -hex 16>
  INTERNAL_RUN_DUE_SECRET=<openssl rand -hex 32>
  RCLONE_REMOTE=gdrive-money
  ```
  Fill secrets with literal command output, e.g. `NUXT_SESSION_PASSWORD=$(openssl rand -hex 32)` evaluated once and pasted (64 hex chars ≥ 32).
- [ ] Lock permissions: `chmod 600 /home/money/htdocs/money.argontechs.dev/.env`. **Verify:** `stat -c '%a %U' /home/money/htdocs/money.argontechs.dev/.env` → `600 money`.
- [ ] **Verify both VAPID public copies are identical AND the DB path is outside docroot:**
  ```bash
  set -a; . /home/money/htdocs/money.argontechs.dev/.env; set +a
  test "$VAPID_PUBLIC_KEY" = "$NUXT_PUBLIC_VAPID_PUBLIC_KEY" && echo "VAPID public match OK"
  case "$DATABASE_URL" in *htdocs*) echo "FAIL: db inside docroot"; false;; *) echo "DB path outside docroot OK";; esac
  test -n "$VAPID_PRIVATE_KEY" -a -n "$NUXT_SESSION_PASSWORD" -a -n "$REGISTER_TOKEN" -a -n "$INTERNAL_RUN_DUE_SECRET" && echo "secrets present OK"
  ```
  Expected: `VAPID public match OK`, `DB path outside docroot OK`, `secrets present OK`. Then `unset VAPID_PRIVATE_KEY NUXT_SESSION_PASSWORD REGISTER_TOKEN INTERNAL_RUN_DUE_SECRET` to clear the shell.

---

### Task 5.5: Create data/backups dirs, migrate + seed the DB, verify WAL + FK pragmas (§12.4, §10, §14.16)

**Files**
- Create (on box): `/home/money/data/` (700), `/home/money/backups/` (700), `/home/money/data/money.sqlite`
- Test: pragma + table-count + seed-sanity assertions

**Interfaces**
- Consumes: `npm run db:migrate` (Phase 1 Drizzle migrations in `server/db/migrations`), `npm run db:seed` (Phase 1 one-time seed of the 16 recurring templates + 7 debts + accounts + 2 goals), `server/db/index.ts` (sets `journal_mode=WAL` + `foreign_keys=ON` on init).
- Produces: a migrated, seeded `money.sqlite` at the runtime path; EF goal seeded at the RM1,000 starter (§14.16), card available_credit DERIVED not seeded (§14.2), payoff baseline frozen (§14.3).

**Steps**
- [ ] As the site user: `mkdir -p /home/money/data /home/money/backups /home/money/logs && chmod 700 /home/money/data /home/money/backups`. **Verify:** `stat -c '%a' /home/money/data /home/money/backups` → `700` and `700`.
- [ ] Install deps + run migrations + seed against the production DB path (Phase 1 npm scripts read `DATABASE_URL` from `.env`):
  ```bash
  cd /home/money/htdocs/money.argontechs.dev
  set -a; . ./.env; set +a
  npm ci
  npm run db:migrate
  npm run db:seed     # one-time only — single-user seed (§10)
  ```
  **Verify migrate created the DB file:** `ls -l /home/money/data/money.sqlite` → file exists, owned `money`.
- [ ] **Verify the mandated pragmas are live (WAL + FK):**
  ```bash
  sqlite3 /home/money/data/money.sqlite "PRAGMA journal_mode; PRAGMA foreign_keys;"
  ```
  Expected two lines: `wal` then `1`. (WAL persists as a DB property; `foreign_keys` is per-connection so confirm `server/db/index.ts` sets it on every connect — verified by Phase 1 tests; here we confirm the app's connection by checking a live request later in 5.10.)
- [ ] **Verify the v1 tables exist (the 8 shipped tables):**
  ```bash
  sqlite3 /home/money/data/money.sqlite ".tables"
  ```
  Expected to include: `accounts debts goals notifications_sent push_subscriptions recurring_items sessions transactions users`.
- [ ] **Verify seed sanity against the real figures (§ seed data):**
  ```bash
  sqlite3 /home/money/data/money.sqlite "SELECT count(*) FROM recurring_items;"   # expect 16
  sqlite3 /home/money/data/money.sqlite "SELECT balance_cents FROM debts WHERE name='Credit Card';"  # expect 740076
  sqlite3 /home/money/data/money.sqlite "SELECT payoff_baseline_cents FROM debts WHERE name='Credit Card';"  # expect 740076 (frozen at goal creation, §14.3)
  sqlite3 /home/money/data/money.sqlite "SELECT available_credit_cents FROM accounts WHERE type='card';"  # expect NULL/0 — DERIVED at read, never seeded (§14.2)
  sqlite3 /home/money/data/money.sqlite "SELECT target_amount_cents FROM goals WHERE name='Emergency Fund';"  # expect 100000 (RM1,000 starter, §14.16)
  ```
  Expected: `16`, `740076`, `740076`, NULL or empty (NOT a seeded limit−balance figure), `100000`.

---

### Task 5.6: Seed the single user via CLI (token never logged, §14.12, §9)

**Files**
- Create (on box): the single `users` row + (none persisted to repo)
- Test: users-count + no-token-in-logs assertions

**Interfaces**
- Consumes: `npm run seed:user` (Phase 4 CLI script — argon2id hash via `@node-rs/argon2`, writes ONE `users` row; reads password from a prompt/arg, NEVER prints the password or any token).
- Produces: the bootstrapped single user; closes the self-claim race (§9) by seeding via CLI rather than open registration.

**Steps**
- [ ] As the site user, run the user-seed CLI (Phase 4 provides `seed:user`; it prompts for the password on a TTY so it never lands in shell history):
  ```bash
  cd /home/money/htdocs/money.argontechs.dev
  set -a; . ./.env; set +a
  npm run seed:user
  ```
  Enter the owner password at the prompt. **Verify:** the command prints a success line WITHOUT echoing the password or `REGISTER_TOKEN`.
- [ ] **Verify exactly one user row exists and the hash is argon2id (not plaintext/bcrypt):**
  ```bash
  sqlite3 /home/money/data/money.sqlite "SELECT count(*) FROM users;"   # expect 1
  sqlite3 /home/money/data/money.sqlite "SELECT substr(password_hash,1,10) FROM users;"  # expect '$argon2id$'
  ```
  Expected: `1` and `$argon2id$`.
- [ ] **Verify no secret leaked to shell history or logs:** `! grep -RniE 'register_token|password=' ~/.bash_history /home/money/logs/ 2>/dev/null || (echo 'FAIL: secret in history/logs'; false)`. Expected: no output, exit 0. (Since the CLI prompts on TTY, the password is never an argv token.)

---

### Task 5.7: PM2 ONE fork app + reboot persistence via linger (§12.5, §14.24)

**Files**
- Modify (repo): `ecosystem.config.cjs` (verify it declares exactly ONE app `money-fms`, fork mode, `instances:1` — the `money-scheduler` second app must NOT exist)
- Create (on box): PM2 process, systemd unit, `pm2 save` dump
- Test: `pm2 jlist` + reboot-from-root assertions

**Interfaces**
- Consumes: the Phase-1 `ecosystem.config.cjs` (`script:'.output/server/index.mjs'`, `exec_mode:'fork'`, `instances:1`, `env_file:'.env'`); the built `.output/` (produced in 5.9).
- Produces: a single fork-mode `money-fms` process (app + in-process croner scheduler) that survives reboot via `loginctl enable-linger`.

**Steps**
- [ ] **Verify the config has exactly ONE app and it is fork/instances:1 (§14 BLOCKER — running two apps double-fires every notification):**
  ```bash
  cd /home/money/htdocs/money.argontechs.dev
  node -e "const c=require('./ecosystem.config.cjs'); if(c.apps.length!==1) throw 'expected 1 app, got '+c.apps.length; const a=c.apps[0]; if(a.name!=='money-fms') throw 'name '+a.name; if(a.exec_mode!=='fork'||a.instances!==1) throw 'not fork/instances:1'; if(/scheduler/.test(JSON.stringify(c))) throw 'money-scheduler must not exist'; console.log('PM2 config OK: single fork money-fms')"
  ```
  Expected: `PM2 config OK: single fork money-fms`.
- [ ] Build first (done fully in 5.9) then start under PM2: `pm2 start ecosystem.config.cjs && pm2 save`. **Verify:** `pm2 jlist | node -e "const a=JSON.parse(require('fs').readFileSync(0)); const p=a.find(x=>x.name==='money-fms'); console.log(p.pm2_env.status, p.pm2_env.exec_mode, p.pm2_env.instances)"`. Expected: `online fork 1`.
- [ ] Install the systemd boot unit for the **site user** (run the printed `sudo env PATH=... pm2 startup ...` line as root):
  ```bash
  pm2 startup systemd -u money --hp /home/money   # copy the printed sudo line, run it as root
  pm2 save
  ```
  **Verify the unit exists:** as root, `systemctl status pm2-money --no-pager | head -3` → shows `pm2-money.service` loaded.
- [ ] **Enable linger (the line that actually makes it survive reboot, §12.5/§14.24) — as root:** `loginctl enable-linger money`. **Verify:** `loginctl show-user money --property=Linger` → `Linger=yes`.
- [ ] **Reboot and verify FROM A ROOT SHELL (SSHing as the site user masks a missing linger, §14.24):**
  ```bash
  sudo reboot
  # after the box comes back, SSH as ROOT (not money), then:
  pgrep -u money -fa 'PM2|money-fms' && sudo -u money pm2 list
  ```
  Expected: a `money-fms` process owned by `money` is running, and `pm2 list` shows it `online` — **without any interactive site-user login having occurred**. If it is NOT running, linger failed — re-run `loginctl enable-linger money` and reboot again before proceeding.

---

### Task 5.8: nginx reverse proxy correctness + Let's Encrypt + Secure-cookie chain (§12.7, §14.6)

**Files**
- Modify (on box): the CloudPanel nginx vhost (ensure `X-Forwarded-Proto $scheme`, `Upgrade`, dotfile deny); install the cert via CloudPanel UI/clpctl
- Test: header + TLS + dotfile-403 + cookie-Secure assertions

**Interfaces**
- Consumes: the running `money-fms` on `127.0.0.1:3000` (5.7); confirmed DNS (5.0); the Phase-4 login handler that hard-sets the session cookie `httpOnly:true, secure:true, sameSite:'lax', domain:'money.argontechs.dev'` in code (§14.6 — `setCookie` does NOT auto-add Secure, and `X-Forwarded-Proto` is spoofable from loopback, so the cookie attributes are set in code, not inferred from the proto header).
- Produces: HTTPS at `money.argontechs.dev` with HTTP→HTTPS redirect, HSTS, dotfile deny, and a verified Secure session cookie.

**Steps**
- [ ] **Verify the app answers on the loopback before touching TLS:** `curl -sI http://127.0.0.1:3000/ | head -1`. Expected: `HTTP/1.1 200 OK` (or `302` to login). If this fails, fix the app (5.7/5.9) before the cert.
- [ ] Ensure the vhost forwards the proto header + websocket upgrade and denies dotfiles. In the CloudPanel vhost for `money.argontechs.dev`, confirm the proxy `location` block contains:
  ```nginx
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Host $host;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  location ~ /\. { deny all; return 403; }
  ```
  Reload nginx: as root `nginx -t && systemctl reload nginx`. **Verify config valid:** `nginx -t` → `syntax is ok` / `test is successful`.
- [ ] Issue the cert: CloudPanel → Sites → `money.argontechs.dev` → SSL/TLS → New Let's Encrypt Certificate → Create and Install (enables auto HTTP→HTTPS redirect + auto-renew). **Verify TLS + redirect:**
  ```bash
  curl -sI http://money.argontechs.dev/  | grep -i '^location:'   # expect https://money.argontechs.dev/
  curl -sI https://money.argontechs.dev/ | head -1                # expect HTTP/2 200 (or 302 to login)
  ```
  Expected: HTTP redirects to `https://`; HTTPS returns a 200/302.
- [ ] **Verify HSTS + dotfile deny + X-Forwarded-Proto reaching the app:**
  ```bash
  curl -sI https://money.argontechs.dev/ | grep -i 'strict-transport-security'   # expect HSTS header
  curl -sI https://money.argontechs.dev/.env                                       # expect 403
  ```
  Expected: an HSTS header present; `.env` request returns `403`.
- [ ] **Verify the session cookie is hard-set Secure (§14.6) — log in and inspect Set-Cookie:**
  ```bash
  curl -si https://money.argontechs.dev/api/auth/login -X POST \
    -H 'content-type: application/json' \
    -d '{"password":"<owner-password>"}' | grep -i '^set-cookie:'
  ```
  Expected: the `Set-Cookie` line contains `Secure`, `HttpOnly`, `SameSite=Lax`, and `Domain=money.argontechs.dev` (all four, set in code — NOT inferred from the spoofable proto header).

---

### Task 5.9: `deploy.sh` — git pull → npm ci → migrate → build → pm2 reload --update-env (NO .env-source-before-build, §12.8, §14.4)

**Files**
- Create (repo, deployed to box): `bin/deploy.sh` → installed at `/home/money/bin/deploy.sh`
- Test: shellcheck + dry-run + "no .env source before build" grep assertion + post-deploy bundle check

**Interfaces**
- Consumes: `git pull`, `npm ci`, `npm run db:migrate`, `npm run build` (Phase-1 build → `.output/server/index.mjs`), `pm2 reload ecosystem.config.cjs --update-env`. **Critically (§14.4): the VAPID public key is RUNTIME config read via `useRuntimeConfig()`** — so the build must NOT source `.env`; `pm2 reload --update-env` injects `NUXT_PUBLIC_VAPID_PUBLIC_KEY` at runtime.
- Produces: a repeatable, idempotent deploy script; migrations run before reload (new code never hits old schema).

**Steps**
- [ ] Write `bin/deploy.sh` with the EXACT content (note: NO `set -a; . ./.env` before `npm run build` — that line is deleted per §14.4):
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  cd /home/money/htdocs/money.argontechs.dev
  git pull --ff-only
  npm ci
  npm run db:migrate                              # before reload — new code never hits old schema
  npm run build                                   # VAPID public key is RUNTIME (useRuntimeConfig); do NOT source .env here (§14.4)
  pm2 reload ecosystem.config.cjs --update-env    # --update-env injects NUXT_PUBLIC_VAPID_PUBLIC_KEY at runtime
  pm2 save
  echo "Deployed money-fms @ $(git rev-parse --short HEAD)"
  ```
- [ ] **Verify the §14.4 anti-pattern is absent (this is the regression guard):** `! grep -E '\. ?\.?/?\.env' bin/deploy.sh && ! grep -E 'set -a' bin/deploy.sh && echo "no .env-source-before-build OK"`. Expected: `no .env-source-before-build OK`. If `set -a; . ./.env` appears before `npm run build`, the build would freeze a build-time key and break the runtime model — FAIL.
- [ ] **Verify the script is lint-clean and ordered (migrate before reload):** `shellcheck bin/deploy.sh && grep -n 'db:migrate' bin/deploy.sh | cut -d: -f1` must be less than `grep -n 'pm2 reload' bin/deploy.sh | cut -d: -f1`. Expected: shellcheck passes (no errors); migrate line number < reload line number.
- [ ] Install it on the box and run a real deploy: `mkdir -p /home/money/bin && cp bin/deploy.sh /home/money/bin/deploy.sh && chmod 700 /home/money/bin/deploy.sh && /home/money/bin/deploy.sh`. **Verify:** the final line prints `Deployed money-fms @ <sha>` and `pm2 jlist` shows `money-fms` `online` with a fresh restart time.
- [ ] **Verify the VAPID public key is actually in the served client bundle (§12.6 — a missing key fails every push silently):** `curl -s https://money.argontechs.dev/ | grep -o 'vapidPublicKey[^,}]*' | head -1` OR fetch the runtime config: `curl -s https://money.argontechs.dev/api/push/vapid-public-key 2>/dev/null` (if Phase-3 exposes it) — confirm it returns the same public key as `NUXT_PUBLIC_VAPID_PUBLIC_KEY`. Expected: the non-empty public key string is present in the client payload.
- [ ] Commit: `git add bin/deploy.sh && git commit -m "feat(deploy): deploy.sh (git pull/ci/migrate/build/pm2 reload --update-env, no .env source before build per §14.4)"`.

---

### Task 5.10: `backup-db.sh` — `.backup` → gzip → rclone to named Drive remote BEFORE prune, non-fatal+alert, chmod 600 (§9, §12.4, §14.7)

**Files**
- Create (repo, deployed to box): `bin/backup-db.sh` → `/home/money/bin/backup-db.sh`
- Create (on box, never committed): rclone config for the named remote `gdrive-money`
- Test: shellcheck + dry-run produces a valid gz on Drive + integrity of the snapshot + perms

**Interfaces**
- Consumes: `sqlite3 ".backup"` (WAL-safe hot snapshot — NEVER `cp`, §9/§14.7), `gzip`, `rclone copy` to the NAMED remote `$RCLONE_REMOTE` (`gdrive-money`), the live DB at `DATABASE_URL`.
- Produces: a daily gzipped consistent snapshot pushed off-box to Google Drive BEFORE any local prune, with a non-fatal upload + alert path, off-box retention, and `chmod 600` on archive + rclone config.

**Steps**
- [ ] Configure the NAMED Google Drive rclone remote on the box (interactive `rclone config` → name it exactly `gdrive-money`, type `drive`, OAuth). Then lock the config: `chmod 600 ~/.config/rclone/rclone.conf`. **Verify the named remote exists + auth works:** `rclone listremotes | grep -x 'gdrive-money:' && rclone about gdrive-money: --json | head -1`. Expected: `gdrive-money:` listed, `rclone about` returns JSON (auth OK).
- [ ] Write `bin/backup-db.sh` with rclone BEFORE prune, non-fatal upload + alert, off-box retention, chmod 600 (the §14.7 ordering is load-bearing — never prune local before the off-box copy succeeds):
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  DB=/home/money/data/money.sqlite
  DEST=/home/money/backups
  REMOTE="${RCLONE_REMOTE:-gdrive-money}:money-fms-backups"
  STAMP=$(date +%Y%m%d-%H%M%S)
  OUT="$DEST/money-$STAMP.sqlite"
  LOG="$DEST/backup.log"

  alert() { echo "[$(date -u +%FT%TZ)] BACKUP-ALERT: $*" | tee -a "$LOG" >&2; }

  # 1. WAL-safe consistent hot snapshot (NEVER cp — §9/§14.7)
  sqlite3 "$DB" ".backup '$OUT'"
  gzip "$OUT"
  ARCHIVE="$OUT.gz"
  chmod 600 "$ARCHIVE"

  # 2. Upload-size sanity check before trusting the archive
  SIZE=$(stat -c%s "$ARCHIVE")
  if [ "$SIZE" -lt 1024 ]; then alert "archive suspiciously small ($SIZE bytes) — aborting prune"; exit 1; fi

  # 3. OFF-BOX FIRST (non-fatal: alert but do not let a Drive outage kill local backup) — §14.7
  if rclone copy "$ARCHIVE" "$REMOTE/" --quiet; then
    if ! rclone lsf "$REMOTE/" | grep -q "$(basename "$ARCHIVE")"; then
      alert "rclone reported success but file not found on remote — NOT pruning local"; exit 1
    fi
    echo "[$(date -u +%FT%TZ)] off-box copy OK: $(basename "$ARCHIVE") ($SIZE bytes)" >> "$LOG"
  else
    alert "rclone copy to $REMOTE FAILED — keeping ALL local copies, skipping prune"; exit 1
  fi

  # 4. Prune ONLY after confirmed off-box copy: 14-day local + 60-day off-box retention
  find "$DEST" -name 'money-*.sqlite.gz' -mtime +14 -delete
  rclone delete "$REMOTE/" --min-age 60d --quiet || alert "off-box prune (60d) failed (non-fatal)"
  echo "[$(date -u +%FT%TZ)] backup complete" >> "$LOG"
  ```
- [ ] **Verify lint + the prune-after-upload ordering (the §14.7 invariant):** `shellcheck bin/backup-db.sh` (expect clean) and `awk '/rclone copy/{u=NR} /find .* -delete/{p=NR} END{exit !(u && p && u<p)}' bin/backup-db.sh && echo "rclone-before-prune OK"`. Expected: shellcheck clean; `rclone-before-prune OK`.
- [ ] Install and run once for real: `cp bin/backup-db.sh /home/money/bin/ && chmod 700 /home/money/bin/backup-db.sh && set -a; . /home/money/htdocs/money.argontechs.dev/.env; set +a; /home/money/bin/backup-db.sh`. **Verify the snapshot is valid + landed off-box + perms:**
  ```bash
  ls -l /home/money/backups/money-*.sqlite.gz | tail -1                        # archive exists
  stat -c '%a' "$(ls -t /home/money/backups/money-*.sqlite.gz | head -1)"      # expect 600
  rclone lsf gdrive-money:money-fms-backups/ | tail -1                          # same file on Drive
  zcat "$(ls -t /home/money/backups/money-*.sqlite.gz|head -1)" > /tmp/v.sqlite && sqlite3 /tmp/v.sqlite "PRAGMA integrity_check;" && rm /tmp/v.sqlite
  ```
  Expected: archive present (perm `600`), identically-named file on `gdrive-money:`, and `integrity_check` prints `ok`.
- [ ] Commit: `git add bin/backup-db.sh && git commit -m "feat(backup): backup-db.sh (.backup hot snapshot, rclone to named gdrive-money BEFORE prune, non-fatal+alert, chmod 600 per §14.7)"`.

---

### Task 5.11: `restore-verify.sh` — integrity_check + row-count + latest-timestamp + cron both jobs (§9, §12.4, §14.7)

**Files**
- Create (repo, deployed to box): `bin/restore-verify.sh` → `/home/money/bin/restore-verify.sh`
- Create (on box): two crontab lines (daily backup + restore-verify) for the site user
- Test: restore-from-latest-gz + integrity + row-count + freshness assertions; `crontab -l` check

**Interfaces**
- Consumes: the latest `*.sqlite.gz` produced by 5.10; `sqlite3`. "A backup never restored is not a backup" (§9).
- Produces: a self-checking restore drill (integrity_check + row-count + latest-transaction freshness) and the two installed cron jobs (backup at 03:15, restore-verify after it).

**Steps**
- [ ] Write `bin/restore-verify.sh` (restores the newest gz to scratch and asserts integrity + non-empty ledger + a recent transaction; §14.7 mandates integrity_check + row-count + latest-timestamp):
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  DEST=/home/money/backups
  LOG="$DEST/restore-verify.log"
  SCRATCH="$(mktemp -d)"
  trap 'rm -rf "$SCRATCH"' EXIT
  alert() { echo "[$(date -u +%FT%TZ)] RESTORE-VERIFY-ALERT: $*" | tee -a "$LOG" >&2; }

  LATEST="$(ls -t "$DEST"/money-*.sqlite.gz 2>/dev/null | head -1)"
  [ -n "$LATEST" ] || { alert "no backup archive found"; exit 1; }
  zcat "$LATEST" > "$SCRATCH/restore.sqlite"

  # 1. integrity_check
  IC="$(sqlite3 "$SCRATCH/restore.sqlite" 'PRAGMA integrity_check;')"
  [ "$IC" = "ok" ] || { alert "integrity_check FAILED on $LATEST: $IC"; exit 1; }

  # 2. row-count sanity (seeded data means these are never zero)
  RC="$(sqlite3 "$SCRATCH/restore.sqlite" 'SELECT count(*) FROM recurring_items;')"
  [ "$RC" -ge 16 ] || { alert "recurring_items row-count too low ($RC) in $LATEST"; exit 1; }
  UC="$(sqlite3 "$SCRATCH/restore.sqlite" 'SELECT count(*) FROM users;')"
  [ "$UC" -eq 1 ] || { alert "users row-count != 1 ($UC) in $LATEST"; exit 1; }

  # 3. latest-timestamp freshness — newest transaction (UTC epoch ms) within last 8 days, if any exist
  TXN="$(sqlite3 "$SCRATCH/restore.sqlite" 'SELECT count(*) FROM transactions;')"
  if [ "$TXN" -gt 0 ]; then
    MAXC="$(sqlite3 "$SCRATCH/restore.sqlite" 'SELECT max(created_at) FROM transactions;')"
    NOW_MS=$(( $(date +%s) * 1000 ))
    AGE_DAYS=$(( (NOW_MS - MAXC) / 86400000 ))
    [ "$AGE_DAYS" -le 8 ] || alert "newest transaction is $AGE_DAYS days old in $LATEST (stale?)"
  fi
  echo "[$(date -u +%FT%TZ)] restore-verify OK: $LATEST (integrity ok, recurring=$RC, users=$UC, txns=$TXN)" >> "$LOG"
  ```
- [ ] **Verify lint + a real restore-verify run against the archive from 5.10:** `shellcheck bin/restore-verify.sh` (expect clean), then `cp bin/restore-verify.sh /home/money/bin/ && chmod 700 /home/money/bin/restore-verify.sh && /home/money/bin/restore-verify.sh && tail -1 /home/money/backups/restore-verify.log`. Expected: shellcheck clean; log tail shows `restore-verify OK: ... (integrity ok, recurring=16, users=1, txns=...)`.
- [ ] Install BOTH cron jobs for the site user (backup at 03:15 MYT, restore-verify at 03:45 MYT — both env-sourced for `RCLONE_REMOTE`/`DATABASE_URL`; crontab `TZ` pins MYT):
  ```bash
  ( echo "TZ=Asia/Kuala_Lumpur"
    echo "15 3 * * * set -a; . /home/money/htdocs/money.argontechs.dev/.env; set +a; /home/money/bin/backup-db.sh >> /home/money/backups/backup.log 2>&1"
    echo "45 3 * * * /home/money/bin/restore-verify.sh >> /home/money/backups/restore-verify.log 2>&1"
  ) | crontab -u money -
  ```
  **Verify:** `crontab -u money -l` lists `TZ=Asia/Kuala_Lumpur`, the `backup-db.sh` line, and the `restore-verify.sh` line (backup time before restore-verify time).
- [ ] Commit: `git add bin/restore-verify.sh && git commit -m "feat(backup): restore-verify.sh (integrity_check + row-count + freshness) + install backup/restore-verify crons per §14.7"`.

---

### Task 5.12: OS-cron watchdog — permanent loopback-bound, secret-gated `/api/internal/run-due` (§8, §13, §14.10)

**Files**
- Create (repo, deployed to box): `bin/run-due-watchdog.sh` → `/home/money/bin/run-due-watchdog.sh`
- Create (on box): one crontab line for the site user
- Test: 403-without-secret + 200-with-secret + nginx-blocks-external assertions; `crontab -l` check

**Interfaces**
- Consumes: the Phase-3 `/api/internal/run-due` handler (bound to `127.0.0.1`, requires `INTERNAL_RUN_DUE_SECRET` via constant-time compare; runs the same due-scan the in-process croner runs — `notify-dispatch` + `post-recurring` catch-up over the 5-minute payday/bill window, §14.10).
- Produces: a PERMANENT standing-insurance watchdog (NOT removed once croner works, §14.10) that hits the loopback endpoint every 5 minutes; nginx must never proxy `/api/internal/*` from outside.

**Steps**
- [ ] Ensure nginx denies `/api/internal/*` from the public side. In the vhost, add (above the catch-all proxy block): `location ^~ /api/internal/ { deny all; return 404; }`. Reload: as root `nginx -t && systemctl reload nginx`. **Verify external block:** `curl -sI https://money.argontechs.dev/api/internal/run-due` → `404` (or `403`); the endpoint is unreachable from the internet.
- [ ] Write `bin/run-due-watchdog.sh` (hits the loopback port directly with the secret header; non-fatal so a transient failure doesn't spam):
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  : "${INTERNAL_RUN_DUE_SECRET:?missing INTERNAL_RUN_DUE_SECRET}"
  CODE=$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST http://127.0.0.1:3000/api/internal/run-due \
    -H "x-internal-secret: ${INTERNAL_RUN_DUE_SECRET}" \
    --max-time 30 || echo 000)
  echo "[$(date -u +%FT%TZ)] run-due watchdog http=$CODE"
  [ "$CODE" = "200" ] || exit 1
  ```
- [ ] **Verify the endpoint is loopback-bound + secret-gated (constant-time compare lives in Phase 3; here we confirm the gate behaves):**
  ```bash
  set -a; . /home/money/htdocs/money.argontechs.dev/.env; set +a
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/internal/run-due                                              # expect 401/403
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/internal/run-due -H "x-internal-secret: $INTERNAL_RUN_DUE_SECRET"  # expect 200
  ```
  Expected: missing-secret → `401` or `403`; correct-secret → `200`.
- [ ] Install the script + cron line (every 5 minutes, matching the in-process `*/5` cadence so the watchdog catches the same window):
  ```bash
  cp bin/run-due-watchdog.sh /home/money/bin/ && chmod 700 /home/money/bin/run-due-watchdog.sh
  ( crontab -u money -l; echo "*/5 * * * * set -a; . /home/money/htdocs/money.argontechs.dev/.env; set +a; /home/money/bin/run-due-watchdog.sh >> /home/money/logs/run-due.log 2>&1" ) | crontab -u money -
  ```
  **Verify:** `crontab -u money -l | grep run-due-watchdog` shows the `*/5` line. This watchdog is PERMANENT (§14.10) — do not remove it after confirming croner.
- [ ] Commit: `git add bin/run-due-watchdog.sh && git commit -m "feat(deploy): permanent loopback/secret-gated run-due watchdog cron + nginx deny /api/internal/* per §14.10"`.

---

### Task 5.13: Croner smoke test — confirm in-process scheduler actually fires under `node-server` (§8, §13, §14.1)

**Files**
- Modify: none (reads PM2 logs produced by the running app)
- Test: log-grep assertions that `notify-dispatch` and `post-recurring` register + fire

**Interfaces**
- Consumes: the running `money-fms` process (5.7); the Phase-1/Phase-3 tasks `notify-dispatch` (cron `*/5 * * * *`) and `post-recurring` (daily). Each task is expected to log a recognizable start line (e.g. `[notify-dispatch] run …` keyed off `todayMYT()`).
- Produces: positive confirmation that croner starts under the `node-server` preset (§13 gating risk: "smoke-test task fires before trusting the habit engine"); confirmation the FLAT names register (§14.1).

**Steps**
- [ ] **Verify the tasks REGISTERED at boot** (Nitro logs registered scheduled tasks on startup): `pm2 logs money-fms --lines 200 --nostream | grep -iE 'task|scheduledTask|notify-dispatch|post-recurring'`. Expected: lines showing `notify-dispatch` and `post-recurring` registered (NOT a `notify:dispatch` colon form — a colon would resolve to `server/tasks/notify/dispatch.ts` and silently never fire, §14.1).
- [ ] **Verify `notify-dispatch` actually FIRES on the `*/5` cadence.** Note the current time, then wait for the next 5-minute boundary and re-read logs: `pm2 logs money-fms --lines 100 --nostream | grep '\[notify-dispatch\]'`. Expected: at least one fresh `[notify-dispatch] run` line dated within the last ~5 minutes (MYT, from `todayMYT()`). If nothing fires within 6 minutes, croner did NOT start under the preset → the OS-cron watchdog (5.12) is the active fallback; record this in `docs/deploy/RUNBOOK.md` and escalate (this is the §13 gating risk).
- [ ] **Verify idempotency holds across fires (no double-send):** `sqlite3 /home/money/data/money.sqlite "SELECT kind, ref_id, scheduled_for, count(*) FROM notifications_sent GROUP BY kind, ref_id, scheduled_for HAVING count(*) > 1;"`. Expected: NO rows (the `UNIQUE(kind,ref_id,scheduled_for)` constraint + the dispatcher's pre-check guarantee exactly-once, even though both in-process croner AND the 5.12 watchdog can trigger the scan).
- [ ] **Verify the watchdog + croner do not double-post recurring items:** `sqlite3 /home/money/data/money.sqlite "SELECT recurring_item_id, date, count(*) FROM transactions WHERE recurring_item_id IS NOT NULL GROUP BY recurring_item_id, date HAVING count(*) > 1;"`. Expected: NO rows (`UNIQUE(recurring_item_id, date)` backstops auto-post double-fire from either trigger).
- [ ] Record the croner-fires result (PASS = in-process active; FAIL = watchdog-only) in `docs/deploy/RUNBOOK.md` and commit: `git add docs/deploy/RUNBOOK.md && git commit -m "docs(deploy): record croner smoke-test result under node-server preset (§13 gating risk)"`.

---

### Task 5.14: End-to-end `subscribe()` smoke test — real push delivery (§8, §12.6, §14.4)

**Files**
- Modify: none (exercises the live app + a real installed PWA)
- Test: subscription-row + canary-push-received assertions

**Interfaces**
- Consumes: the live HTTPS app (5.8); `runtimeConfig.public.vapidPublicKey` served at runtime (5.9 verified it is non-empty); the Phase-3 `requireSession`-gated `POST /api/push/subscribe`; `server/plugins/webpush.ts` (VAPID signing); the iPhone confirmed device (§13) — iOS push works ONLY when installed to Home Screen (standalone).
- Produces: a verified end-to-end push path — a real subscription row + a delivered canary notification — closing the §12.6 silent-failure risk ("a missing key fails every push silently with no server error").

**Steps**
- [ ] On the confirmed iPhone, open `https://money.argontechs.dev` in Safari, **Share → Add to Home Screen**, then open the installed (standalone) app and log in. **Verify standalone:** the app's iOS health signal (§8) shows "running standalone" (not the "Add to Home Screen" banner). iOS web push only works standalone — a Safari tab silently fails.
- [ ] In the standalone app, tap **"Turn on reminders"** (user-gesture-initiated, required by iOS) → accept the permission prompt → the client calls `pushManager.subscribe({userVisibleOnly:true, applicationServerKey:<vapidPublicKey>})` → `POST /api/push/subscribe`. **Verify the subscription row landed (and the endpoint is session-gated, not open):**
  ```bash
  sqlite3 /home/money/data/money.sqlite "SELECT id, substr(endpoint,1,40), user_agent, failed_at FROM push_subscriptions ORDER BY id DESC LIMIT 1;"
  ```
  Expected: a fresh row with a real `endpoint`, an iPhone user-agent, and `failed_at` NULL.
- [ ] **Verify the open-subscribe attack is blocked (§9/§14.12 — /api/push/subscribe is gated):** `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://money.argontechs.dev/api/push/subscribe -H 'content-type: application/json' -d '{"endpoint":"https://x","keys":{"p256dh":"x","auth":"x"}}'`. Expected: `401` (no session cookie → `requireSession` throws). An unauthenticated subscribe MUST NOT create a row.
- [ ] **Verify a real canary push is DELIVERED end-to-end.** Trigger the "reminders are working" canary (§8) — either the app's post-enable canary, or fire `notify-dispatch` manually via the secret-gated watchdog when a reminder is due: `set -a; . /home/money/htdocs/money.argontechs.dev/.env; set +a; curl -s -X POST http://127.0.0.1:3000/api/internal/run-due -H "x-internal-secret: $INTERNAL_RUN_DUE_SECRET"`. **Verify:** the canary notification physically appears on the iPhone Home-Screen-installed app AND `pm2 logs money-fms --lines 50 --nostream | grep -iE 'web-push|push send'` shows a successful send (no `404/410`). If the device receives nothing but logs show success, re-check `NUXT_PUBLIC_VAPID_PUBLIC_KEY` equals `VAPID_PUBLIC_KEY` (5.4) — a public/private mismatch is the classic silent failure.
- [ ] **Verify failed-subscription pruning works (defensive):** confirm a `404/410` from `web-push` sets `failed_at` (inspect after any stale endpoint): `sqlite3 /home/money/data/money.sqlite "SELECT count(*) FROM push_subscriptions WHERE failed_at IS NOT NULL;"`. Expected: `0` for the just-created live subscription (it is healthy). Record the end-to-end PASS in `docs/deploy/RUNBOOK.md` and commit: `git add docs/deploy/RUNBOOK.md && git commit -m "docs(deploy): record subscribe() end-to-end push smoke-test PASS on iPhone standalone (§12.6)"`.

---

#### Phase deliverable & how to verify

**Deliverable:** the Personal-FMS PWA live at `https://money.argontechs.dev` — HTTPS via Let's Encrypt, ONE PM2 fork app (`money-fms`, app + in-process croner) surviving reboot via `loginctl enable-linger`, daily WAL-safe `.backup` snapshots gzipped and pushed off-box to the named `gdrive-money` remote BEFORE local prune, a restore-verify cron proving the backups restore (`integrity_check` + row-count + freshness), a permanent loopback/secret-gated `/api/internal/run-due` OS-cron watchdog behind the in-process scheduler, and a verified end-to-end push subscription on the iPhone.

**Single end-to-end verification pass (run from a ROOT shell after a fresh `sudo reboot`):**
1. `dig +short money.argontechs.dev` → VPS IP; `curl -sI https://money.argontechs.dev/ | head -1` → `200/302`; HTTP→HTTPS redirect + HSTS present (5.8).
2. `sudo -u money pm2 jlist | grep -c '"name":"money-fms"'` → `1`, status `online`, `exec_mode:fork`, `instances:1`; `loginctl show-user money -p Linger` → `Linger=yes` (5.7).
3. `sqlite3 /home/money/data/money.sqlite "PRAGMA journal_mode; PRAGMA integrity_check;"` → `wal` / `ok`; `.tables` shows all 9 v1 tables; `recurring_items=16`, `users=1`, card `balance_cents=740076`, `payoff_baseline_cents=740076`, EF target `100000` (5.5/5.6).
4. `crontab -u money -l` → three jobs (`backup-db.sh` 03:15, `restore-verify.sh` 03:45, `run-due-watchdog.sh` `*/5`) under `TZ=Asia/Kuala_Lumpur`; `tail -1 /home/money/backups/restore-verify.log` → `restore-verify OK`; newest `gdrive-money:money-fms-backups/` object matches the local archive (5.10/5.11/5.12).
5. `curl -sI https://money.argontechs.dev/.env` → `403`; `curl -sI https://money.argontechs.dev/api/internal/run-due` → `404`; unauthenticated `POST /api/push/subscribe` → `401`; login `Set-Cookie` carries `Secure; HttpOnly; SameSite=Lax; Domain=money.argontechs.dev` (5.8/5.12/5.14).
6. `pm2 logs money-fms --nostream` shows `notify-dispatch` firing on `*/5`; `notifications_sent` and `transactions(recurring_item_id,date)` have ZERO duplicate groups (5.13); a real canary push lands on the iPhone Home-Screen app (5.14).

**Files produced (repo-tracked):** `/Users/brendxn___/Desktop/Personal-FMS/.gitignore`, `.env.example`, `bin/deploy.sh`, `bin/backup-db.sh`, `bin/restore-verify.sh`, `bin/run-due-watchdog.sh`, `docs/deploy/RUNBOOK.md`. **Files produced (box-only, never committed):** `/home/money/htdocs/money.argontechs.dev/.env` (chmod 600), `/home/money/.config/rclone/rclone.conf` (chmod 600), `/home/money/data/money.sqlite`, `ecosystem.config.cjs` PM2 dump, the site-user crontab, the `pm2-money` systemd unit.
#!/usr/bin/env bash
# bin/restore-verify.sh — gunzip latest backup, integrity_check, row-count, freshness
# Usage: bash bin/restore-verify.sh
# "A backup never restored is not a backup."
set -euo pipefail

DEST="${BACKUP_DIR:-/home/argontechs-fms/backups}"
LOG="$DEST/restore-verify.log"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

mkdir -p "$DEST"

alert() {
  echo "[$(date -u +%FT%TZ)] RESTORE-VERIFY-ALERT: $*" | tee -a "$LOG" >&2
}

# ---------------------------------------------------------------------------
# 1. Find the latest backup archive
# ---------------------------------------------------------------------------
LATEST="$(ls -t "$DEST"/money-*.sqlite.gz 2>/dev/null | head -1 || true)"
if [ -z "$LATEST" ]; then
  alert "no backup archive found in $DEST"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Decompress to scratch
# ---------------------------------------------------------------------------
gunzip -c "$LATEST" > "$SCRATCH/restore.sqlite"

# ---------------------------------------------------------------------------
# 3. PRAGMA integrity_check
# ---------------------------------------------------------------------------
IC="$(sqlite3 "$SCRATCH/restore.sqlite" 'PRAGMA integrity_check;')"
if [ "$IC" != "ok" ]; then
  alert "integrity_check FAILED on $LATEST: $IC"
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Row-count sanity (seed data means recurring_items is never zero)
# ---------------------------------------------------------------------------
RC="$(sqlite3 "$SCRATCH/restore.sqlite" 'SELECT count(*) FROM recurring_items;')"
if [ "$RC" -lt 1 ]; then
  alert "recurring_items row-count is 0 in $LATEST"
  exit 1
fi

UC="$(sqlite3 "$SCRATCH/restore.sqlite" 'SELECT count(*) FROM users;')"
if [ "$UC" -lt 1 ]; then
  alert "users row-count is 0 in $LATEST"
  exit 1
fi

# ---------------------------------------------------------------------------
# 5. Latest-timestamp freshness check (only if transactions exist)
# ---------------------------------------------------------------------------
TXN="$(sqlite3 "$SCRATCH/restore.sqlite" 'SELECT count(*) FROM transactions;')"
AGE_DAYS=0
if [ "$TXN" -gt 0 ]; then
  MAXC="$(sqlite3 "$SCRATCH/restore.sqlite" 'SELECT max(created_at) FROM transactions;')"
  NOW_MS=$(( $(date +%s) * 1000 ))
  AGE_DAYS=$(( (NOW_MS - MAXC) / 86400000 ))
  if [ "$AGE_DAYS" -gt 8 ]; then
    alert "newest transaction is $AGE_DAYS days old in $LATEST (stale? check for missed backups)"
    # Non-fatal warning: don't exit 1 for a stale timestamp during initial setup
  fi
fi

echo "[$(date -u +%FT%TZ)] restore-verify OK: $LATEST (integrity=ok, recurring=$RC, users=$UC, txns=$TXN, age_days=$AGE_DAYS)" | tee -a "$LOG"

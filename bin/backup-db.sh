#!/usr/bin/env bash
# bin/backup-db.sh — WAL-safe hot snapshot → gzip → rclone to Google Drive → prune local
# Usage: bash bin/backup-db.sh
# Reads DB/path config from env; defaults suit the VPS layout.
# Designed to run safely on a local dev machine: rclone step is skipped/warned
# if the remote is not configured (does NOT abort).
set -euo pipefail

DB="${DB:-${DATABASE_URL#file:}}"
DB="${DB:-/home/argontechs-fms/data/money.sqlite}"
DEST="${BACKUP_DIR:-/home/argontechs-fms/backups}"
REMOTE="${RCLONE_REMOTE:-gdrive-money}:money-fms-backups"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/money-$STAMP.sqlite"
LOG="$DEST/backup.log"

# Ensure the destination directory exists
mkdir -p "$DEST"

alert() {
  echo "[$(date -u +%FT%TZ)] BACKUP-ALERT: $*" | tee -a "$LOG" >&2
}

# ---------------------------------------------------------------------------
# 1. WAL-safe consistent hot snapshot (NEVER cp — cp can catch a mid-WAL write)
# ---------------------------------------------------------------------------
sqlite3 "$DB" ".backup '$OUT'"
gzip "$OUT"
ARCHIVE="${OUT}.gz"
chmod 600 "$ARCHIVE"

echo "[$(date -u +%FT%TZ)] snapshot created: $ARCHIVE" | tee -a "$LOG"

# ---------------------------------------------------------------------------
# 2. Upload-size sanity check
# ---------------------------------------------------------------------------
SIZE=$(stat -c%s "$ARCHIVE" 2>/dev/null || stat -f%z "$ARCHIVE")
if [ "$SIZE" -lt 1024 ]; then
  alert "archive suspiciously small ($SIZE bytes) — aborting"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. OFF-BOX copy BEFORE any prune (non-fatal: Drive outage != lost local copy)
# ---------------------------------------------------------------------------
RCLONE_OK=false
if command -v rclone >/dev/null 2>&1; then
  if rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE:-gdrive-money}:"; then
    if rclone copy "$ARCHIVE" "$REMOTE/" --quiet 2>>"$LOG"; then
      if rclone lsf "$REMOTE/" 2>/dev/null | grep -q "$(basename "$ARCHIVE")"; then
        RCLONE_OK=true
        echo "[$(date -u +%FT%TZ)] off-box copy OK: $(basename "$ARCHIVE") (${SIZE} bytes)" >> "$LOG"
      else
        alert "rclone reported success but file not found on remote — NOT pruning local"
        exit 1
      fi
    else
      alert "rclone copy to $REMOTE FAILED — keeping ALL local copies, skipping prune"
      exit 1
    fi
  else
    echo "[$(date -u +%FT%TZ)] WARNING: rclone remote '${RCLONE_REMOTE:-gdrive-money}' not configured — skipping off-box copy (local backup still created)" | tee -a "$LOG" >&2
    # On a dev machine without the remote configured: treat this as non-fatal.
    RCLONE_OK=true  # allow local prune to proceed; no off-box data to protect
  fi
else
  echo "[$(date -u +%FT%TZ)] WARNING: rclone not installed — skipping off-box copy (local backup still created)" | tee -a "$LOG" >&2
  RCLONE_OK=true
fi

# ---------------------------------------------------------------------------
# 4. Prune ONLY after confirmed off-box copy (or deliberate dev-mode skip)
# ---------------------------------------------------------------------------
if [ "$RCLONE_OK" = "true" ]; then
  find "$DEST" -name 'money-*.sqlite.gz' -mtime +14 -delete 2>/dev/null || true
  if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE:-gdrive-money}:"; then
    rclone delete "$REMOTE/" --min-age 60d --quiet 2>>"$LOG" || alert "off-box prune (60d) failed (non-fatal)"
  fi
fi

echo "[$(date -u +%FT%TZ)] backup complete: $(basename "$ARCHIVE")" | tee -a "$LOG"

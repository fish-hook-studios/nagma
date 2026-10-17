#!/usr/bin/env bash
# Nagma: back up (or restore) the server's data volume: files, accounts, uploads, sites.
#
#   sudo bash tools/backup.sh                       # backups/nagma-data-<time>.tar.gz
#   sudo bash tools/backup.sh --remote b2:my-bucket # and copy it there with rclone
#   sudo bash tools/backup.sh --restore backups/nagma-data-20261018-030000.tar.gz
#
# The remote can also come from NAGMA_BACKUP_REMOTE (in .env or the environment); it's any rclone
# remote you set up with `rclone config`. Old local backups beyond --keep (default 14) are removed.
# A nightly backup: `sudo crontab -e`, then
#   0 3 * * * bash /opt/nagma/tools/backup.sh --quiet
# Guide: docs/self-hosting.md.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
OUT_DIR="${NAGMA_BACKUP_DIR:-$APP_DIR/backups}"
VOLUME="${NAGMA_VOLUME:-}"
REMOTE="${NAGMA_BACKUP_REMOTE:-}"
KEEP=14
STOP=0
QUIET=0
DRY_RUN=0
RESTORE=""

usage() {
    cat <<'EOF'
Usage: backup.sh [options]

  --out DIR         Where backups go (default <nagma>/backups).
  --remote REMOTE   Also copy the backup to this rclone remote (e.g. b2:nagma-backups).
  --keep N          Local backups to keep (default 14; 0 keeps all).
  --stop            Stop Nagma while copying, for a backup taken at one instant.
  --volume NAME     The data volume (default: the compose project's nagma-data).
  --restore FILE    Replace the data with a backup (stops Nagma, then starts it again).
  --dry-run         Print the steps; change nothing.
  --quiet           Only print errors (for cron).
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --out) OUT_DIR="${2:-}"; shift 2 ;;
        --remote) REMOTE="${2:-}"; shift 2 ;;
        --keep) KEEP="${2:-}"; shift 2 ;;
        --stop) STOP=1; shift ;;
        --volume) VOLUME="${2:-}"; shift 2 ;;
        --restore) RESTORE="${2:-}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --quiet) QUIET=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

say() { [ "$QUIET" = 1 ] || printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
run() {
    if [ "$DRY_RUN" = 1 ]; then printf '  [dry run] %s\n' "$*"; else "$@"; fi
}
[[ "$KEEP" =~ ^[0-9]+$ ]] || die "--keep takes a number."

# The remote from .env when it isn't given.
if [ -z "$REMOTE" ] && [ -f "$APP_DIR/.env" ]; then
    REMOTE="$(sed -n 's/^NAGMA_BACKUP_REMOTE=//p' "$APP_DIR/.env" | tail -1)"
fi

COMPOSE=(docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml")
if [ "$DRY_RUN" != 1 ]; then
    command -v docker >/dev/null 2>&1 || die "Docker isn't installed."
fi
if [ -z "$VOLUME" ]; then
    if [ "$DRY_RUN" != 1 ]; then
        VOLUME="$(docker volume ls -q --filter label=com.docker.compose.project=nagma --filter label=com.docker.compose.volume=nagma-data | head -1)"
    fi
    VOLUME="${VOLUME:-nagma_nagma-data}"
fi

# ---- Restore ----

if [ -n "$RESTORE" ]; then
    [ "$DRY_RUN" = 1 ] || [ -f "$RESTORE" ] || die "No backup at $RESTORE."
    FILE_DIR="$(cd "$(dirname "$RESTORE")" 2>/dev/null && pwd || dirname "$RESTORE")"
    FILE_NAME="$(basename "$RESTORE")"
    say "Restoring $FILE_NAME into the volume $VOLUME. What's there now is replaced."
    run "${COMPOSE[@]}" stop nagma
    run docker run --rm -v "$VOLUME:/data" -v "$FILE_DIR:/backup:ro" alpine sh -c "find /data -mindepth 1 -delete && tar xzf /backup/$FILE_NAME -C /data && chown -R 1000:1000 /data"
    run "${COMPOSE[@]}" start nagma
    say "Restored. Nagma is starting again."
    exit 0
fi

# ---- Back up ----

STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="nagma-data-$STAMP.tar.gz"
run mkdir -p "$OUT_DIR"
OUT_ABS="$(cd "$OUT_DIR" 2>/dev/null && pwd || echo "$OUT_DIR")"

if [ "$STOP" = 1 ]; then run "${COMPOSE[@]}" stop nagma; fi
say "Backing up the volume $VOLUME to $OUT_ABS/$NAME."
status=0
run docker run --rm -v "$VOLUME:/data:ro" -v "$OUT_ABS:/backup" alpine tar czf "/backup/$NAME" -C /data . || status=$?
if [ "$STOP" = 1 ]; then run "${COMPOSE[@]}" start nagma; fi
[ "$status" = 0 ] || die "The backup failed (tar exited with $status)."
[ "$DRY_RUN" = 1 ] || chmod 600 "$OUT_ABS/$NAME"

if [ -n "$REMOTE" ]; then
    if command -v rclone >/dev/null 2>&1 || [ "$DRY_RUN" = 1 ]; then
        say "Copying it to $REMOTE."
        run rclone copy "$OUT_ABS/$NAME" "$REMOTE"
    else
        printf 'warning: rclone isn'"'"'t installed, so the backup stays local only (curl https://rclone.org/install.sh | sudo bash).\n' >&2
    fi
fi

if [ "$KEEP" -gt 0 ] && [ "$DRY_RUN" != 1 ]; then
    # Newest first; everything past the first KEEP goes.
    ls -1t "$OUT_ABS"/nagma-data-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f -- "$old"; done
fi
say "Done: $OUT_ABS/$NAME"

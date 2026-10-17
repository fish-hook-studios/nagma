#!/usr/bin/env bash
# Nagma: one-command install on a fresh Ubuntu or Debian server.
#
#   curl -fsSL https://raw.githubusercontent.com/fish-hook-studios/nagma/main/tools/install.sh | sudo bash
#   sudo bash tools/install.sh                # from a checkout
#   bash tools/install.sh --dry-run           # show what it would do, change nothing
#
# It installs Docker when it's missing, gets Nagma's source (this checkout, or a clone into
# /opt/nagma), asks for your domain, admin email and (optionally) mail settings, writes .env, starts
# docker compose (with Caddy for automatic HTTPS when you give a domain) and prints the address.
# Run it again to change settings: the existing .env is kept (backed up) unless you answer again.
# Every prompt has a flag, for unattended installs; see --help. Guide: docs/self-hosting.md.

set -euo pipefail

REPO_URL="${NAGMA_REPO:-https://github.com/fish-hook-studios/nagma.git}"
REPO_REF="${NAGMA_REF:-main}"
INSTALL_DIR="${NAGMA_DIR:-/opt/nagma}"
DRY_RUN=0
ASSUME_YES=0
SOURCE_DIR=""
DOMAIN="${NAGMA_DOMAIN:-}"
ADMIN_EMAIL="${NAGMA_ADMIN_EMAIL:-}"
SERVER_NAME="${NAGMA_SERVER_NAME:-}"
SMTP_URL="${NAGMA_SMTP_URL:-}"
MAIL_FROM="${NAGMA_MAIL_FROM:-}"
HTTP_PORT="${NAGMA_HTTP_PORT:-8080}"
ASKED_DOMAIN=0

usage() {
    cat <<'EOF'
Usage: install.sh [options]

  --domain NAME        Domain for HTTPS (an A record must point at this server). Empty: plain HTTP.
  --admin-email EMAIL  The server admin's email (the account to create first).
  --name NAME          Server name shown in the apps' server picker (default "Nagma").
  --smtp-url URL       Mail server, smtp://user:pass@host:587 or smtps://user:pass@host:465 (optional).
  --mail-from EMAIL    Sender address for mail (optional).
  --port PORT          Port for plain HTTP when there's no domain (default 8080).
  --dir PATH           Where to put Nagma when not run from a checkout (default /opt/nagma).
  --source PATH        Use this checkout instead of cloning.
  --repo URL --ref REF Where to clone from (default the main branch of the Nagma repository).
  --yes                Don't ask: use the flags and defaults (for scripts).
  --dry-run            Print every step and the .env it would write; change nothing.
  -h, --help           This help.
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --domain) DOMAIN="${2:-}"; ASKED_DOMAIN=1; shift 2 ;;
        --admin-email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
        --name) SERVER_NAME="${2:-}"; shift 2 ;;
        --smtp-url) SMTP_URL="${2:-}"; shift 2 ;;
        --mail-from) MAIL_FROM="${2:-}"; shift 2 ;;
        --port) HTTP_PORT="${2:-}"; shift 2 ;;
        --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
        --source) SOURCE_DIR="${2:-}"; shift 2 ;;
        --repo) REPO_URL="${2:-}"; shift 2 ;;
        --ref) REPO_REF="${2:-}"; shift 2 ;;
        --yes|-y) ASSUME_YES=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
# Runs a command, or only prints it in a dry run.
run() {
    if [ "$DRY_RUN" = 1 ]; then
        printf '  [dry run] %s\n' "$*"
    else
        "$@"
    fi
}
SUDO=""
if [ "$(id -u)" != 0 ]; then
    if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; elif [ "$DRY_RUN" != 1 ]; then die "Run as root (or install sudo)."; fi
fi

# Reads an answer from the terminal (also when the script itself comes from a pipe).
ask() {
    local prompt="$1" default="${2:-}" answer=""
    if [ "$ASSUME_YES" = 1 ] || { [ ! -t 0 ] && [ ! -r /dev/tty ]; }; then
        printf '%s' "$default"
        return
    fi
    if [ -n "$default" ]; then prompt="$prompt [$default]"; fi
    if [ -t 0 ]; then read -r -p "$prompt: " answer; else read -r -p "$prompt: " answer </dev/tty; fi
    printf '%s' "${answer:-$default}"
}

valid_domain() { [[ "$1" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$ ]]; }
valid_email() { [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; }
valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
# A value for .env: one line, no quotes needed by compose for these.
env_safe() { [[ "$1" != *$'\n'* ]]; }

# ---- 1. The system ----

if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}:${ID_LIKE:-}" in
        ubuntu:*|debian:*|*:*debian*) ;;
        *) warn "This installer is made for Ubuntu and Debian (found ${PRETTY_NAME:-unknown}). Continuing anyway." ;;
    esac
else
    warn "Can't tell which system this is; the installer is made for Ubuntu and Debian."
fi

# ---- 2. Docker ----

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    say "Docker and the compose plugin are installed."
else
    say "Installing Docker (the official convenience script from get.docker.com)."
    if command -v apt-get >/dev/null 2>&1; then
        run $SUDO apt-get update -qq
        run $SUDO apt-get install -y -qq ca-certificates curl git
    fi
    if [ "$DRY_RUN" = 1 ]; then
        run sh -c "curl -fsSL https://get.docker.com | $SUDO sh"
    else
        curl -fsSL https://get.docker.com | $SUDO sh
    fi
    run $SUDO systemctl enable --now docker
fi

# ---- 3. The source ----

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -z "$SOURCE_DIR" ] && [ -n "$HERE" ] && [ -f "$HERE/../docker-compose.yml" ] && [ -f "$HERE/../Dockerfile" ]; then
    SOURCE_DIR="$(cd "$HERE/.." && pwd)"
fi
if [ -n "$SOURCE_DIR" ]; then
    [ -f "$SOURCE_DIR/docker-compose.yml" ] || die "$SOURCE_DIR has no docker-compose.yml."
    say "Using the Nagma checkout in $SOURCE_DIR."
    APP_DIR="$SOURCE_DIR"
else
    APP_DIR="$INSTALL_DIR"
    if [ -d "$APP_DIR/.git" ]; then
        say "Updating $APP_DIR."
        run $SUDO git -C "$APP_DIR" fetch --depth 1 origin "$REPO_REF"
        run $SUDO git -C "$APP_DIR" checkout -q FETCH_HEAD
    else
        command -v git >/dev/null 2>&1 || run $SUDO apt-get install -y -qq git
        say "Getting Nagma ($REPO_REF) into $APP_DIR."
        run $SUDO git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$APP_DIR"
    fi
fi

# ---- 4. Settings ----

ENV_FILE="$APP_DIR/.env"
KEEP_ENV=0
if [ -f "$ENV_FILE" ] && [ "$ASSUME_YES" != 1 ]; then
    answer="$(ask "There's already a $ENV_FILE. Keep it? (y/n)" "y")"
    case "$answer" in [Yy]*) KEEP_ENV=1 ;; esac
elif [ -f "$ENV_FILE" ] && [ -z "$DOMAIN$ADMIN_EMAIL$SMTP_URL$SERVER_NAME" ]; then
    KEEP_ENV=1
fi

if [ "$KEEP_ENV" = 1 ]; then
    say "Keeping the settings in $ENV_FILE."
    DOMAIN="$(sed -n 's/^NAGMA_DOMAIN=//p' "$ENV_FILE" | tail -1)"
    ADMIN_EMAIL="$(sed -n 's/^NAGMA_ADMINS=//p' "$ENV_FILE" | tail -1 | cut -d, -f1)"
    HTTP_PORT="$(sed -n 's/^NAGMA_HTTP_PORT=//p' "$ENV_FILE" | tail -1)"
    HTTP_PORT="${HTTP_PORT:-8080}"
else
    if [ "$ASKED_DOMAIN" = 0 ] && [ -z "$DOMAIN" ]; then
        DOMAIN="$(ask "Domain for this server, for HTTPS (empty for plain HTTP on port $HTTP_PORT)" "")"
    fi
    DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
    if [ -n "$DOMAIN" ] && ! valid_domain "$DOMAIN"; then die "\"$DOMAIN\" isn't a domain name."; fi
    while [ -z "$ADMIN_EMAIL" ] || ! valid_email "$ADMIN_EMAIL"; do
        [ -n "$ADMIN_EMAIL" ] && warn "\"$ADMIN_EMAIL\" isn't an email address."
        ADMIN_EMAIL="$(ask "Admin email (you'll create this account first)" "")"
        if [ -z "$ADMIN_EMAIL" ] && [ "$ASSUME_YES" = 1 ]; then die "--admin-email is needed with --yes."; fi
    done
    [ -n "$SERVER_NAME" ] || SERVER_NAME="$(ask "Server name, shown when people connect to it" "Nagma")"
    if [ -z "$SMTP_URL" ]; then
        SMTP_URL="$(ask "SMTP URL for mail, smtp://user:pass@host:587 (optional, empty to skip)" "")"
    fi
    if [ -n "$SMTP_URL" ] && [ -z "$MAIL_FROM" ]; then
        MAIL_FROM="$(ask "Send mail from" "$ADMIN_EMAIL")"
    fi
    valid_port "$HTTP_PORT" || die "\"$HTTP_PORT\" isn't a port."
    for v in "$DOMAIN" "$ADMIN_EMAIL" "$SERVER_NAME" "$SMTP_URL" "$MAIL_FROM"; do env_safe "$v" || die "Settings must be one line each."; done

    if [ -n "$DOMAIN" ]; then
        PUBLIC_URL="https://$DOMAIN"; PROFILES="https"; BIND="127.0.0.1"; TRUST="1"
    else
        HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
        PUBLIC_URL="http://${HOST_IP:-localhost}:$HTTP_PORT"; PROFILES=""; BIND="0.0.0.0"; TRUST=""
    fi

    ENV_CONTENT="# Written by tools/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Every setting: .env.example.
NAGMA_DOMAIN=$DOMAIN
COMPOSE_PROFILES=$PROFILES
NAGMA_PUBLIC_URL=$PUBLIC_URL
NAGMA_SERVER_NAME=$SERVER_NAME
NAGMA_ADMINS=$ADMIN_EMAIL
NAGMA_BIND=$BIND
NAGMA_HTTP_PORT=$HTTP_PORT"
    [ -n "$TRUST" ] && ENV_CONTENT="$ENV_CONTENT
TRUST_PROXY=$TRUST"
    if [ -n "$SMTP_URL" ]; then
        ENV_CONTENT="$ENV_CONTENT
NAGMA_SMTP_URL=$SMTP_URL
NAGMA_MAIL_FROM=$MAIL_FROM"
    fi

    if [ "$DRY_RUN" = 1 ]; then
        say "Would write $ENV_FILE:"
        printf '%s\n' "$ENV_CONTENT" | sed -E 's#(NAGMA_SMTP_URL=[a-z]+://[^:]*:)[^@]*@#\1****@#; s/^/    /'
    else
        if [ -f "$ENV_FILE" ]; then
            $SUDO cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"
        fi
        printf '%s\n' "$ENV_CONTENT" | $SUDO tee "$ENV_FILE" >/dev/null
        $SUDO chmod 600 "$ENV_FILE"
        say "Wrote $ENV_FILE."
    fi
fi

# ---- 5. Start ----

say "Building and starting Nagma (the first build takes a few minutes)."
run $SUDO docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" up -d --build

if [ "$DRY_RUN" != 1 ]; then
    say "Waiting for the server to answer."
    ok=0
    for _ in $(seq 1 60); do
        if curl -fsS "http://127.0.0.1:$HTTP_PORT/health" >/dev/null 2>&1; then ok=1; break; fi
        sleep 2
    done
    [ "$ok" = 1 ] || warn "The server didn't answer yet. Check: docker compose --project-directory $APP_DIR logs nagma"
fi

# ---- 6. Done ----

if [ -n "$DOMAIN" ]; then URL="https://$DOMAIN"; else URL="http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost):$HTTP_PORT"; fi
if [ "$DRY_RUN" = 1 ]; then STATUS="would run"; else STATUS="is running"; fi
cat <<EOF

Nagma $STATUS at: $URL

First steps:
  1. Open $URL and choose "Sign in or create an account" > Create account,
     with ${ADMIN_EMAIL:-the admin email}. That account is the server admin.
  2. Desktop app: Nagma > Server... (or the server badge on Home) > Add server... > $URL
  3. Invite your team from a team's Members, or share files by link.
EOF
if [ -n "$DOMAIN" ]; then
    cat <<EOF

HTTPS: $DOMAIN must point at this server (an A/AAAA record). Caddy gets the certificate on the
first visit. Behind Cloudflare's proxy, set SSL/TLS to "Full (strict)".
EOF
fi
cat <<EOF

Update:  cd $APP_DIR && git pull && sudo docker compose up -d --build
Backup:  sudo bash $APP_DIR/tools/backup.sh
Guide:   $APP_DIR/docs/self-hosting.md
EOF

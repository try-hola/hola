#!/bin/sh
# Hola server installer.
#
#   curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/install.sh | sh
#
# Clones (or updates) Hola from source, configures the production Compose stack,
# builds the server/web images locally from that checkout (HOLA_BUILD=1), starts
# it, then prints the admin API key. This is the from-source path tracking `main`
# — for a version-pinned install that pulls prebuilt images instead, use
# `hola bootstrap`. Re-running upgrades an existing install. Config is taken from
# environment variables when set, otherwise the script prompts (falling back to
# defaults when run non-interactively).
#
# Environment overrides:
#   HOLA_HOME           install directory                 (default: $HOME/hola)
#   HOLA_DOMAIN         UI/API domain                     (e.g. app.example.com)
#   HOLA_BASE_DOMAIN    base domain for deployed apps     (e.g. example.com)
#   LETSENCRYPT_EMAIL   email for Let's Encrypt           (e.g. you@example.com)
#   HOLA_API_KEY        fixed admin key (else generated on first boot)
#   HOLA_REPO           git URL    (default: https://github.com/try-hola/hola.git)
#   HOLA_BRANCH         git branch (default: main)
set -eu

REPO="${HOLA_REPO:-https://github.com/try-hola/hola.git}"
BRANCH="${HOLA_BRANCH:-main}"
HOLA_HOME="${HOLA_HOME:-$HOME/hola}"

info() { printf '\033[1;36m[hola]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[hola]\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31m[hola] error:\033[0m %s\n' "$1" >&2; exit 1; }

# --- prerequisites ---------------------------------------------------------
command -v git >/dev/null 2>&1 || die "git not found. Install git and re-run."
command -v docker >/dev/null 2>&1 || die "Docker not found. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin not found. Update Docker to include 'docker compose'."

# --- fetch or update the repo ----------------------------------------------
if [ -d "$HOLA_HOME/.git" ]; then
  info "Updating existing checkout at $HOLA_HOME"
  git -C "$HOLA_HOME" pull --ff-only
else
  info "Cloning Hola into $HOLA_HOME"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$HOLA_HOME"
fi

COMPOSE_DIR="$HOLA_HOME/packages/compose"
ENV_FILE="$COMPOSE_DIR/.env"
[ -f "$COMPOSE_DIR/.env.example" ] || die "unexpected layout: $COMPOSE_DIR/.env.example missing"

# --- configuration ---------------------------------------------------------
# Prompt for a value: use an existing env override, else read from the terminal
# (with a default), else fall back to the default when non-interactive.
prompt() { # prompt <current-value> <label> <default>
  cur="$1"; label="$2"; def="$3"
  if [ -n "$cur" ]; then printf '%s' "$cur"; return; fi
  if [ -r /dev/tty ]; then
    printf '%s [%s]: ' "$label" "$def" >/dev/tty
    read -r ans </dev/tty || ans=""
    [ -n "$ans" ] && printf '%s' "$ans" || printf '%s' "$def"
  else
    printf '%s' "$def"
  fi
}

# Replace KEY=... in the .env (values contain no '|', so it is a safe delimiter).
set_env() { # set_env <key> <value>
  key="$1"; val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" >"$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >>"$ENV_FILE"
  fi
}

if [ -f "$ENV_FILE" ]; then
  info "Using existing $ENV_FILE (delete it to reconfigure)"
else
  info "Configuring the stack. Press enter to accept defaults."
  DOMAIN=$(prompt "${HOLA_DOMAIN:-}" "Hola UI/API domain (HOLA_DOMAIN)" "app.local.hola")
  BASE_DOMAIN=$(prompt "${HOLA_BASE_DOMAIN:-}" "Base domain for deployed apps (HOLA_BASE_DOMAIN)" "local.hola")
  LE_EMAIL=$(prompt "${LETSENCRYPT_EMAIL:-}" "Let's Encrypt email (LETSENCRYPT_EMAIL)" "admin@example.com")

  cp "$COMPOSE_DIR/.env.example" "$ENV_FILE"
  set_env HOLA_DOMAIN "$DOMAIN"
  set_env HOLA_BASE_DOMAIN "$BASE_DOMAIN"
  set_env LETSENCRYPT_EMAIL "$LE_EMAIL"
  set_env HOLA_USE_AUTH "true"
  [ -n "${HOLA_API_KEY:-}" ] && set_env HOLA_API_KEY "$HOLA_API_KEY"
  info "Wrote $ENV_FILE"
fi

# --- build and start -------------------------------------------------------
# This installer tracks `main`, which may be ahead of any published image, so it
# builds the server/web images from the checkout. HOLA_BUILD=1 makes the compose
# stack add the build overlay and build (rather than pull the GHCR images).
info "Building and starting the production stack (first run can take a few minutes)..."
( cd "$COMPOSE_DIR" && HOLA_BUILD=1 ./scripts/install.sh )

# --- admin key + next steps ------------------------------------------------
info "Waiting for the admin API key to be provisioned..."
KEY=""
i=0
while [ "$i" -lt 30 ]; do
  KEY=$(cd "$COMPOSE_DIR" && docker compose --env-file .env exec -T server cat /data/config/admin-api-key 2>/dev/null || true)
  [ -n "$KEY" ] && break
  i=$((i + 1)); sleep 2
done

DOMAIN_OUT=$(grep '^HOLA_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)
printf '\n'
info "Hola is up."
info "  UI:        https://${DOMAIN_OUT}"
if [ -n "$KEY" ]; then
  info "  Admin key: ${KEY}"
else
  info "  Admin key: run 'docker compose --env-file .env exec server cat /data/config/admin-api-key' in $COMPOSE_DIR"
fi
info "  Install the CLI elsewhere:"
info "    curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/cli-install.sh | sh"
info "    export HOLA_API_URL=https://${DOMAIN_OUT} HOLA_TOKEN=<admin-key>"
info "Manage the stack from $COMPOSE_DIR (./scripts/{logs,status,down}.sh)."

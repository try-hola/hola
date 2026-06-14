#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-hola}

COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
ENV_FILE="$ROOT_DIR/.env"
DEV_FILE="$ROOT_DIR/docker-compose.dev.yml"
DNS01_FILE="$ROOT_DIR/docker-compose.dns01.yml"

# Read a key from .env without sourcing it (values may contain spaces/quotes).
env_file_get() { [[ -f "$ENV_FILE" ]] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | xargs || true; }

# Default to the PRODUCTION stack. The dev override (Bun dev servers, HTTP only,
# auth disabled) is opt-in via HOLA_DEV=1, so a fresh-host install is correct.
# The dev file is named *.dev.yml (not *.override.yml) so `docker compose` never
# auto-merges it — production stays the default even for a bare `docker compose`.
COMPOSE_FILES=("-f" "$COMPOSE_FILE")
HOLA_MODE="production"
if [[ "${HOLA_DEV:-}" == "1" || "${HOLA_DEV:-}" == "true" ]]; then
  if [[ -f "$DEV_FILE" ]]; then
    COMPOSE_FILES+=("-f" "$DEV_FILE")
    HOLA_MODE="development"
  else
    echo "[compose] HOLA_DEV set but $DEV_FILE not found; using production stack" >&2
  fi
fi
export HOLA_MODE

# DNS-01 TLS overlay (opt-in): activated when ACME_DNS_PROVIDER is set in .env.
# For private/homelab hosts not reachable on :80 — issues a wildcard cert via the
# DNS provider's API instead of HTTP-01. Not used in dev (HTTP only).
if [[ "$HOLA_MODE" == "production" && -n "$(env_file_get ACME_DNS_PROVIDER)" ]]; then
  if [[ -f "$DNS01_FILE" ]]; then
    COMPOSE_FILES+=("-f" "$DNS01_FILE")
    echo "[compose] DNS-01 TLS enabled (provider: $(env_file_get ACME_DNS_PROVIDER))" >&2
  else
    echo "[compose] ACME_DNS_PROVIDER set but $DNS01_FILE not found; using HTTP-01" >&2
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[compose] No .env found, using defaults from .env.example" >&2
fi

cd "$ROOT_DIR"

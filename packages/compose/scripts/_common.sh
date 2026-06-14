#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-hola}

COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
ENV_FILE="$ROOT_DIR/.env"
DEV_FILE="$ROOT_DIR/docker-compose.dev.yml"

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

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[compose] No .env found, using defaults from .env.example" >&2
fi

cd "$ROOT_DIR"

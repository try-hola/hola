#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-hola}

COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
ENV_FILE="$ROOT_DIR/.env"
OVERRIDE_FILE="$ROOT_DIR/docker-compose.override.yml"
COMPOSE_FILES=("-f" "$COMPOSE_FILE")
if [[ -f "$OVERRIDE_FILE" ]]; then
  COMPOSE_FILES+=("-f" "$OVERRIDE_FILE")
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[compose] No .env found, using defaults from .env.example" >&2
fi

cd "$ROOT_DIR"

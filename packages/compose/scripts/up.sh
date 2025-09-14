#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"

mkdir -p "$ROOT_DIR/logs" "$ROOT_DIR/data"

echo "[compose] Starting stack using files: ${COMPOSE_FILES[*]}"
if [[ -f "$ENV_FILE" ]]; then
  docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" up -d
else
  docker compose "${COMPOSE_FILES[@]}" up -d
fi

echo "[compose] Stack is up. Services:"
docker compose "${COMPOSE_FILES[@]}" ps

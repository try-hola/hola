#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"

echo "[compose] Stopping stack using files: ${COMPOSE_FILES[*]}"
if [[ -f "$ENV_FILE" ]]; then
  docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" down
else
  docker compose "${COMPOSE_FILES[@]}" down
fi

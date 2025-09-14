#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"

echo "[compose] Tailing logs (Ctrl-C to exit)..."
docker compose "${COMPOSE_FILES[@]}" logs -f --tail=200 "$@"

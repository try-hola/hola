#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"

docker compose "${COMPOSE_FILES[@]}" ps

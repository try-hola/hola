#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

# Check prerequisites
if ! command -v docker >/dev/null 2>&1; then
  echo "[install] Docker CLI not found. Please install Docker." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[install] Docker Compose v2 plugin not found. Please install/update Docker to include 'docker compose'." >&2
  exit 1
fi

# Prepare environment file
if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "[install] Creating .env from .env.example"
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
else
  echo "[install] Using existing .env"
fi

# Create basic data/logs dirs
mkdir -p "$ROOT_DIR/logs" "$ROOT_DIR/data"
mkdir -p "$ROOT_DIR/traefik/acme"
if [[ ! -f "$ROOT_DIR/traefik/acme/acme.json" ]]; then
  echo "{}" > "$ROOT_DIR/traefik/acme/acme.json"
  chmod 600 "$ROOT_DIR/traefik/acme/acme.json"
fi

# Provide hosts hint
if ! grep -q "app.local.hola" /etc/hosts 2>/dev/null; then
  cat <<'HOSTS_HINT'
[install] Hint: Add these to /etc/hosts for local domains:
  127.0.0.1 app.local.hola traefik.local.hola
HOSTS_HINT
fi

# Bring up the stack (will automatically include docker-compose.override.yml if present)
"$SCRIPT_DIR/up.sh"

cat <<'NEXT'
[install] Done. If auth is enabled and you did not set HOLA_API_KEY, retrieve the
generated admin API key with:
  docker compose exec server cat /data/config/admin-api-key
NEXT

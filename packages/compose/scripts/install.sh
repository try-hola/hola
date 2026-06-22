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
ENV_FILE="$ROOT_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[install] Creating .env from .env.example"
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
else
  echo "[install] Using existing .env"
fi

# --- Authentik (SSO) bootstrap secrets ------------------------------------
# When HOLA_AUTH_MODE=authentik, generate per-install secrets (idempotently) and
# wire the derived values, so the Authentik stack comes up turnkey and the server
# can provision against it immediately. No-op for HOLA_AUTH_MODE=none.
env_get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }
env_set() { # set or replace KEY=VALUE without sed-escaping the value
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}
ensure_secret() { # generate only if currently blank/missing
  local key="$1" val="$2"
  if [[ -z "$(env_get "$key")" ]]; then
    env_set "$key" "$val"
    echo "[install]   generated $key"
  fi
}

AUTH_MODE="$(env_get HOLA_AUTH_MODE | tr -d '"'"'"' ' | xargs || true)"
# SSO is the default — an unset/blank mode means authentik (matches the compose
# `${HOLA_AUTH_MODE:-authentik}` default). Only an explicit `none` opts out.
AUTH_MODE="${AUTH_MODE:-authentik}"
if [[ "$AUTH_MODE" == "authentik" ]]; then
  echo "[install] HOLA_AUTH_MODE=authentik: provisioning Authentik secrets"
  if ! command -v openssl >/dev/null 2>&1; then
    echo "[install] openssl is required to generate Authentik secrets. Please install it." >&2
    exit 1
  fi
  ensure_secret AUTHENTIK_SECRET_KEY "$(openssl rand -base64 60 | tr -d '\n')"
  ensure_secret AUTHENTIK_PG_PASS "$(openssl rand -hex 24)"
  ensure_secret AUTHENTIK_BOOTSTRAP_PASSWORD "$(openssl rand -hex 24)"
  ensure_secret AUTHENTIK_BOOTSTRAP_TOKEN "$(openssl rand -hex 32)"

  # The server uses AUTHENTIK_BOOTSTRAP_TOKEN (passed through by compose) ONCE at
  # startup to mint a least-privilege scoped token, then provisions as a non-superuser
  # service account. HOLA_AUTHENTIK_API_TOKEN stays blank unless you pin your own.

  # Derive the public issuer URL from the Authentik domain.
  authentik_domain="$(env_get HOLA_AUTHENTIK_DOMAIN | xargs || true)"
  authentik_domain="${authentik_domain:-auth.local.hola}"
  env_set HOLA_AUTHENTIK_PUBLIC_URL "https://${authentik_domain}"

  # Activate the `authentik` compose profile so the stack actually starts.
  profiles="$(env_get COMPOSE_PROFILES | xargs || true)"
  if [[ -z "$profiles" ]]; then
    env_set COMPOSE_PROFILES "authentik"
  elif [[ ",$profiles," != *",authentik,"* ]]; then
    env_set COMPOSE_PROFILES "${profiles},authentik"
  fi
fi

# --- TLS challenge sanity check ----------------------------------------------
# DNS-01 (for private/homelab hosts) is opt-in via ACME_DNS_PROVIDER; _common.sh
# auto-includes the overlay. Warn early if the provider is set but credentials are
# missing, since cert issuance would otherwise fail silently after startup.
ACME_DNS_PROVIDER="$(env_get ACME_DNS_PROVIDER | xargs || true)"
if [[ -n "$ACME_DNS_PROVIDER" ]]; then
  base_domain="$(env_get HOLA_BASE_DOMAIN | xargs || true)"
  echo "[install] DNS-01 TLS enabled (provider: $ACME_DNS_PROVIDER) — wildcard *.${base_domain:-<HOLA_BASE_DOMAIN>}"
  case "$ACME_DNS_PROVIDER" in
    route53)
      if [[ -z "$(env_get AWS_ACCESS_KEY_ID | xargs || true)" || -z "$(env_get AWS_SECRET_ACCESS_KEY | xargs || true)" ]]; then
        echo "[install] WARNING: route53 selected but AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are blank in .env — cert issuance will fail." >&2
      fi
      ;;
    cloudflare)
      if [[ -z "$(env_get CF_DNS_API_TOKEN | xargs || true)" ]]; then
        echo "[install] WARNING: cloudflare selected but CF_DNS_API_TOKEN is blank in .env — cert issuance will fail." >&2
      fi
      ;;
  esac
fi

# Persist the production compose-file set into .env as COMPOSE_FILE so a bare
# `docker compose <cmd>` in this directory (an operator restart, the orchestrator,
# or a `docker compose restart traefik`) applies the SAME overlays as scripts/up.sh.
# Without this, a plain `docker compose up`/`restart` loads only docker-compose.yml
# and silently drops the DNS-01 overlay — reverting Traefik to HTTP-01 and losing
# the wildcard cert. Mirrors how COMPOSE_PROFILES is persisted above; the wrapper
# scripts still pass explicit `-f` flags, which override COMPOSE_FILE. Only the
# persistent runtime overlays belong here (not the dev/build install-time ones).
compose_files="docker-compose.yml"
if [[ -n "$ACME_DNS_PROVIDER" ]]; then
  compose_files="${compose_files}:docker-compose.dns01.yml"
fi
env_set COMPOSE_FILE "$compose_files"

# Create basic data/logs dirs
mkdir -p "$ROOT_DIR/logs" "$ROOT_DIR/data"
mkdir -p "$ROOT_DIR/traefik/acme"
if [[ ! -f "$ROOT_DIR/traefik/acme/acme.json" ]]; then
  echo "{}" > "$ROOT_DIR/traefik/acme/acme.json"
  chmod 600 "$ROOT_DIR/traefik/acme/acme.json"
fi

# Dev-only hosts hint (production uses real, resolvable domains).
if [[ "${HOLA_DEV:-}" == "1" || "${HOLA_DEV:-}" == "true" ]]; then
  if ! grep -q "app.local.hola" /etc/hosts 2>/dev/null; then
    auth_hint=""
    [[ "$AUTH_MODE" == "authentik" ]] && auth_hint=" auth.local.hola"
    cat <<HOSTS_HINT
[install] Hint: Add these to /etc/hosts for local dev domains:
  127.0.0.1 app.local.hola traefik.local.hola${auth_hint}
HOSTS_HINT
  fi
fi

# Bring up the PRODUCTION stack. By default compose pulls the version-pinned
# images (ghcr.io/try-hola/{server,web}). HOLA_BUILD=1 builds them from source
# instead (the from-source installer sets this) — _common.sh adds the build
# overlay and we pass --build here. HOLA_DEV=1 runs the dev override instead.
if [[ "${HOLA_BUILD:-}" == "1" || "${HOLA_BUILD:-}" == "true" ]]; then
  "$SCRIPT_DIR/up.sh" --build
else
  "$SCRIPT_DIR/up.sh"
fi

# Credential hints. Skipped when invoked by `hola bootstrap` (HOLA_BOOTSTRAP=1):
# the CLI retrieves the API key and reveals the SSO password itself, client-side.
if [[ "${HOLA_BOOTSTRAP:-}" != "1" ]]; then
  cat <<'NEXT'
[install] Done. If auth is enabled and you did not set HOLA_API_KEY, retrieve the
generated admin API key with:
  docker compose exec server cat /data/config/admin-api-key
NEXT

  if [[ "$AUTH_MODE" == "authentik" ]]; then
    cat <<NEXT
[install] Authentik SSO is enabled. The login UI is at https://${authentik_domain:-auth.local.hola}
  Admin user: akadmin
  Admin password: AUTHENTIK_BOOTSTRAP_PASSWORD in .env
First boot takes a minute while Authentik runs migrations. Catalog apps that
support SSO will have their auth provisioned automatically on install.
NEXT
  fi
fi

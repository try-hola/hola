# @hola/compose

Docker Compose stack for the Hola platform. It wires together a reverse proxy (Traefik), the Hola web frontend, and the Hola server API, letting you run the full system locally or in simple single-host setups.

## Structure
- `docker-compose.yml`: Base composition (Traefik, web, server)
- `docker-compose.override.yml`: Local dev overrides (bind mounts, Bun dev servers)
- `traefik/dynamic/`: Optional dynamic routing config
- `scripts/`: Convenience scripts to up/down, logs, and status
- `.env.example`: Template for domains, ports, and Let’s Encrypt email

## Quick Start

1. Copy environment file and adjust values:

```bash
cp .env.example .env
```

2. Bring up the stack:

```bash
bun --cwd ../../ up # or from repo root: bun --filter @hola/compose up
```

Alternatively run scripts directly:

```bash
./scripts/up.sh
```

3. Access services:
- Traefik dashboard: `http://$TRAEFIK_DASHBOARD_DOMAIN`
- Web app: `http://$WEB_DOMAIN`
- API server: `http://$SERVER_DOMAIN`

Add host entries if using `.local.hola` domains, e.g. in `/etc/hosts`:

```
127.0.0.1 app.local.hola api.local.hola traefik.local.hola
```

## Let’s Encrypt TLS (production)
- Set `LETSENCRYPT_EMAIL` in `.env`.
- Use real DNS-resolvable domains for `TRAEFIK_DASHBOARD_DOMAIN`, `WEB_DOMAIN`, and `SERVER_DOMAIN` pointing to your host.
- First run creates `traefik/acme/acme.json` (chmod 600). Certificates are auto-managed via HTTP-01 on entrypoint `web`.

## Local Development Override
- `docker-compose.override.yml` runs web/server via Bun in watch mode with bind mounts (live reload).
- Scripts will include the override automatically when present.
- For `.local.hola` hosts and other non-public domains, use HTTP-only (`web` entrypoint).

## Notes
- Images `hola/web:latest` and `hola/server:latest` are placeholders for production; local dev prefers overrides.
- This package does not include a database or external services; the server defaults to mock/fake integrations unless feature flags enable real services.

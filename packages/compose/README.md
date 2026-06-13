# @hola/compose

Production-capable, single-host Docker Compose stack for Hola: **Traefik** (ingress + TLS),
the **web** SPA, and the **API server**. The server orchestrates app deployments through the
host Docker engine and emits Traefik routing config so deployed apps (e.g. Gitea) become
reachable at `<app>.<HOLA_BASE_DOMAIN>`.

## Architecture

- **Single origin** — the `web` container (nginx) serves the SPA and reverse-proxies `/api`
  (including SSE log streams) to `hola-server:3001`. The browser only ever talks to one origin,
  so there is no CORS and only **one Hola domain** (`HOLA_DOMAIN`) to configure.
- **Traefik** terminates TLS, routes `HOLA_DOMAIN` → web, redirects HTTP→HTTPS at the
  entrypoint, and reads the server-emitted dynamic config from `/data/runtime/traefik` (file
  provider) to route each deployed app.
- **Persistence** — all server state (deployments, releases, sqlite, logs, generated Traefik
  config) lives in the `hola-data` named volume mounted at `/data`. It survives restarts and is
  the single thing to back up.

```
browser ──TLS──▶ Traefik ──▶ web (nginx: SPA + /api proxy) ──▶ server ──┬─▶ Docker engine (deploys apps)
                    │                                                     └─▶ /data/runtime/traefik/*.yml
                    └────────────────── routes deployed apps ◀────────────────────┘ (file provider)
```

## Prerequisites
- A host with **Docker** and the **Docker Compose v2** plugin (`docker compose version`).
- DNS (or `/etc/hosts`) pointing your domains at the host.

## Install (production)

```bash
cd packages/compose
cp .env.example .env          # set HOLA_DOMAIN, HOLA_BASE_DOMAIN, LETSENCRYPT_EMAIL, ...
./scripts/install.sh          # prepares .env/acme and runs `docker compose up -d --build`
# or manually:
docker compose -f docker-compose.yml up -d --build
```

`./scripts/install.sh` only includes the dev override when you run the dev scripts; for a
production deploy use the explicit `-f docker-compose.yml` form above (or `scripts/up.sh` after
removing the override).

### Retrieve the admin API key
Auth is **on by default in production**. If you did not set `HOLA_API_KEY` in `.env`, the server
generates one on first boot and writes it into the data volume. Retrieve it with:

```bash
docker compose exec server cat /data/config/admin-api-key
```

Send it as `Authorization: Bearer <key>` (or `X-API-Key: <key>`) from the CLI/SDK, or set
`HOLA_TOKEN` for the CLI. See `docs/adr/0001-authentication.md`.

## Local development

```bash
cd packages/compose
cp .env.example .env
./scripts/up.sh               # auto-includes docker-compose.override.yml
```

Dev runs the monorepo with Bun dev servers (hot reload) over **HTTP only** (no TLS/LE). The web
dev server (Vite, internal `:5173`) proxies `/api` to the server container. Add the dev domains to
`/etc/hosts`:

```
127.0.0.1 app.local.hola traefik.local.hola
```

Then open `http://app.local.hola`. (Auth is disabled in development.)

## TLS (production)
- Set `LETSENCRYPT_EMAIL` and use real, internet-resolvable domains for `HOLA_DOMAIN` and
  `TRAEFIK_DASHBOARD_DOMAIN` pointing at the host.
- `install.sh` creates `traefik/acme/acme.json` (chmod 600). Certs are issued via HTTP-01 on the
  `web` entrypoint and stored there.

## Upgrade

```bash
git pull
cd packages/compose
docker compose -f docker-compose.yml up -d --build   # rebuild images and recreate changed services
```

State in the `hola-data` volume is preserved across upgrades.

## Backup & restore
Everything durable is in the `hola-data` volume.

```bash
# Backup
docker run --rm -v hola-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/hola-data-$(date +%F).tgz -C /data .

# Restore (stack stopped)
docker run --rm -v hola-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/hola-data-YYYY-MM-DD.tgz -C /data"
```

Also keep a copy of `.env` and `traefik/acme/acme.json`.

## Security: the Docker socket
The server mounts `/var/run/docker.sock` so it can run `docker compose` for deployments. **This
grants control of the host's Docker engine** (effectively root on the host). Run Hola only on a
host you trust, keep the admin API key secret, and do not expose the API without auth.

## Deploying apps & routing
When you deploy an app through Hola, the server writes a Traefik router/service for it into
`/data/runtime/traefik/dynamic.yml`, which Traefik picks up automatically. For Traefik to reach the
app container, the app's Compose services must join the external `hola` network under the service
name Hola expects. Validating this end-to-end (e.g. deploying Gitea) on a real Docker host is
covered by the integration test in issue #19.

## Troubleshooting
- `docker compose config` — validate your `.env` and merged configuration.
- `./scripts/logs.sh` / `docker compose logs -f traefik server web` — follow logs.
- `./scripts/status.sh` / `docker compose ps` — service/health status.
- **502 from the UI** — the `server` container isn't healthy yet; check `docker compose logs server`.
- **No TLS cert** — domains must be public and resolve to the host for Let's Encrypt HTTP-01.
- **Deployed app not routable** — confirm its Compose joined the `hola` network and that
  `/data/runtime/traefik/dynamic.yml` contains its router.

## Files
- `docker-compose.yml` — production stack (build, socket, data volume, Traefik file provider).
- `docker-compose.override.yml` — local dev (Bun dev servers, HTTP only).
- `../server/Dockerfile`, `../web/Dockerfile`, `../web/nginx.conf` — images.
- `.env.example` — domains, ports, auth.
- `scripts/` — install/up/down/logs/status helpers.

# Hola Operations Guide

How to install, operate, and recover a single-host Hola deployment. For the
system design see [ARCHITECTURE.md](ARCHITECTURE.md); for authentication see
[adr/0001-authentication.md](adr/0001-authentication.md).

> Status legend: **Implemented** · **Optional** · **Roadmap**.

## Install

Prerequisites: a host with **Docker**, the **Docker Compose v2** plugin, and
**git**, with DNS pointing your domains at the host.

### One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/install.sh | sh
```

This clones Hola (to `$HOLA_HOME`, default `/opt/hola` — created with `sudo` +
`chown` to your user when needed), prompts for the domain settings (or reads
`HOLA_DOMAIN` / `HOLA_BASE_DOMAIN` / `LETSENCRYPT_EMAIL` from the environment),
builds and starts the production stack, and prints the admin API key. Re-running
upgrades an existing install.

### Manual install

The production stack lives in `packages/compose`; its
[README](../packages/compose/README.md) is the authoritative, step-by-step
reference (prerequisites, TLS, upgrade, troubleshooting).

```bash
cd packages/compose
cp .env.example .env          # set HOLA_DOMAIN, HOLA_BASE_DOMAIN, LETSENCRYPT_EMAIL, ...
./scripts/install.sh          # builds + runs the production stack
```

Or use the guided CLI, which validates the config up front and (optionally) installs on a
remote host over SSH — `hola init` to generate a `.env`, or `hola bootstrap --host user@vm`
for the full remote install. See the [compose README](../packages/compose/README.md#guided-recommended--the-hola-cli).

### Authenticate

Auth is **on by default in production**. If you did not set `HOLA_API_KEY` in
`.env`, the server generates one on first boot and writes it into the data
volume:

```bash
docker compose exec server cat /data/config/admin-api-key
```

Send it as `Authorization: Bearer <key>` (or `X-API-Key: <key>`); for the CLI/SDK
set `HOLA_TOKEN`. Development and test run with auth disabled. See ADR 0001.

#### Dashboard sign-in

The web dashboard reads `GET /api/auth/config` (unauthenticated) at load to pick a
login flow:

- **SSO (default).** With `HOLA_AUTH_MODE=authentik` (what `hola init` always sets),
  the server self-provisions
  a public OIDC client for the dashboard at startup (registered at
  `https://<HOLA_DOMAIN>/auth/callback`) and the login screen shows **Sign in with
  SSO** — an Authorization Code + PKCE flow against Authentik. The browser sends the
  resulting access-token JWT as a Bearer header; the server validates it against
  Authentik's JWKS. Set `HOLA_OIDC_ISSUER` + `HOLA_OIDC_CLIENT_ID` to point at an
  external IdP instead, and `HOLA_OIDC_ADMIN_GROUP` to restrict write access to a
  group.
- **Admin-key fallback.** Without OIDC, the login screen accepts the admin API key;
  the server validates it and sets an `HttpOnly` session cookie, so the key is never
  stored in the browser.

When `HOLA_USE_AUTH=false` (dev/test) the dashboard loads with no login.

## Deploy an app

The web dashboard browses a remote **catalog** of installable apps, set via
`HOLA_CATALOG_URL` in `.env` (a fresh install defaults to the official
`try-hola/apps` catalog; blank it to disable, or point it at your own
`catalog.json`). With it set, `GET /api/catalog/apps` lists the apps and the web
catalog renders them. See the catalog notes in the compose
[README](../packages/compose/README.md#app-catalog).

Through the web dashboard (or the SDK/CLI against the API), an app moves through:

```
catalog → draft → configure → validate → preflight → finalize →
deployment create → job (Compose up) → running → routed via Traefik
```

The deployment becomes reachable at `<app>.<HOLA_BASE_DOMAIN>` once its Traefik
router is emitted. Lifecycle actions — **start / stop / restart / delete** and
**rollback** — run as jobs; their state is reflected consistently across the
deployment's list, detail, and history views. See the
[deployment lifecycle](ARCHITECTURE.md#deployment-lifecycle) for the full path.

### Single sign-on (SSO)

SSO is the default. `HOLA_AUTH_MODE=authentik` deploys **Authentik** alongside the
stack and has Hola auto-provision each catalog app's auth on install (OIDC today);
`hola init` always sets it and `install.sh` generates the bootstrap secrets and
activates the `authentik` compose profile. Authentik needs ~2 GB RAM + Postgres.
Setting `HOLA_AUTH_MODE=none` by hand opts out (apps deploy without auth wiring) —
an advanced/dev escape hatch, not offered by the installer. See the SSO notes in the
compose [README](../packages/compose/README.md#authentication--sso).

### Routing generation

When an app is deployed, the server writes a Traefik router/service for it into
`/data/runtime/traefik/dynamic.yml` (and records canonical state in
`routing-map.json`). Traefik watches that file and picks up the route
automatically. For Traefik to reach the app, the app's Compose services join the
external `hola` network under the service name Hola expects. Ingress is
Traefik-only — apps do not publish host ports.

## Data layout

Everything durable lives under `HOLA_DATA_DIR` — the `hola-data` named volume
mounted at `/data` in the stack:

```
/data/
├── config/
│   └── admin-api-key            # generated admin key (first-boot bootstrap)
├── data/
│   └── hola.db                  # SQLite: jobs, durable records
├── drafts/<draftId>/
│   ├── draft.json               # mutable draft record
│   ├── files/                   # uploaded blobs (compose override, extra files)
│   └── finalized/manifest.json  # immutable finalized spec
├── deployments/<deploymentId>/
│   ├── deployment.json          # deployment record
│   ├── releases/<releaseId>/    # per-release manifest + rendered compose
│   └── runtime/docker-compose.yml  # materialized active project
├── runtime/traefik/
│   ├── routing-map.json         # canonical routing state
│   └── dynamic.yml              # Traefik file-provider config
├── logs/                        # server logs
└── cache/bundles/               # pulled OCI catalog bundles
```

This tree is the single thing to back up.

## Restart recovery

Hola is stateless in memory: all deployment, release, routing, and job state is
persisted under `/data` and **rehydrated on startup**. Restarting the server (or
the whole stack) restores deployments, their releases, the active-release
pointer, and Traefik routing from disk — running apps keep running, and the
dashboard reflects their true state after the restart.

```bash
cd packages/compose
docker compose -f docker-compose.yml restart server   # or: down && up
```

Recovery is verified end-to-end by the smoke and integration tests
(`__tests__/smoke`, `__tests__/integration/smoke-workflow.it.ts`), which recreate
the services over the same data dir and assert the deployment, release, and
routing survive.

## Logs

- **Server / stack logs:** `./scripts/logs.sh` or
  `docker compose logs -f traefik server web`.
- **Per-deployment job logs** stream through the API/dashboard (SSE) and are
  also written under `/data`.

## Backup & restore

Everything durable is in the `hola-data` volume (plus keep a copy of `.env` and
`traefik/acme/acme.json`). See the
[compose README](../packages/compose/README.md#backup--restore) for the exact
`tar` commands.

```bash
# Backup
docker run --rm -v hola-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/hola-data-$(date +%F).tgz -C /data .
```

> Scheduled/automatic backups and restore orchestration through the UI are
> **roadmap**; today backup/restore is the manual volume snapshot above.

## Upgrade

Re-run `hola bootstrap` with a newer CLI: it downloads the new compose bundle
(which pins the new `ghcr.io/try-hola` image tags) and re-runs the idempotent
installer. On the host directly:

```bash
cd packages/compose
./scripts/up.sh --pull always   # pull the version-pinned images, recreate changed services
```

State in the `hola-data` volume is preserved across upgrades.

## Troubleshooting

The [compose README](../packages/compose/README.md#troubleshooting) has the full
list. Common cases:

- **502 from the UI** — the `server` container isn't healthy yet;
  `docker compose logs server`.
- **No TLS cert** — with the default HTTP-01 the host must be internet-reachable on
  port 80. For private/homelab hosts use DNS-01 instead (set `ACME_DNS_PROVIDER` +
  provider credentials in `.env` for a wildcard cert — see the
  [compose README](../packages/compose/README.md#private--homelab-tls-dns-01)).
- **Deployed app not routable** — confirm its Compose joined the `hola` network
  and that `/data/runtime/traefik/dynamic.yml` contains its router.
- **Validate config** — `docker compose config` validates the merged `.env`.

## Security note

The server mounts `/var/run/docker.sock` to run `docker compose` for
deployments. **This grants control of the host's Docker engine (effectively root
on the host).** Run Hola only on a host you trust, keep the admin API key secret,
and never expose the API without auth.

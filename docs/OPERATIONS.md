# Hola Operations Guide

How to install, operate, and recover a single-host Hola deployment. For the
system design see [ARCHITECTURE.md](ARCHITECTURE.md); for authentication see
[adr/0001-authentication.md](adr/0001-authentication.md).

> Status legend: **Implemented** · **Optional** · **Roadmap**.

## Install

The production stack lives in `packages/compose` and is the canonical install
path. Its [README](../packages/compose/README.md) is the authoritative,
step-by-step reference (prerequisites, TLS, upgrade, troubleshooting); this
section summarizes the workflow.

```bash
cd packages/compose
cp .env.example .env          # set HOLA_DOMAIN, HOLA_BASE_DOMAIN, LETSENCRYPT_EMAIL, ...
./scripts/install.sh          # prepares .env/acme and runs `docker compose up -d --build`
```

Prerequisites: a host with **Docker** + the **Docker Compose v2** plugin, and
DNS (or `/etc/hosts`) pointing your domains at the host.

### Authenticate

Auth is **on by default in production**. If you did not set `HOLA_API_KEY` in
`.env`, the server generates one on first boot and writes it into the data
volume:

```bash
docker compose exec server cat /data/config/admin-api-key
```

Send it as `Authorization: Bearer <key>` (or `X-API-Key: <key>`); for the CLI/SDK
set `HOLA_TOKEN`. Development and test run with auth disabled. See ADR 0001.

## Deploy an app

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

```bash
git pull
cd packages/compose
docker compose -f docker-compose.yml up -d --build
```

State in the `hola-data` volume is preserved across upgrades.

## Troubleshooting

The [compose README](../packages/compose/README.md#troubleshooting) has the full
list. Common cases:

- **502 from the UI** — the `server` container isn't healthy yet;
  `docker compose logs server`.
- **No TLS cert** — domains must be public and resolve to the host (Let's Encrypt
  HTTP-01).
- **Deployed app not routable** — confirm its Compose joined the `hola` network
  and that `/data/runtime/traefik/dynamic.yml` contains its router.
- **Validate config** — `docker compose config` validates the merged `.env`.

## Security note

The server mounts `/var/run/docker.sock` to run `docker compose` for
deployments. **This grants control of the host's Docker engine (effectively root
on the host).** Run Hola only on a host you trust, keep the admin API key secret,
and never expose the API without auth.

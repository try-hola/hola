# Hola Architecture

This document describes how Hola is built and how a request flows through the
system as it is implemented today. For day-2 operations (install, backup,
restart recovery, troubleshooting) see [OPERATIONS.md](OPERATIONS.md). For the
authentication decision record see
[adr/0001-authentication.md](adr/0001-authentication.md).

> Status legend used throughout Hola docs:
> **Implemented** — works today · **Optional** — supported integration, off by
> default · **Roadmap** — planned, not built yet.

## Components

Hola is a Bun monorepo. Each package has a single responsibility and shares one
typed API contract.

| Package | Role |
| --- | --- |
| `@hola/web` | React + Vite SPA dashboard: catalog, install wizard, deployments, jobs/logs, settings. |
| `@hola/server` | Bun HTTP API. Owns deployment state and orchestrates Docker Compose + Traefik routing. |
| `@hola/shared` | Single source of truth for API route constants and TypeScript models; also the reusable Compose validator (`@hola/shared/compose-validate`). |
| `@hola/sdk` | Typed client for the API (scripts/integrations). |
| `@hola/cli` | React + Ink CLI over the SDK for common workflows. |
| `@hola/compose` | The production single-host Docker Compose stack (Traefik + web + server). Not a code library. |

The web, SDK, and CLI never talk to Docker or storage directly — they call the
server's HTTP API and consume the shared response types, so all three see the
same behavior and the same structured errors.

## Request topology (production stack)

```
browser ──TLS──▶ Traefik ──▶ web (nginx: SPA + /api proxy) ──▶ server ──┬─▶ Docker engine (deploys apps)
                    │                                                     └─▶ /data/runtime/traefik/*.yml
                    └────────────────── routes deployed apps ◀────────────────────┘ (file provider)
```

- **Single origin.** The `web` container serves the SPA and reverse-proxies
  `/api` (including SSE log streams) to the server, so the browser talks to one
  origin — no CORS, one `HOLA_DOMAIN` to configure.
- **Traefik** terminates TLS and routes everything from the server-emitted file
  provider at `/data/runtime/traefik`: the platform's own routes (`core.yml` — the
  UI at `HOLA_DOMAIN`, the dashboard, the Authentik UI) and each deployed app at
  `<app>.<HOLA_BASE_DOMAIN>` (`dynamic.yml`). Traefik runs **no Docker provider and
  mounts no Docker socket** — only the server holds the socket.
- **Ingress is Traefik-only.** Apps are reachable through Traefik routing, not
  by publishing host ports. There is no host-port registry; the Compose
  validator rejects `ports:` exposure (use `expose:` for container-internal
  ports). The server attaches one **ingress service** to the `hola` network and
  injects auth env into it; it uses the bundle manifest's `ingress.service`, else
  the service named after the app id, else the first service. So a multi-service
  app whose web service is neither named after the app id nor listed first is
  routed correctly as long as its manifest declares `ingress.service`.

## Server services

The server is composed of single-responsibility services selected per
environment in `packages/server/src/services/simple-factory.ts`
(`test` → mocks, `development` → real services + mock Docker, `production` →
all real). Each has a `Real*` and `Mock*` implementation behind one interface.

| Service | Responsibility |
| --- | --- |
| Storage | File persistence rooted at `HOLA_DATA_DIR` (atomic writes). |
| Database | Bun SQLite (`hola.db`) for jobs and durable records. |
| Catalog | App catalog (OCI-backed) — list/detail/versions. |
| Draft | Draft lifecycle: create, configure, validate, preflight, finalize. |
| Validation | Strict Compose schema/semantic validation + preflight checks. |
| Deployment | Owns deployment/release state; coordinates jobs, routing, Docker. |
| Job | Bounded-concurrency job queue with an executor for real Compose work. |
| Routing | Generates Traefik rules, detects host conflicts, emits dynamic config. |
| Docker | Wraps the host `docker compose` CLI (up/down/ps/restart/logs). |
| Logging | File logger + in-process pub/sub for log streaming. |
| Auth | Control-plane API-key auth (see ADR 0001). |

## Deployment lifecycle

An app goes from catalog to running through one path, exercised end-to-end by
the smoke tests (`packages/server/src/__tests__/smoke`) and, against a real
daemon, by the integration tests (`__tests__/integration/*.it.ts`):

```
catalog ─▶ draft ─▶ configure ─▶ validate ─▶ preflight ─▶ finalize
                                                              │
                                                              ▼
                              deployment create ─▶ job (Compose up) ─▶ running
                                                              │
                                                routing activated (Traefik rule emitted)
```

1. **Draft** — created from a catalog app; the user edits env, optionally
   uploads a Compose override / extra files.
2. **Validate** — strict Compose validation (`@hola/shared/compose-validate`):
   YAML parse, service shape (name, image/build, env form), undefined
   volume/network/secret references, and host-port rejection. Issues are
   returned as structured `ValidationIssue`s (`code`, `severity`, `path`).
   Malformed YAML is rejected at ingestion with `400`; semantic issues surface
   through `/validate` for inline display.
3. **Preflight** — environment checks (Docker reachable, disk, images, routing
   conflict) returned as pass/warn/fail.
4. **Finalize** — produces an immutable spec + checksum; refuses to finalize an
   invalid draft.
5. **Deployment create** — builds a release from the finalized draft and starts
   a job that runs `docker compose up`. On success the deployment is `running`
   and lifecycle `active`; on failure it lands in a truthful `error` state
   without corrupting the record.
6. **Routing** — the deployment's release is given a Traefik router/service
   written to `/data/runtime/traefik/dynamic.yml`; the app joins the external
   `hola` network so Traefik can reach it.

Lifecycle actions (start/stop/restart/delete) and rollback run as jobs through
the same Deployment service, so list, detail, and history always read one
consistent state source.

## Data layout

All durable state lives under `HOLA_DATA_DIR` (the `hola-data` volume at `/data`
in the stack). See [OPERATIONS.md](OPERATIONS.md#data-layout) for the full tree.
Key locations:

- `drafts/<id>/` — draft record, uploaded files, finalized manifest.
- `deployments/<id>/` — deployment record, releases, materialized
  `runtime/docker-compose.yml`.
- `runtime/traefik/{routing-map.json,dynamic.yml}` — canonical routing state and
  the Traefik file-provider config for deployed apps.
- `runtime/traefik/core.yml` — file-provider routes for the platform's own
  services (UI, dashboard, Authentik), emitted at server startup.
- `data/hola.db` — SQLite (jobs, durable records).
- `config/admin-api-key` — generated admin key (first-boot bootstrap).
- `logs/` — server logs.

State is rehydrated from this tree on startup, which is what makes restart
recovery work: recreating the services over the same data dir restores
deployments, releases, and routing.

## Authentication

Control-plane auth is an admin API key (ADR 0001): enabled by default in
production, disabled in development/test. Clients send
`Authorization: Bearer <key>` or `X-API-Key: <key>`; the CLI/SDK read `HOLA_TOKEN`.
Public endpoints (health/readiness/metrics) are exempt; invalid credentials →
`401`, insufficient capability → `403`. Application SSO via an external IdP +
Traefik forward-auth is **roadmap** (ADR 0001 pt.2).

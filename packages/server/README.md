# @hola/server

Bun-powered HTTP API for the Hola platform. Implements the shared REST contract from `@hola/shared`, including health/readiness, deployments, jobs/logs (SSE), catalog, settings, and backups.

## How It Fits
- Role: Core backend that the web app, CLI, and SDK call.
- Contract-first: Routes and types come from `@hola/shared` to eliminate drift.
- Observability: Request IDs, structured logging, basic metrics, `/healthz`, `/readyz`, `/metrics`.
- Docs: Serves OpenAPI (`/api/openapi.json`) and interactive docs (`/docs`, `/redoc`, `/docs/home`).

## Environments & Services
- `NODE_ENV=test` selects mock services.
- `NODE_ENV=development` selects real local storage and monitoring with mock Docker.
- `NODE_ENV=production` selects real services.
- `HOLA_DATA_DIR` overrides the default `~/.hola` data root.
- Health endpoints under `/api/system/*` report service activation and status.

## Development
- Start dev server: `bun --cwd packages/server run dev`
- Typecheck: `bun --cwd packages/server typecheck`
- Tests: `bun --cwd packages/server test`

See `README-TESTING.md` for the contract testing strategy and test-server utilities.

## Endpoints Overview
- System: `GET /api/health`, `/healthz`, `/readyz`, `/metrics`, `/api/system/config`, `/api/system/health`
- Deployments: list/get/update, actions (`start|stop|restart|delete`), history, logs (+ SSE `.../stream`)
- Jobs: list/get, logs (+ SSE updates)
- Drafts: create/get/update, uploads, validate/preflight/finalize
- Catalog: apps list/query, versions, version detail, refresh
- Settings & Backups: get/patch settings, backup CRUD (mocked by default)
- Contracts (ADR 0004): `POST /api/contracts/backup/prepare` (enqueues every accepting app's `preHook`; poll the returned `jobId`) and `POST /api/contracts/backup/finalize` (runs their `postHook`s). Called by a **provider app's own container** with its contract-scoped token, never by the dashboard or CLI — the token authorizes `contract:backup` and nothing else.
- Docs: `/api/openapi.json`, `/docs`, `/redoc`, `/docs/types`, `/docs/examples`, `/docs/changelog`

All routes follow types defined in `@hola/shared`.

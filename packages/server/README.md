# @hola/server

Bun-powered HTTP API for the Hola platform. Implements the shared REST contract from `@hola/shared`, including health/readiness, deployments, jobs/logs (SSE), catalog, settings, backups, and feature-flagged developer endpoints.

## How It Fits
- Role: Core backend that the web app, CLI, and SDK call.
- Contract-first: Routes and types come from `@hola/shared` to eliminate drift.
- Observability: Request IDs, structured logging, basic metrics, `/healthz`, `/readyz`, `/metrics`.
- Docs: Serves OpenAPI (`/api/openapi.json`) and interactive docs (`/docs`, `/redoc`, `/docs/home`).

## Feature Flags & Services
- Service factory initializes real or mock services based on flags (fail-fast when real services are requested but unhealthy).
- Example flags: `HOLA_USE_REAL_DOCKER`, `HOLA_ENABLE_DEV_API` (Phase 7 dev sessions, validation, bundles).
- Health endpoints under `/api/system/*` report service activation and status.

## Development
- Start dev server: `bun --cwd packages/server run dev`
- Typecheck: `bun --cwd packages/server typecheck`
- Contract tests: `bun --cwd packages/server test src/__tests__/phase*.test.ts`

Recommended flow for local testing:
1) Run server in background: `bun --cwd packages/server run dev &`
2) Wait for health: `curl http://localhost:3001/healthz`
3) Exercise endpoints from web, CLI, or SDK

See `README-TESTING.md` for the contract testing strategy and test-server utilities.

## Endpoints Overview
- System: `GET /api/health`, `/healthz`, `/readyz`, `/metrics`, `/api/system/config`, `/api/system/health`
- Deployments: list/get/update, actions (`start|stop|restart|delete`), history, logs (+ SSE `.../stream`)
- Jobs: list/get, logs (+ SSE updates)
- Drafts: create/get/update, uploads, validate/preflight/finalize
- Catalog: apps list/query, versions, version detail, refresh
- Settings & Backups: get/patch settings, backup CRUD (mocked by default)
- Docs: `/api/openapi.json`, `/docs`, `/redoc`, `/docs/types`, `/docs/examples`, `/docs/changelog`

All routes follow types defined in `@hola/shared`.

# Server Architecture Plan

This document captures the phased implementation plan and target architecture for the server, aligned to:
- Runtime: Bun
- Framework: Hono
- Packaging: Docker container
- Persistence: SQLite via Drizzle
- API Contract: OpenAPI (code-first)
- Observability: Prometheus metrics
- Auth: API key (MVP)
- Realtime: SSE logs endpoint

## Phases

### Phase 0 — Foundations and repo hygiene (1–2 days)
Objectives
- Confirm runtime and framework (Bun + Hono)
- Establish configuration, logging, error handling, and CORS baselines
- Provide health/version endpoints and a minimal router
- Prepare OpenAPI source of truth and developer tooling

Deliverables
- Routing bootstrap in [`packages/server/src/server.declaration()`](packages/server/src/server.ts)
- Config module: typed env loader (PORT, NODE_ENV, LOG_LEVEL, API_KEYS, CORS_ORIGINS)
- Error model using RFC7807 problem+json with a global error handler
- Logging: structured JSON logs with levels; request logging middleware and correlation ID
- CORS: allow packages/web dev origin
- Endpoints:
  - GET /health { status: ok, uptime, timestamp }
  - GET /version { version from package.json, build info }
- OpenAPI:
  - Define spec for health/version
  - Approach: code-first (zod + zod-openapi) recommended for speed and type safety
- Developer experience:
  - Scripts in [`packages/server/package.declaration()`](packages/server/package.json): dev, build, start, lint, typecheck, test
  - Extend CI in [`.github/workflows/ci-bun.declaration()`](.github/workflows/ci-bun.yml) to lint/typecheck/build server
- Containerization:
  - Dockerfile (Bun base) and .dockerignore
  - Container healthcheck

Acceptance Criteria
- Server boots with env validation; structured logs; CORS works
- /health and /version return expected payloads
- CI runs lint, typecheck, build
- Docker image builds and runs locally

---

### Phase 1 — MVP (Deployments + SSE logs) (1–2 weeks)
Objectives
- Implement Deployments resource with persistence
- Provide SSE logs endpoint
- Protect mutating endpoints with API key
- Ship observability via Prometheus metrics

Domain and Persistence
- ORM: Drizzle + SQLite (file)
- Schema: deployments(id, name, status, created_at, updated_at, metadata JSON)
- Migrations: drizzle-kit
- Repository interface and Drizzle implementation
- Service layer for business rules

API Surface (OpenAPI-defined)
- GET /api/v1/deployments?status=&q=&limit=&cursor=
- POST /api/v1/deployments
- GET /api/v1/deployments/:id
- DELETE /api/v1/deployments/:id
- SSE: GET /api/v1/logs?deploymentId=:id (text/event-stream)

Auth and Middleware
- API key auth via header X-API-Key; apply to POST/DELETE
- Input validation with zod and OpenAPI generation; output DTOs typed

Observability
- Prometheus /metrics endpoint with:
  - http_requests_total labels: method, route, status
  - request_duration_seconds histogram
  - process metrics enabled
- Correlation IDs: request scoped, propagate to logs
- Access log with route, status, latency

Developer Tooling
- Seed script to create example deployments
- Tests:
  - Unit: services/validators
  - Integration: repositories on temp SQLite
  - API smoke tests (undici/supertest)

Acceptance Criteria
- CRUD works e2e with SQLite; migrations applied in dev
- SSE stream delivers heartbeat and emitted log messages for a deployment
- API key required for mutating calls; 401/403 with problem+json on failure
- /metrics exports request counts and latency histograms
- OpenAPI JSON at /openapi.json; optional Swagger UI at /docs

---

### Phase 2 — Hardening and DX (1 week)
Objectives
- Improve resilience, correctness, and developer experience

Enhancements
- Pagination: cursor-based; include nextCursor in responses
- Filtering/sorting for deployments
- Idempotency for POST (optional via Idempotency-Key header)
- Rate limiting: token bucket per IP or per API key (in-memory)
- Input/output conformance tests vs OpenAPI spec
- E2E tests: start server and validate critical flows
- Automated DB migration on container start
- Structured error codes and documentation

Acceptance Criteria
- OpenAPI contract tests pass
- Rate limiting returns 429 with retry-after
- Pagination and filters validated
- Migrations run automatically on container start

---

### Phase 3 — Integrations and extensibility (2–4 weeks, incremental)
Objectives
- Prepare for growth and external integrations

Workstreams
- Background jobs for long tasks (Bun workers) and job status logs feeding SSE
- Webhooks for deployment state changes
- Secrets abstraction (local via env; prod via provider adapter)
- Feature flags wiring
- RBAC foundation (roles and permissions) while keeping API key for admin

Acceptance Criteria
- Background job lifecycle observable via SSE
- Webhook registration and delivery with retries and signatures

---

### Phase 4 — Productionization and SRE (ongoing)
Objectives
- Operability, security, and performance at scale

Focus
- Docker healthcheck; readiness/liveness; graceful shutdown
- Backup/restore for SQLite; Postgres migration path plan
- Security headers, dependency and image scanning, SAST in CI
- Load testing baseline and performance budget
- Incident runbooks and dashboards

---

## Target Architecture

Layers
- Transport: Hono router for REST, SSE for logs
- Controller: parse/validate requests, map to services, return DTOs
- Service/use-case: business logic; pure where possible
- Repository: Drizzle to SQLite; return domain models
- Cross-cutting: config, auth, logging, metrics, errors, OpenAPI

Key Modules and Files
- [`packages/server/src/config.declaration()`](packages/server/src/config.ts): env parsing with zod (PORT, NODE_ENV, LOG_LEVEL, API_KEYS, CORS_ORIGINS, DATABASE_URL, METRICS_ENABLED)
- [`packages/server/src/logging.declaration()`](packages/server/src/logging.ts): logger factory, request logging, correlation IDs
- [`packages/server/src/errors.declaration()`](packages/server/src/errors.ts): problem+json helpers and global error handler
- [`packages/server/src/metrics.declaration()`](packages/server/src/metrics.ts): Prometheus registry and middleware; /metrics route
- [`packages/server/src/auth/apiKey.declaration()`](packages/server/src/auth/apiKey.ts): API key middleware (X-API-Key)
- [`packages/server/src/routes/health.declaration()`](packages/server/src/routes/health.ts)
- [`packages/server/src/routes/version.declaration()`](packages/server/src/routes/version.ts)
- [`packages/server/src/routes/deployments.declaration()`](packages/server/src/routes/deployments.ts)
- [`packages/server/src/routes/logs.declaration()`](packages/server/src/routes/logs.ts) (SSE)
- [`packages/server/src/domain/deployments/service.declaration()`](packages/server/src/domain/deployments/service.ts)
- [`packages/server/src/domain/deployments/repository.declaration()`](packages/server/src/domain/deployments/repository.ts)
- [`packages/server/src/db/client.declaration()`](packages/server/src/db/client.ts)
- [`packages/server/drizzle.config.declaration()`](packages/server/drizzle.config.ts), [`packages/server/migrations/0001_init.declaration()`](packages/server/migrations/0001_init.sql)
- [`packages/server/src/openapi/declaration()`](packages/server/src/openapi.ts): spec builder and /openapi.json route
- [`packages/server/Dockerfile.declaration()`](packages/server/Dockerfile), [`packages/server/.dockerignore.declaration()`](packages/server/.dockerignore)
- [`packages/server/README.declaration()`](packages/server/README.md): runbook
- CI: update [`.github/workflows/ci-bun.declaration()`](.github/workflows/ci-bun.yml) to include server jobs

Configuration and Environment
- Required env:
  - PORT, NODE_ENV, LOG_LEVEL
  - API_KEYS (comma-separated)
  - CORS_ORIGINS (comma-separated)
  - DATABASE_URL (sqlite file path)
  - METRICS_ENABLED
  - BUILD_VERSION, BUILD_TIME (injected at build)
- Config loader:
  - Validates at startup; fails fast
  - Exposes immutable typed config object

OpenAPI Strategy
- Code-first using zod + zod-openapi
- Generate /openapi.json and optional Swagger UI at /docs
- Contract tests to prevent drift

Metrics and Logging
- Prometheus:
  - http_requests_total{method,route,status}
  - request_duration_seconds histogram
  - process metrics
- Logging:
  - JSON logs with level, ts, requestId, route, status, latency
  - Correlation ID generated per request (X-Request-Id)

Security and Auth (MVP)
- API key via X-API-Key; validate against configured keys
- Apply to mutating endpoints; optionally to read endpoints based on needs
- CORS restricted to known dev and prod origins
- Security headers on responses (where applicable)

SSE Logs Endpoint
- GET /api/v1/logs?deploymentId=...
- Heartbeat event to keep connection alive
- Backpressure-aware writes; client reconnect guidance

MVP Endpoint Contracts (Concise)
- GET /health → 200 { status, uptime, timestamp }
- GET /version → 200 { name, version, commit?, buildTime? }
- GET /api/v1/deployments → 200 { items: DeploymentDTO[], nextCursor? }
- POST /api/v1/deployments (X-API-Key) → 201 DeploymentDTO
- GET /api/v1/deployments/:id → 200 DeploymentDTO | 404 Problem
- DELETE /api/v1/deployments/:id (X-API-Key) → 204 | 404 Problem
- GET /api/v1/logs?deploymentId=... → 200 text/event-stream (events: log, heartbeat)

Testing Strategy
- Unit: services and validators
- Integration: repositories against temp SQLite DB
- API: handlers with in-memory server
- Contract: OpenAPI conformance tests
- E2E: start server and run critical paths

Risks and Mitigations
- SSE stability: heartbeat and timeouts; reconnection strategy
- SQLite contention: enable WAL mode; plan migration path to Postgres using Drizzle
- Auth evolution: design API key middleware to swap with JWT/RBAC later
- Spec drift: generate OpenAPI from zod and run contract tests in CI

Execution Readiness
A corresponding, ordered todo list is maintained in the project tracker. Upon approval to implement, begin with Phase 0 scaffolding: config, logging, errors, health/version, CORS, OpenAPI skeleton, CI updates, and Docker artifacts.
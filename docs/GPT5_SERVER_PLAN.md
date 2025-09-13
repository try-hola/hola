# Hola Server ## Executive summary

We'll evolve the mock-based server into a production-capable system in incremental, reversible steps. **Currently: Phase 6 completed** - we now have a comprehensive catalog and OCI bundle handling system with cache management, signature verification, compose.yaml parsing, and real-time refresh capabilities, building on our complete foundational infrastructure, storage, database, authentication, Docker integration, and job management systems.

Improvements over the previous plan focus on:
- Contract-first delivery to keep the web app green (shared types + API contract tests)
- Observability, reliability, and safety nets from day one (metrics, logs, traces, health)
- Earlier minimal AuthN/Z to avoid rework later
- Stronger rollout controls (feature flags, automatic fallback to mocks, canary mode)
- Clear "Definition of Done" and success criteria per phase

**Completed phases (6 of 8):**
- ✅ **Phase 0**: Foundations and contract tests - Feature flags, service factory, logging, metrics
- ✅ **Phase 1**: Storage, config, and observability - File system operations, configuration persistence
- ✅ **Phase 2**: Database and repositories - SQLite database, migrations, repository pattern, database-backed config
- ✅ **Phase 3**: Minimal AuthN/Z and request context - Auth service, principal resolution, capability checking
- ✅ **Phase 4**: Docker + system monitoring + SSE status - Docker service, system monitoring, real-time SSE streams
- ✅ **Phase 5**: Jobs and structured logs - Job service, logging service, persistent job queue, SSE streaming
- ✅ **Phase 6**: Catalog + OCI bundle handling - Catalog service, bundle management, cache, signature verification

Target outcome: real storage, config, DB, Docker/Compose control, jobs/logs, catalog/OCI, drafts/deployments, backups/notifications—delivered in value-first slices while preserving API compatibility. progress tracker

Use this checklist to track phase completion at a glance. Tick items as you finish the phase's DoD. Update per-phase subtasks below as you go.

- [x] Phase 0: Foundations and contract tests ✅ **COMPLETED**
- [x] Phase 1: Storage, config, and observability ✅ **COMPLETED**
- [x] Phase 2: Database and repositories ✅ **COMPLETED**
- [x] Phase 3: Minimal AuthN/Z and request context ✅ **COMPLETED**
- [x] Phase 4: Docker + system monitoring + SSE status ✅ **COMPLETED**
- [x] Phase 5: Jobs and structured logs ✅ **COMPLETED**
- [x] Phase 6: Catalog + OCI bundle handling ✅ **COMPLETED**
- [ ] Phase 7: Drafts, validation, and deployments
- [ ] Phase 8: Backups, change drafts, notificationsation Plan

## Executive summary

We’ll evolve the mock-based server into a production-capable system in incremental, reversible steps. Improvements over the previous plan focus on:
- Contract-first delivery to keep the web app green (shared types + API contract tests)
- Observability, reliability, and safety nets from day one (metrics, logs, traces, health)
- Earlier minimal AuthN/Z to avoid rework later
- Stronger rollout controls (feature flags, automatic fallback to mocks, canary mode)
- Clear “Definition of Done” and success criteria per phase

Target outcome: real storage, config, DB, Docker/Compose control, jobs/logs, catalog/OCI, drafts/deployments, backups/notifications—delivered in value-first slices while preserving API compatibility.

---

## Master progress tracker

Use this checklist to track phase completion at a glance. Tick items as you finish the phase’s DoD. Update per-phase subtasks below as you go.

- [x] Phase 0: Foundations and contract tests
- [x] Phase 1: Storage, config, and observability
- [x] Phase 2: Database and repositories
- [x] Phase 3: Minimal AuthN/Z and request context
- [x] Phase 4: Docker + system monitoring + SSE status
- [x] Phase 5: Jobs and structured logs
- [x] Phase 6: Catalog + OCI bundle handling
- [ ] Phase 7: Drafts, validation, and deployments
- [ ] Phase 8: Backups, change drafts, notifications

Tip: For “in progress”, append “(in progress)” next to an item until it’s checked.

---

## Scope and non-goals

- In scope: server-side functionality replacing mocks behind stable APIs and SSE streams; local-first storage; SQLite; Docker/Compose integration; ORAS-based bundle handling; background jobs; minimal auth; backups and notifications.
- Out of scope: multi-tenant SaaS control plane, multi-node orchestration, non-Docker runtimes, complex RBAC UIs.

---

## Guiding principles

1) Contract-first and compatibility
- Keep existing endpoints, payload shapes, and SSE event contracts stable.
- Enforce via shared types and contract tests that run against both mock and real implementations.

2) Progressive activation
- Feature flags per capability with safe defaults to mocks. Automatic fallback on health check failure.

3) Observability and operability early
- Structured logs, metrics, traces, health/readiness endpoints, and log sampling policy available from phase 0.

4) Minimal viable AuthN/Z early
- Introduce a small, optional auth layer to avoid retrofitting security later.

5) Small, reversible steps
- Each phase shippable; canary flag to test real services with a subset of endpoints or users.

---

## Directory layout

packages/server/src/
- services/
  - core/ (config, storage, database, system monitoring, job runner, logging, notifications)
  - docker/ (docker + compose integration)
  - catalog/ (catalog search/index)
  - oci/ (bundle pulling/validation)
  - deployment/ (drafts, validation, deployments, change drafts)
  - auth/ (auth provider abstraction)
- lib/ (external clients/adapters: ORAS, Docker, OpenTelemetry, SQLite)
- middleware/ (auth, request context, error mapping, metrics)
- types/ (internal service types; re-export shared types as needed)
- utils/ (common helpers)
- config/ (feature flags, defaults, validation)

Note: We extend the previous structure with observability, auth, and adapter layers.

---

## Cross-cutting concerns

- Observability
  - Logs: structured JSON; per-request correlation (x-request-id), log levels; rolling file sink to ~/.hola/logs
  - Metrics: basic counters/timers for requests, jobs, SSE connections; health metrics
  - Tracing: optional OpenTelemetry exporter (no-op by default)
- Error model
  - Unified error types mapped to consistent HTTP shapes; include error codes and remediation tips where helpful
- Backpressure and limits
  - SSE fan-out via bounded buffers; log streams tail limits; job concurrency caps; Docker operation rate limits
- Data retention
  - Configurable retention for logs, jobs, and backups; periodic cleanup jobs
- Security
  - Optional API key or JWT bearer auth; per-request principal in context; minimal capability checks on mutating ops

---

## Feature flags

config/features.ts
- useRealStorage
- useRealConfig
- useRealDatabase
- useRealDocker
- useRealJobs
- useRealCatalog
- useRealDeployments
- useRealBackups
- useAuth
- useObservability (enables metrics/tracing/exporters)

Runtime behavior
- Default to false; each real service self-health-checks. If unhealthy, auto-fallback to mock for that capability and emit a warning metric/event.

---

## API compatibility guardrails

- Types: consume shared package types in handlers and services.
- Contract tests: a small suite that runs against mock and real modes and must pass identically.
- SSE compatibility: same event names and payloads; add-only evolution (no breaking removals) with event versioning if needed.

---

## Phased delivery plan (value-first)

Phase 0: Foundations and contract tests (Week 1) ✅ **COMPLETED**
- Deliverables
  - [x] Feature flag scaffolding and service factory
  - [x] Request ID middleware; structured logging; basic metrics; /healthz and /readyz
  - [x] Contract test harness hitting a local server in mock mode
- DoD
  - [x] Web tests pass
  - [x] Contract tests green in mock mode
  - [x] Zero runtime regressions

Phase 1: Storage, config, and observability ✅ **COMPLETED**
- Services
  - [x] StorageService (create ~/.hola, atomic writes, safe directory ops)
  - [x] ConfigService (system + backup settings; validation; persistence)
- Observability
  - [x] Log file sink (infrastructure ready)
  - [x] Base metrics (implemented in Phase 0)
  - [x] Error mapping middleware
- Replace
  - [x] Settings endpoints backed by ConfigService
- DoD
  - [x] Idempotent initialization
  - [x] Validation errors mapped to 4xx
  - [x] Config persistence verified and working

Phase 2: Database and repositories ✅ **COMPLETED**
- Services
  - [x] DatabaseService (SQLite via bun:sqlite with WAL mode)
  - [x] Migrations with versioning; repository layer for settings, jobs, catalog indices
- Replace
  - [x] Settings persistence through DB-backed repo (while keeping Storage for files)
- DoD
  - [x] Migration up/down with SQL parsing for triggers
  - [x] Transactional integrity with proper error handling
  - [x] Repository pattern with typed interfaces implemented

Phase 3: Minimal AuthN/Z and request context ✅ **COMPLETED**
- Services
  - [x] AuthService with pluggable providers (disabled by default)
- Middleware
  - [x] Principal resolution
  - [x] Capability checks for mutating endpoints
- DoD
  - [x] When enabled, unauthorized gets 401/403
  - [x] Web app operates with auth disabled

Phase 4: Docker + system monitoring + SSE status ✅ **COMPLETED**
- Services
  - [x] DockerService (availability, version, compose up/down/ps, logs)
  - [x] SystemMonitoringService (disk usage, oras presence, docker info)
- Replace
  - [x] System status endpoints and SSE with real data
  - [x] Graceful degradation if Docker unavailable
- DoD
  - [x] Works on machines without Docker (falls back to mocks)
  - [x] Log streaming smoke-tested

Phase 5: Jobs and structured logs ✅ **COMPLETED (August 16, 2025)**
- Services
  - [x] JobService (queue with persistence, retries, cancellation, progress)
  - [x] LoggingService (job and deployment logs; tail and stream; retention)
- Replace
  - [x] Job endpoints and SSE
  - [x] Log streaming endpoints
- DoD
  - [x] Bounded concurrency
  - [x] Retry/backoff
  - [x] SSE handles disconnects
  - [x] Persistence verified

Phase 6: Catalog + OCI bundle handling ✅ **COMPLETED (August 17, 2025)**
- Services
  - [x] CatalogService (SQLite FTS, search, versions)
  - [x] BundleService (ORAS pull, extract, validate, manifest)
  - [x] BundleCacheManager (LRU eviction, retention policies, in-use protection)
  - [x] ComposeParser (extract ports/volumes/env from compose.yaml)
- Replace
  - [x] Catalog endpoints backed by DB
  - [x] Bundle cache with cleanup
  - [x] getVersionDetail using real OCI bundles
  - [x] Periodic catalog refresh with ETag/Last-Modified support
  - [x] On-demand refresh endpoint (/api/catalog/refresh)
- DoD
  - [x] Offline cache behavior defined
  - [x] Corrupted bundles detected and quarantined
  - [x] Signature verification (optional cosign integration)
  - [x] Compose.yaml parsing and merging with manifest defaults

Phase 7: Drafts, validation, and deployments (Weeks 11–13)
- Services
  - [ ] DraftService (files, updates, validation, preflight, finalize)
  - [ ] ValidationService (env/compose/ports/disk/images)
  - [ ] DeploymentService (create/list/get/history, actions -> Jobs)
- Replace
  - [ ] Full deployment workflow behind existing endpoints and SSE
- DoD
  - [ ] Port conflict detection across deployments
  - [ ] Rollback pathway defined
  - [ ] Compose syntax validated

Phase 8: Backups, change drafts, notifications (Weeks 14–16)
- Services
  - [ ] BackupService (create/list/get/restore/delete, schedule, retention)
  - [ ] ChangeDraftService (post-deploy changes, diff, apply, rollback)
  - [ ] NotificationService (in-app + email hooks, job-driven)
- Replace
  - [ ] Remaining mock endpoints
- DoD
  - [ ] Integrity checks on backups
  - [ ] Change history available
  - [ ] Notification preferences respected

---

## Service contracts (high-level)

Core
- StorageService: ensureDir, writeFileAtomic, readFile, deleteFile, list, stat
- ConfigService: get/update system and backup settings with validation
- DatabaseService: initialize, query, run, transaction, migrate
- SystemMonitoringService: systemStatus, diskUsage, dockerInfo, orasVersion, realtime events
- JobService: create/get/list/execute/cancel; logs stream handle
- LoggingService: get/stream logs; archive policy
- NotificationService: create/list/markRead/send/process job events

Docker and deployment
- DockerService: available/version/compose up|down|ps; container logs stream
- ValidationService: env, compose, ports, disk space, images
- DraftService: CRUD, file upload, validate/preflight/finalize
- DeploymentService: CRUD, execute actions, history, update

Catalog and bundles
- CatalogService: refresh/search/get app, versions, details
- BundleService: pull/extract/validate/manifest, cache management

Auth
- AuthService: optional API key/JWT validation, principal extraction

Note: preserve existing API shapes; these contracts live behind handlers to maintain compatibility.

---

## Rollout and safety nets

- Start with all real features off by default; enable per-env via env vars
- Canary mode: enable real service for a subset of endpoints or traffic (configurable)
- Health-gated activation: if service health fails, auto-disable and fall back to mocks
- Telemetry: emit activation/fallback events; track error rates and latency per mode

---

## Testing strategy

- Unit tests: services with fakes and repositories with an in-memory or temp SQLite
- Contract tests: hit the running server in both mock and real modes; compare responses
- Integration tests: Docker/ORAS interactions behind adapters with controllable fakes
- E2E tests: critical workflows (settings, system status, jobs, catalog search, draft->deploy)
- Failure tests: disk full, docker unavailable, oras missing, SSE disconnects, auth failures
- Performance smoke: P95 latency and memory for hot endpoints; job throughput under cap

---

## Definition of Done and success criteria

Per phase DoD must include:
- 90%+ coverage on new services
- Contract tests pass in mock and real modes
- No breaking changes to public API or SSE contracts
- Observability signals in place (logs+metrics; traces optional)
- Docs updated (README + API notes)

Overall success (exit criteria):
- All phases shipped behind flags; can run fully real on a dev machine with Docker
- E2E tests green in both modes; performance within agreed SLOs
- Rollback to mocks is instantaneous via flags

---

## Risks and mitigations

- Docker variability across hosts: probe features; degrade gracefully
- Long-running jobs accumulating: retention and archival; max runtime and cancellation
- Schema evolution: migration testing and backups of DB before changes
- Bundle integrity: checksum and signature verification where provided
- SSE resource usage: bounded buffers and client limits; heartbeat and idle timeouts

---

## Minimal tech choices (adaptable)

- Runtime: Bun (current repo), TypeScript
- DB: SQLite (bun:sqlite or better-sqlite3); migration tool with versioning
- Docker: Docker CLI/Socket, Compose v2
- ORAS: ORAS CLI via adapter
- Tests: Vitest; supertest (or fetch) for HTTP; temp dirs via tmp
- Observability: pino-like JSON logs; optional OpenTelemetry SDK

---

## Migration notes

- Build real services alongside mocks; switch via factory functions keyed by flags
- Keep handler signatures unchanged; swap internals only
- Document env vars, defaults, and examples; provide a sample .env.local

This plan front-loads contract tests, observability, and minimal auth, uses progressive activation with safety nets, and maintains strict API compatibility while delivering real functionality in small, verifiable increments.

---

## Implementation Status

### Phase 0: Foundations and contract tests ✅ **COMPLETED (August 14, 2025)**

**Implemented Components:**
- `packages/server/src/config/features.ts` - Feature flag system with environment variable loading
- `packages/server/src/services/factory.ts` - Service factory with health monitoring and automatic fallback
- `packages/server/src/lib/logger.ts` - Structured JSON logging with request correlation
- `packages/server/src/lib/metrics.ts` - In-memory metrics collection (counters, timers, gauges)
- `packages/server/src/middleware/request.ts` - Request ID middleware, CORS, health checks
- `packages/server/src/utils/contract-tests.ts` - Contract testing infrastructure
- `packages/server/src/__tests__/phase0-contract.test.ts` - Comprehensive test suite (16 tests)
- `packages/server/src/server-phase0-demo.ts` - Phase 0 demonstration server
- `packages/server/PHASE0-README.md` - Complete documentation

**New Endpoints:**
- `GET /healthz` - Kubernetes-style health check
- `GET /readyz` - Kubernetes-style readiness check  
- `GET /metrics` - JSON metrics export with clean format
- `GET /api/phase0/features` - Feature flags and configuration info
- `GET /api/phase0/services` - Service factory status
- `POST /api/echo` - Echo endpoint with request metadata

**Infrastructure Features:**
- ✅ Feature flag scaffolding with progressive activation
- ✅ Service factory with health-monitored fallback to mocks
- ✅ Request ID generation and propagation across all responses
- ✅ Structured logging with JSON output and request correlation
- ✅ Metrics collection for HTTP requests, memory usage, and service health
- ✅ CORS support with proper preflight handling
- ✅ Error handling with standard error response format
- ✅ Graceful shutdown with SIGTERM/SIGINT handling
- ✅ Contract tests verifying API compatibility

**Verification:**
- All 16 contract tests pass successfully
- Zero breaking changes to existing API
- Request/response structure preserved
- Ready for Phase 1 implementation

### Phase 1: Storage, config, and observability ✅ **COMPLETED (August 15, 2025)**

**Implemented Components:**
- `packages/server/src/services/core/storage.ts` - Real storage service with atomic file operations
- `packages/server/src/services/core/config.ts` - Real config service with validation and persistence
- `packages/server/src/lib/file-logger.ts` - Enhanced file-based logging with rotation
- `packages/server/src/middleware/error-mapping.ts` - Structured error handling middleware
- Updated `packages/server/src/services/factory.ts` - Service factory with Phase 1 services
- Updated `packages/server/src/server.ts` - Settings endpoints using real ConfigService

**New Features:**
- ✅ **StorageService**: Atomic file writes, safe directory ops, ~/.hola structure creation
- ✅ **ConfigService**: System + backup settings with validation and file persistence
- ✅ **Enhanced Observability**: File-based logging, error metrics, structured error responses
- ✅ **Real Settings Endpoints**: `/api/settings` and `/api/settings/backup` using real persistence
- ✅ **Feature Flag Control**: `HOLA_USE_REAL_STORAGE=true HOLA_USE_REAL_CONFIG=true`
- ✅ **Health Monitoring**: Service health checks with automatic fallback to mocks

**Directory Structure Created:**
```
~/.hola/
├── config/
│   ├── system-settings.json
│   └── backup-settings.json
├── logs/
├── data/
├── backups/
└── temp/
```

**Verification Tests:**
- ✅ Storage service: File write/read operations, atomic writes, directory creation
- ✅ Config service: Settings persistence, validation, updates
- ✅ API endpoints: GET/PATCH `/api/settings` and `/api/settings/backup`
- ✅ Data persistence: Configuration changes survive server restarts
- ✅ Feature flags: Real services activate when flags enabled, fallback to mocks when disabled

### Phase 2: Database and repositories ✅ **COMPLETED (August 15, 2025)**

**Implemented Components:**
- `packages/server/src/services/core/database.ts` - SQLite database service with transactions and migrations
- `packages/server/src/services/core/repositories.ts` - Repository pattern for data access layer
- `packages/server/src/services/core/database-config.ts` - Database-backed config service
- Updated `packages/server/src/services/factory.ts` - Service factory with Phase 2 database services
- SQL migration system with trigger statement parsing

**New Features:**
- ✅ **DatabaseService**: SQLite with WAL mode, foreign keys, busy timeout configuration
- ✅ **Migration System**: Version-controlled database migrations with proper SQL parsing
- ✅ **Repository Layer**: Type-safe data access with `DatabaseSettingsRepository`, `JobRepository`, `CatalogRepository`
- ✅ **Database-backed Config**: Alternative to file-based config using database persistence
- ✅ **Transaction Support**: Full transaction management with rollback capabilities
- ✅ **SQL Parsing**: Handles complex SQL including triggers with semicolons

**Database Structure:**
```sql
~/.hola/data/hola.db (SQLite with WAL mode)
├── schema_migrations (version tracking)
├── settings (key-value store with JSON values)
├── jobs (job execution history and metadata)
└── catalog_apps (application catalog cache)
```

**Service Integration:**
- ✅ **Health Monitoring**: Database service reports health status to service factory
- ✅ **Automatic Fallback**: Unhealthy database services automatically fall back to mocks
- ✅ **Feature Flag Control**: `HOLA_USE_REAL_DATABASE=true` enables database services
- ✅ **Directory Management**: Ensures `~/.hola/data/` directory exists before database creation

**System API Improvements:**
- ✅ **Migrated Diagnostic Endpoints**: `/api/phase0/*` → `/api/system/*`
- ✅ **System Health Endpoint**: `/api/system/health` - Service health monitoring with timestamps
- ✅ **System Config Endpoint**: `/api/system/config` - Feature flags and configuration visibility
- ✅ **Complete Type Safety**: All system endpoints documented in `@hola/shared` with proper TypeScript types
- ✅ **Operational Readiness**: Health, config, status, metrics endpoints for production monitoring

**Endpoints Available:**
```typescript
// Operational monitoring
GET /api/system/health    // Service health status with timestamps
GET /api/system/config    // Feature flags and configuration  
GET /api/system/status    // Docker, disk, and version information
GET /healthz              // Basic health check with uptime/memory
GET /readyz               // Readiness check
GET /metrics              // Performance and usage metrics

// All endpoints with proper TypeScript types in shared package
```

**Verification Tests:**
- ✅ Database service: SQLite operations, migrations, transactions
- ✅ Repository layer: Type-safe data access, CRUD operations  
- ✅ Database-config service: Settings persistence via database
- ✅ Service health monitoring: All services reporting healthy status
- ✅ SQL parsing: Complex triggers and multi-statement SQL handled correctly
- ✅ Feature flag integration: Database services activate with `HOLA_USE_REAL_DATABASE=true`

**Next Phase:** Phase 4 - Docker + system monitoring + SSE status

### Phase 4: Docker + system monitoring + SSE status ✅ **COMPLETED (August 15, 2025)**

**Implemented Components:**
- `packages/server/src/services/core/docker.ts` - Docker service with container management operations
- `packages/server/src/services/core/system-monitoring.ts` - System monitoring service for resource and dependency monitoring
- Updated `packages/server/src/services/factory.ts` - Service factory with Phase 4 Docker and system monitoring services
- Updated `packages/server/src/server.ts` - System status endpoints using real monitoring data and SSE streams
- Updated `packages/server/src/config/features.ts` - Feature flag `useRealDocker` for progressive activation
- `packages/server/src/__tests__/phase4-contract.test.ts` - Comprehensive Phase 4 contract tests (14 tests)
- `packages/server/src/__tests__/phase4-docker-health.test.ts` - Docker health reporting tests

**New Features:**
- ✅ **DockerService**: Docker availability checks, version detection, Compose operations (up/down/ps/restart), container log streaming
- ✅ **SystemMonitoringService**: Real-time disk usage (df command), memory usage (/proc/meminfo), external tool detection (Docker, ORAS, Authentik)
- ✅ **Feature Flag Control**: `HOLA_USE_REAL_DOCKER=true` enables real Docker and system monitoring services
- ✅ **Real System Status**: `/api/system/status` endpoint using real SystemMonitoringService data
- ✅ **Enhanced Summary**: `/api/summary` includes real system status from monitoring service
- ✅ **SSE Status Streaming**: `/api/system/status/stream` provides real-time system updates every 5 seconds
- ✅ **Health Monitoring**: Both services report health status with automatic fallback to mocks
- ✅ **Graceful Degradation**: Works on machines without Docker by falling back to mock implementations

**Docker Integration:**
- ✅ **Availability Detection**: Checks Docker client and server availability separately
- ✅ **Version Information**: Reports Docker client, server, and API versions
- ✅ **Compose Operations**: Full Docker Compose project management (up, down, ps, restart)
- ✅ **Container Logs**: Real-time log streaming with timestamps and service detection
- ✅ **Error Handling**: Graceful handling of Docker unavailability with proper error messages

**System Monitoring:**
- ✅ **Disk Usage**: Real filesystem monitoring using `df` command with fallback estimation
- ✅ **Memory Usage**: Detailed memory information from `/proc/meminfo` with buffers/cache tracking
- ✅ **External Tools**: Detection of Docker, ORAS, and Authentik availability and versions
- ✅ **Real-time Updates**: Configurable monitoring intervals with callback-based updates
- ✅ **Resource Tracking**: Unified system resource reporting with comprehensive status

**SSE Implementation:**
- ✅ **Real-time Streaming**: Server-Sent Events for live system status updates
- ✅ **Monitoring Integration**: Uses SystemMonitoringService.startMonitoring() for real data
- ✅ **Update Frequency**: Configurable intervals (default 5 seconds) for status broadcasts
- ✅ **Fallback Handling**: Automatic fallback to mock SSE stream when monitoring service fails
- ✅ **Event Format**: Standardized JSON event format with type and data fields

**Service Integration:**
- ✅ **Health Monitoring**: Both services integrate with service factory health checking
- ✅ **Automatic Fallback**: Unhealthy services automatically switch to mock implementations
- ✅ **Feature Flag Integration**: Services activate based on `HOLA_USE_REAL_DOCKER` environment variable
- ✅ **Logging**: Comprehensive structured logging for all operations and health events

**Verification Tests:**
- ✅ Docker service: Availability checking, version detection, graceful degradation
- ✅ System monitoring: Disk usage, memory tracking, external tool detection
- ✅ SSE streaming: Real-time status updates, event format compliance
- ✅ API integration: Real data in system status and summary endpoints
- ✅ Performance: Response time validation for system status endpoints
- ✅ Error handling: Graceful fallbacks and mock service activation

**Endpoints Enhanced:**
```typescript
// Enhanced with real system monitoring data
GET /api/system/status     // Real disk, memory, Docker, ORAS, Authentik status
GET /api/summary          // Includes real system status alongside mock data
GET /api/system/health    // Reports Docker and system-monitoring service health

// New real-time streaming
GET /api/system/status/stream  // SSE stream with 5-second system updates

// Feature flag visibility
GET /api/system/config    // Shows useRealDocker flag status
```

**Next Phase:** Phase 5 - Jobs and structured logs

### Phase 5: Jobs and structured logs ✅ **COMPLETED (August 16, 2025)**

**Implemented Components:**
- `packages/server/src/services/core/jobs.ts` - Real and mock job service with persistent queue and progress tracking
- `packages/server/src/services/core/logging.ts` - Real and mock logging service with structured log streaming
- `packages/server/src/services/core/repositories.ts` - Enhanced `DatabaseJobRepository` for job persistence
- Updated `packages/server/src/services/factory.ts` - Service factory with Phase 5 jobs and logging services
- Updated `packages/server/src/server.ts` - Job endpoints and SSE streaming with robust error handling
- `packages/server/src/__tests__/phase5-contract.test.ts` - Comprehensive Phase 5 contract tests (4 tests)

**New Features:**
- ✅ **JobService**: Persistent background job queue with bounded concurrency, progress updates, retries/backoff, and cancellation
- ✅ **LoggingService**: Structured logs for jobs and deployments with real-time pub/sub streaming and file persistence
- ✅ **Feature Flag Control**: `HOLA_USE_REAL_JOBS=true` enables real job and logging services
- ✅ **Job Endpoints**: Complete REST API for job management (`/api/jobs`, `/api/jobs/:id`)
- ✅ **SSE Streaming**: Real-time job logs and updates via Server-Sent Events with robust disconnection handling
- ✅ **Database Persistence**: Jobs persist to SQLite with full CRUD operations and status tracking
- ✅ **Health Monitoring**: Both services report health status with automatic fallback to mocks

**Job Management Features:**
- ✅ **Bounded Concurrency**: Configurable job execution limits (default 2, via `HOLA_JOBS_CONCURRENCY`)
- ✅ **Retry/Backoff**: Exponential backoff retry logic (configurable via `HOLA_JOBS_MAX_RETRIES`, `HOLA_JOBS_BACKOFF_MS`)
- ✅ **Cooperative Cancellation**: Jobs can be cancelled gracefully between execution steps
- ✅ **Progress Tracking**: Real-time progress updates broadcast via SSE
- ✅ **Job Types**: Support for `install`, `update`, `backup`, `restore`, `start`, `stop`, `restart` operations
- ✅ **Queue Management**: Automatic re-queuing of pending jobs on service restart

**Logging Infrastructure:**
- ✅ **Structured Logging**: JSON-formatted logs with timestamps, levels, services, and metadata
- ✅ **Real-time Streaming**: In-process pub/sub for live log streaming to SSE clients
- ✅ **File Persistence**: Integration with Phase 1 FileLogger for log retention and archival
- ✅ **Target-based Logging**: Separate log streams for jobs (`job:id`) and deployments (`deployment:id`)
- ✅ **Log Levels**: Support for `debug`, `info`, `warn`, `error` log levels

**SSE Implementation Enhancements:**
- ✅ **Robust Stream Management**: Safe enqueuing with closed stream detection and graceful error handling
- ✅ **Dual Stream Support**: Both `/api/jobs/:id/logs` (logs only) and `/api/jobs/:id/logs/stream` (logs + job updates)
- ✅ **Heartbeat Management**: Regular heartbeats to maintain connection health
- ✅ **Event Types**: Standardized event format with `log`, `job_update`, and `heartbeat` event types
- ✅ **Disconnection Handling**: Proper cleanup of subscriptions when clients disconnect

**Service Integration:**
- ✅ **Health Monitoring**: Both services integrate with service factory health checking
- ✅ **Automatic Fallback**: Unhealthy services automatically switch to mock implementations
- ✅ **Feature Flag Integration**: Services activate based on `HOLA_USE_REAL_JOBS` environment variable
- ✅ **Deployment Actions**: Job creation integrated with deployment action endpoints

**Verification Tests:**
- ✅ Job service: Queue management, persistence, retry logic, cancellation, progress tracking
- ✅ Logging service: Structured logging, real-time streaming, file persistence integration
- ✅ API integration: Job creation, listing, SSE streaming with both mock and real implementations
- ✅ SSE robustness: Stream disconnection handling, error recovery, heartbeat management
- ✅ Database persistence: Job data survives service restarts, proper transaction handling
- ✅ Contract compatibility: All existing API contracts maintained during Phase 5 implementation

**Endpoints Enhanced:**
```typescript
// New job management endpoints
GET /api/jobs                    // List jobs with pagination and filtering
GET /api/jobs/:id               // Get specific job details
GET /api/jobs/:id/logs          // SSE stream for job logs
GET /api/jobs/:id/logs/stream   // SSE stream for job logs + status updates

// Enhanced deployment actions (now create real jobs)
POST /api/deployments/:id/actions  // Returns jobId for tracking

// Service monitoring
GET /api/system/health          // Reports jobs and logging service health
```

**Configuration Options:**
```bash
# Phase 5 feature activation
HOLA_USE_REAL_JOBS=true          # Enable real job service
HOLA_USE_REAL_DATABASE=true      # Required for job persistence
HOLA_USE_REAL_STORAGE=true       # Required for log file persistence

# Job service configuration
HOLA_JOBS_CONCURRENCY=2          # Max concurrent jobs
HOLA_JOBS_MAX_RETRIES=0          # Retry attempts per job step
HOLA_JOBS_BACKOFF_MS=500         # Base backoff delay
```

**Next Phase:** Phase 7 - Drafts, validation, and deployments

### Phase 6: Catalog + OCI bundle handling ✅ **COMPLETED (August 17, 2025)**

**Implemented Components:**
- `packages/server/src/services/core/catalog.ts` - Enhanced catalog service with SQLite FTS and real OCI integration
- `packages/server/src/services/core/bundles.ts` - Bundle service with ORAS integration and signature verification
- `packages/server/src/services/core/bundle-cache.ts` - LRU cache manager with retention policies and in-use protection
- `packages/server/src/services/core/compose-parser.ts` - Compose.yaml parser for auto-extracting defaults
- Updated `packages/server/src/services/factory.ts` - Phase 6 service registration with health monitoring
- Updated `packages/server/src/server.ts` - Catalog refresh endpoint and periodic refresh initialization
- Updated `packages/shared/src/index.ts` - Catalog refresh API endpoint constants
- `packages/server/src/__tests__/phase6-contract.test.ts` - Comprehensive Phase 6 contract tests (12 tests)
- `packages/server/PHASE6_SUMMARY.md` - Complete feature documentation and usage guide

**New Features:**
- ✅ **Enhanced CatalogService**: Database-backed catalog with SQLite FTS search, periodic refresh with ETag/Last-Modified support
- ✅ **BundleService**: Real ORAS integration for pulling OCI artifacts, bundle extraction and validation
- ✅ **BundleCacheManager**: LRU eviction with 1GB soft cap, retention policies for prior versions, in-use protection
- ✅ **Signature Verification**: Optional cosign integration with configurable policies (none/optional/required)
- ✅ **ComposeParser**: Auto-extraction of ports, volumes, and environment from compose.yaml files
- ✅ **Real OCI Integration**: getVersionDetail using actual OCI bundles with manifest.json parsing
- ✅ **Periodic Refresh**: Background catalog refresh every 5 minutes with proper HTTP caching
- ✅ **On-demand Refresh**: POST /api/catalog/refresh endpoint with force option
- ✅ **Merge Logic**: Combines compose.yaml defaults with manifest.json (manifest takes precedence)
- ✅ **Feature Flag Control**: `HOLA_USE_REAL_CATALOG=true HOLA_USE_REAL_BUNDLES=true`

**Cache Management:**
- ✅ **LRU Eviction**: Least-recently-used eviction when approaching size limits
- ✅ **Retention Policy**: Configurable retention of N prior versions per app (default: 2)
- ✅ **In-Use Protection**: Bundles marked as in-use are protected from all cleanup policies
- ✅ **Size Management**: 1GB soft cap with automatic cleanup and statistics tracking
- ✅ **Health Monitoring**: Cache health reported to service factory

**Compose.yaml Features:**
- ✅ **Port Detection**: Parses port mappings ("8080:80", "8443:443/tcp", "5432:5432/udp")
- ✅ **Volume Detection**: Extracts volume mounts ("./data:/app/data", "/host:/container:ro")
- ✅ **Environment Parsing**: Handles both array and object environment formats
- ✅ **Secret Detection**: Automatically identifies likely secret variables
- ✅ **Merge Logic**: Intelligent merging with manifest defaults (manifest precedence)

**API Integration:**
- ✅ **Real Bundle Details**: getVersionDetail() now uses actual OCI bundles when available
- ✅ **Fallback Strategy**: Graceful fallback to mocks when bundles or manifests unavailable
- ✅ **Refresh Endpoint**: POST /api/catalog/refresh with optional force parameter
- ✅ **Health Reporting**: Comprehensive health status for all catalog and bundle services

**Dependencies Added:**
- ✅ **yaml@2.8.1**: YAML parsing for compose.yaml files
- ✅ **@types/yaml@1.9.7**: TypeScript types for YAML parsing

**Configuration:**
```bash
# Enable Phase 6 features
HOLA_USE_REAL_CATALOG=true       # Real catalog service with database
HOLA_USE_REAL_BUNDLES=true       # Real bundle service with ORAS

# Bundle cache configuration
HOLA_CATALOG_RETAIN_VERSIONS=2    # Keep N prior versions per app
HOLA_CATALOG_CACHE_SIZE=1000000000 # 1GB cache size limit
HOLA_CATALOG_REFRESH_INTERVAL=300000 # 5 minute refresh interval

# Signature verification
HOLA_BUNDLE_SIGNATURE_POLICY=optional # none|optional|required
HOLA_BUNDLE_COSIGN_KEY=/path/to/key   # Cosign public key path
```

**Verification Tests:**
- ✅ Bundle cache manager: LRU eviction, retention policies, in-use protection
- ✅ Compose parser: YAML parsing, environment formats, default merging
- ✅ Catalog refresh: Periodic refresh, on-demand endpoint, ETag support
- ✅ Real OCI integration: Bundle fetching, manifest parsing, allowlist enforcement
- ✅ Service health: All services reporting healthy status with proper fallback

**Next Phase:** Phase 7 - Drafts, validation, and deployments

### Phase 3: Minimal AuthN/Z and request context ✅ **COMPLETED (August 15, 2025)**

**Implemented Components:**
- `packages/server/src/services/auth/auth-service.ts` - Authentication service with pluggable providers
- `packages/server/src/middleware/auth.ts` - Principal resolution and capability checking middleware
- Updated `packages/server/src/middleware/request.ts` - Enhanced request context with auth information
- Updated `packages/server/src/services/factory.ts` - Auth service integration with health monitoring
- Updated `packages/shared/src/index.ts` - Auth types and capabilities for frontend integration
- `packages/server/src/__tests__/phase3-contract.test.ts` - Comprehensive auth contract tests (19 tests)

**New Features:**
- ✅ **AuthService**: Pluggable authentication providers with health monitoring
- ✅ **API Key Provider**: Simple API key authentication with configurable principals and capabilities
- ✅ **Principal Resolution**: Middleware extracts authentication context from requests
- ✅ **Capability Checking**: Endpoint-level authorization based on required capabilities
- ✅ **Feature Flag Control**: `HOLA_USE_AUTH=true` enables authentication (disabled by default)
- ✅ **Graceful Degradation**: Automatic fallback to system principal when auth disabled
- ✅ **Public Endpoints**: Health, metrics, and system endpoints remain publicly accessible

**Authentication Flow:**
```typescript
// 1. Extract token from Authorization header, X-API-Key header, or query parameter
// 2. Authenticate using configured providers (API key, JWT, etc.)
// 3. Check required capabilities for the endpoint
// 4. Attach principal to request context for handlers

// Example with auth enabled:
curl -H "X-API-Key: dev-key-123" http://localhost:3001/api/settings
```

**Authorization Model:**
```typescript
// Capability-based authorization
const CAPABILITIES = {
  READ_SYSTEM: 'read:system',
  READ_DEPLOYMENTS: 'read:deployments', 
  WRITE_DEPLOYMENTS: 'write:deployments',
  WRITE_SETTINGS: 'write:settings',
  MANAGE_SYSTEM: 'manage:system',
  ALL: '*'
};

// Endpoint → Capability mapping
PATCH /api/settings → 'write:settings'
POST /api/deployments → 'write:deployments'
POST /api/deployments/{id}/actions → 'write:deployments'
```

**API Key Configuration:**
```typescript
// Development API keys (when HOLA_USE_AUTH=true)
'dev-key-123' → Full admin access (*)
'readonly-key-456' → Read-only access (read:*)
```

**Response Behavior:**
- ✅ **Auth Disabled (default)**: All requests succeed with system principal
- ✅ **Auth Enabled + Valid Key**: Normal request processing with authenticated principal
- ✅ **Auth Enabled + No Key**: 401 Unauthorized with WWW-Authenticate header
- ✅ **Auth Enabled + Invalid Key**: 401 Unauthorized with error details
- ✅ **Auth Enabled + Insufficient Capabilities**: 403 Forbidden with required capability info
- ✅ **Public Endpoints**: Always accessible regardless of auth state

**Service Integration:**
- ✅ **Health Monitoring**: Auth service reports health status to service factory
- ✅ **Automatic Fallback**: Unhealthy auth services automatically fall back to mock mode
- ✅ **Request Context**: Enhanced request context includes principal and auth state
- ✅ **Logging**: All auth events logged with request correlation IDs

**Verification Tests:**
- ✅ Auth service: Authentication, capability checking, health monitoring
- ✅ Auth middleware: Public endpoints, principal resolution, capability enforcement
- ✅ API integration: Token extraction, 401/403 responses, auth context propagation
- ✅ Backward compatibility: All existing endpoints work with auth disabled
- ✅ Feature flag integration: Proper service activation based on `HOLA_USE_AUTH`

**Next Phase:** Phase 4 - Docker + system monitoring + SSE status

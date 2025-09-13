# Phase 7 Design — Drafts, Validation, and Deployments

This document specifies the implementation design for Phase 7, with a deep focus on:
- Deployment lifecycle and step-by-step procedures
- On-disk directory structure, file formats, and atomicity/rollback strategy

It builds on Phase 4–6 foundations (Docker + system monitoring, jobs/logging, catalog + OCI bundles) and preserves existing API contracts.

## Goals and non-goals

Goals
- Real Drafts → Validation → Deployment workflow behind existing endpoints and SSE
- Deterministic, atomic, and recoverable deployments with rollback
- Clear, consistent on-disk layout under ~/.hola
- Port conflict detection across deployments and strong preflight validation
- Tight integration with JobService and LoggingService for traceability

Non-goals
- Multi-node orchestration or non-Docker runtimes
- Complex RBAC beyond existing capability checks
- Advanced rollout strategies (blue/green, canary) — out of scope for Phase 7

## Feature flags and runtime behavior

- HOLA_USE_REAL_DEPLOYMENTS=true (enable DraftService + DeploymentService)
- HOLA_USE_REAL_VALIDATION=true (enable ValidationService)
- HOLA_USE_REAL_DOCKER=true (required for real compose up/down)
- HOLA_USE_REAL_JOBS=true (deployment actions executed as jobs)
- HOLA_TRAEFIK_REQUIRED=true (require Traefik integration; fail validation if unavailable)
- HOLA_TRAEFIK_CONTAINER=traefik (docker name/id of system-wide Traefik)
- HOLA_TRAEFIK_ENTRYPOINTS=web,websecure (comma-separated)
- HOLA_TRAEFIK_DOMAIN_SUFFIX=.local.test (used for router rules when bundles use placeholders)
- Default behavior: if a service is unhealthy, auto-fallback to mocks with clear health signal.

Developer mode (optional, additive)
- HOLA_ENABLE_DEV_API=true (exposes additive dev endpoints; safe no-op when false)
- Behavior: provides short-lived “dev sessions” to accelerate bundle iteration without mutating core contracts. All endpoints are additive and may proxy to Draft/Validation/Deployment services under the hood.
 - Defaults: Dev sessions favor Traefik mode by default (no host ports, deterministic network name). When host `ports:` are present in dev mode and Traefik is enabled/required, validation surfaces clear tips to switch to `expose:` or Traefik labels.

## Core services (Phase 7)

- DraftService
  - CRUD for drafts; file add/update/delete; generate deployment plan
  - Finalize draft → immutable release candidate
- ValidationService
  - Schema + semantic checks; compose/env/ports/disk/images preflight
  - Docker prechecks: client/server reachable, images pullable
- DeploymentService
  - Create deployment; list/get/history
  - Execute actions (start/stop/restart/delete/rollback) via JobService
  - Release lifecycle management with atomic promotions

DevSessionService (optional when HOLA_ENABLE_DEV_API=true)
- Goal: Improve developer inner loop without changing primary contracts
- Responsibilities:
  - Create and manage ephemeral dev sessions bound to a deployment (or new draft)
  - Accept file sync deltas and materialize a working draft on the server
  - Trigger validate/finalize/deploy cycles and expose status via SSE
  - Enforce TTL and resource cleanup; never affect stable releases directly
  - Dev deploys use the same atomic promotion mechanism on each iteration; on health failure the system auto-rolls back to the last good release.
  - Optimization (optional, best-effort): attempt targeted restarts for only impacted services based on a compose diff heuristic to shorten cycles.

## Deployment lifecycle overview

States
- draft → validated → finalized → releasing → active | failed → rolled_back (optional)

Happy path
1) Create draft for app/version (or for update)
2) Edit files/env/settings as needed
3) Validate draft (schema + preflight; reserve ports)
4) Finalize draft → create release artifact (immutable)
5) Deploy release (docker compose up -d) with health checks
6) Promote release atomically (switch current symlink), retain previous release(s)

Failure path
- On deployment failure: auto-rollback to previous active release when available, mark release failed, attach logs and reason.

## On-disk directory structure

Base: ~/.hola

```
~/.hola/
├── config/
├── data/
├── logs/
├── backups/
├── temp/                              # temp + staging for atomic operations
├── runtime/                           # global runtime metadata (locks, registry)
│   ├── locks/
│   │   └── deployment-{id}.lock       # advisory lock per deployment
│   └── ports-registry.json            # reserved ports across all deployments
└── deployments/
    └── {deploymentId}/
        ├── metadata.json              # deployment-level metadata (name, app, tags)
        ├── state.json                 # computed state (active release, status, timestamps)
        ├── drafts/
        │   └── {draftId}/
        │       ├── manifest.json      # draft manifest (inputs + selected bundle refs)
        │       ├── env/.env           # env for compose; 0600 permissions
        │       ├── secrets/           # optional; files with 0600 permissions
        │       ├── overrides/         # optional compose overrides provided by user
        │       └── files/             # arbitrary files mounted/used by compose
        ├── releases/
        │   └── {releaseId}/           # e.g., 2025-08-17T12-34-56Z-abc123
        │       ├── manifests/
        │       │   ├── bundle-manifest.json  # from Phase 6 BundleService
        │       │   └── resolved.json         # merged manifest (compose + defaults)
        │       ├── compose/
        │       │   ├── docker-compose.yaml   # normalized compose (deterministic order)
        │       │   └── overrides/*.yaml      # compiled overrides (immutable copy)
        │       ├── env/.env                  # immutable copy of effective env
        │       ├── secrets/                  # immutable copy of secrets (0600)
        │       ├── volumes/                  # bind mounts or named volume manifests
        │       ├── runtime/
        │       │   ├── project-name          # compose project name used
  │       │   ├── network-name          # deterministic deployment network name
        │       │   └── docker/               # any runtime artifacts (e.g., lockfiles)
        │       ├── logs/
        │       └── metadata.json             # release metadata (ports, images, checksums)
        ├── current -> releases/{releaseId}   # symlink to active release
        └── history.json                      # capped history, audit trail
```

Key design choices
- Immutable releases: releases/{releaseId} content never mutates; derive from finalized draft.
- Atomic promotion: create release in temp, move into releases/, then update symlink `current` last.
- Secrets and env permissions: 0600, owned by service user.
- Deterministic compose: generated docker-compose.yaml is canonicalized for diffing and auditing.

## File formats (high-level)

metadata.json (deployment level)
- id, name, appId, createdAt, owner, tags

state.json
- status: active|stopped|failed|pending
- currentReleaseId
- lastAction: start|stop|restart|rollback|delete
- timestamps: lastDeployedAt, lastFailedAt

release metadata.json
- releaseId, draftId, createdAt
- images: [{name, tag, digest?}]
- ports: [{host, container, protocol, purpose}]
- filesChecksums: sha256 map for env, compose, overrides, secrets
- healthCheck: {type: http|tcp|none, endpoint?, port?, timeoutMs}

ports-registry.json
- { "tcp:80": { deploymentId, releaseId }, "udp:5432": { ... } }

history.json
- append-only log of actions with timestamps and outcomes

## Deployment steps (detailed)

A) Draft create/update
- Inputs: app/version selection, optional compose overrides, env vars, secrets, additional files
- Actions: write to deployments/{id}/drafts/{draftId}/; compute draft manifest
- Output: draftId

B) Validate draft (ValidationService)
- Schema/shape: ensure env/compose fields valid; merge with Phase 6 resolved defaults
- Port checks:
  - parse ports via ComposeParser; aggregate desired host ports
  - compare against runtime/ports-registry.json for conflicts across deployments
  - optionally reserve ports on validation success
- Disk checks: verify free space for images and volumes
- Image checks: for each image, verify pullability (docker inspect/pull --quiet)
- Secrets/env checks: ensure required env present; secrets paths readable
- Output: validation report with PASS/FAIL and reasons; reservation token for ports

C) Finalize draft → release candidate
- Create temp staging dir under ~/.hola/temp/deploy-{deploymentId}-{ts}-{rand}
- Materialize immutable tree:
  - manifests/bundle-manifest.json (from BundleService)
  - manifests/resolved.json (ComposeParser defaults + overrides)
  - compose/docker-compose.yaml (canonicalized)
  - overrides/*.yaml (copied and frozen)
  - env/.env (resolved)
  - secrets/* (copied with 0600)
  - volumes/ manifests or declarations (no host data copied)
  - runtime/project-name computed: hola-{deploymentId}
- Compute checksums; write release metadata.json
- Move staging dir to deployments/{id}/releases/{releaseId}

D) Deploy release (DeploymentService → JobService)
- Execute as job with advisory lock runtime/locks/deployment-{id}.lock
- Steps:
  1. Preflight re-check (docker available; reserved ports still free)
  2. docker compose -p $(project-name) -f compose/docker-compose.yaml [ -f overrides/* ] up -d --remove-orphans
  3. If Traefik mode enabled: docker network connect {deploymentNetwork} {HOLA_TRAEFIK_CONTAINER} (idempotent)
  4. Wait for health: http or tcp based on release metadata; timeout configurable
  5. If ok: promote atomically by updating symlink `current` to this release
  6. Update state.json (status=active, currentReleaseId)
  7. Update ports-registry.json with final bindings (in Traefik mode, primary app has no host ports)
  8. Emit structured logs and metrics (include step=traefik_connect when applicable)
- Failure handling:
  - Collect container logs snapshot to releases/{id}/logs
  - docker compose -p $(project-name) down if necessary
  - Attempt rollback to previous `current` release (if exists): re-up and wait health
  - Mark new release failed; preserve artifacts for inspection

E) Actions
- start: compose up -d for current release; health check; state=active
- stop: compose down; state=stopped (retain current symlink)
- restart: compose restart; or down+up when necessary; state preserved
- delete: stop + remove deployment directory (or archive); free reserved ports
  - In Traefik mode: docker network disconnect -f {deploymentNetwork} {HOLA_TRAEFIK_CONTAINER} (ignore if not connected)
- rollback: pick previous successful release in history; perform Deploy release steps on that release

F) Concurrency & idempotency
- Single-deployment lock ensures no overlapping jobs per deployment
- Job steps are idempotent where feasible (e.g., compose up -d safe to re-run)
- Crash recovery: if lock stale, allow reentry after TTL with clear logs; state inferred from Docker and symlink

## Compose generation and merge rules

Inputs
- Phase 6 parsed defaults (ComposeParser): ports, volumes, environment
- Manifest.json from bundle
- User overrides (compose fragments) and env/secrets

Rules
- Deterministic ordering of services, environment, ports
- Explicit precedence model (last one wins):
  - Compose files: base = bundle docker-compose; optional override = deployment-specific docker-compose.override. Final compose is base + override (override fields replace/extend base). If multiple overrides exist, apply in filename lexical order.
  - Env vars (three sources):
    1) System-wide env vars (lowest precedence)
    2) Bundle-provided env vars (from bundle manifest/compose/env)
    3) Deployment env vars (highest precedence)
    Resolution rule: 1 < 2 < 3; later sources overwrite earlier ones by key.
  - Files overlay: deployment additional files may overwrite bundle default files of the same path/name. Bundle files establish the baseline; deployment files act as an overlay with replace semantics on collision.
- Unsupported fields are preserved pass-through when safe
- Validate final ports and mounts post-merge

  ### Traefik integration and network model

  Network strategy
  - Each deployment defines its own dedicated Docker network with deterministic name, e.g., `hola-{deploymentId}-net`.
  - Services in the stack attach to this network (Compose default network renamed via `networks: { default: { name: hola-{deploymentId}-net } }`).
  - A system-wide Traefik container (HOLA_TRAEFIK_CONTAINER) is connected to this network post `compose up` using `docker network connect` (idempotent). This enables service-name DNS across the stack and Traefik.

  Exposure model
  - Primary app service does not expose host ports. Incoming traffic is handled exclusively by the system Traefik instance via the shared network link.
  - Internally, services may use `expose:` or just the container port; Traefik labels specify which internal port to route to (no `ports:` host bindings).

  Labels
  - Bundles include Traefik labels on the primary service. The DeploymentService preserves/merges these labels. Common keys:
    - `traefik.enable=true`
    - `traefik.http.routers.<name>.rule=Host(`<host>`)` or path-based rules
    - `traefik.http.routers.<name>.entrypoints={HOLA_TRAEFIK_ENTRYPOINTS}`
    - `traefik.http.services.<name>.loadbalancer.server.port=<containerPort>`
    - Optional TLS: `traefik.http.routers.<name>.tls=true`

  Validation rules (Traefik mode)
  - Fail if Traefik is required and container `HOLA_TRAEFIK_CONTAINER` is not found/running.
  - Fail if primary service declares host `ports:` mappings; suggest `expose:` or purely labels-based target port.
  - Warn if mandatory labels are missing; fail if router/service cannot be resolved.
  - Ensure deployment network name is valid and will not collide.

  Runtime artifacts
  - Write `runtime/network-name` with the resolved deployment network name.
  - Log `traefik_connect` and `traefik_disconnect` actions with outcomes.

### Worked example: precedence in practice

Inputs (non-Traefik example)
- System env (lowest precedence):
  - APP_PORT=3000, LOG_LEVEL=warn, GLOBAL=1
- Bundle compose and env:

```yaml
# bundle: docker-compose.yaml (base)
services:
  web:
    image: example/web:1.0
    ports:
      - "${APP_PORT}:80"     # uses env
    environment:
      NODE_ENV: production
      LOG_LEVEL: info         # bundle default
    volumes:
      - ./config/default.conf:/etc/web/default.conf:ro
    env_file:
      - ./env/.env
```

```env
# bundle: env/.env
APP_PORT=8080
LOG_LEVEL=info
BUNDLE_ONLY=1
```

- Deployment override and env (highest precedence for env):

```yaml
# deployment: docker-compose.override.yaml (override)
services:
  web:
    ports:
      - "8081:80"            # replaces ports array from base (array replace semantics)
    volumes:
      - ./files/site.conf:/etc/web/default.conf:ro  # overrides same mount target
    labels:
      - "hola.deployment=abc123"
```

```env
# deployment: env/.env
LOG_LEVEL=debug
DEPLOYMENT_ONLY=1
```

Overlay behavior
- Compose: final ports = ["8081:80"] because override replaces the array; labels added; volumes merged and the later binding to `/etc/web/default.conf` wins.
- Env: resolution 1 < 2 < 3 ⇒ APP_PORT=8080 (bundle overrides system), LOG_LEVEL=debug (deployment overrides bundle), GLOBAL=1 preserved, BUNDLE_ONLY=1 preserved, DEPLOYMENT_ONLY=1 added.
- Files: deployment `files/site.conf` replaces bundle `config/default.conf` at the same container target path.

Final effective artifacts (written into release directory)

```yaml
# releases/{releaseId}/compose/docker-compose.yaml (canonicalized)
services:
  web:
    image: example/web:1.0
    ports:
      - "8081:80"
    environment:
      NODE_ENV: production
      LOG_LEVEL: debug
    volumes:
      - ./files/site.conf:/etc/web/default.conf:ro
    labels:
      - hola.deployment=abc123
    env_file:
      - ./env/.env
```

```env
# releases/{releaseId}/env/.env (effective env, merged in order System < Bundle < Deployment)
APP_PORT=8080
LOG_LEVEL=debug
GLOBAL=1
BUNDLE_ONLY=1
DEPLOYMENT_ONLY=1
```

Notes
- If multiple override files exist, they are applied in lexical order (e.g., `10-network.yaml`, `20-ports.yaml`).
- Arrays in Compose typically replace; maps merge with override keys winning. We canonicalize the final YAML for deterministic diffs.

### Worked example: Traefik mode (no host ports)

Inputs
- System env: LOG_LEVEL=warn
- Bundle compose + labels (primary service `web`), no host ports:

```yaml
services:
  web:
    image: example/web:1.1
    # no `ports:`; optional `expose: [80]` or omit if labels specify the port
    labels:
      - traefik.enable=true
      - traefik.http.routers.app.rule=Host(`app${HOLA_TRAEFIK_DOMAIN_SUFFIX}`)
      - traefik.http.routers.app.entrypoints=${HOLA_TRAEFIK_ENTRYPOINTS}
      - traefik.http.services.app.loadbalancer.server.port=80
networks:
  default:
    name: hola-DEPLOY123-net
```

Deployment env overrides

```env
LOG_LEVEL=debug
```

Effective artifacts

```yaml
services:
  web:
    image: example/web:1.1
    labels:
      - traefik.enable=true
      - traefik.http.routers.app.rule=Host(`app.local.test`)
      - traefik.http.routers.app.entrypoints=web,websecure
      - traefik.http.services.app.loadbalancer.server.port=80
networks:
  default:
    name: hola-DEPLOY123-net
```

```env
LOG_LEVEL=debug
```

Deployment steps include connecting Traefik to `hola-DEPLOY123-net` and later disconnecting on delete.

## Health checks

- http: GET http://localhost:{port}{path} with timeout; retry/backoff configurable
- tcp: attempt TCP connect to port
- none: consider success once containers are running
- Health failures trigger rollback when previous release exists

## Port conflict detection and reservation

- Registry file runtime/ports-registry.json maintained by DeploymentService
- Reserve ports during validation with short TTL; confirm on successful deploy
- Release reservations on cancel/failure/timeout

## Security & permissions

- Secrets stored with 0600; no logs of secrets values
- Compose env expansion allowed only from env/.env and secrets/ files under deployment dir
- Host volume mounts restricted to paths under ~/.hola/ by default (configurable allowlist)

## Observability and metrics

- Logs: job-level logs for each major step; container logs snapshot on failure
- Metrics: counters for deploy_attempts, deploy_success, deploy_failure; timers for stages
- SSE: deployment events stream mirrors job events with types: plan, preflight, compose_up, health_ok, promoted, failed, rollback_started, rollback_ok

## API contract mapping (high-level)

Existing endpoints (from shared contracts) remain stable:
- Drafts
  - GET/POST /api/drafts
  - GET/PATCH/DELETE /api/drafts/:id
  - POST /api/drafts/:id/validate → returns validation report
  - POST /api/drafts/:id/finalize → returns deploymentId + releaseId
- Deployments
  - GET/POST /api/deployments
  - GET /api/deployments/:id
  - GET /api/deployments/:id/history
  - POST /api/deployments/:id/actions { start|stop|restart|delete|rollback }
  - SSE: /api/deployments/:id/events
- Jobs
  - Job IDs returned for long-running actions; clients subscribe to job SSE

Note: precise request/response types are defined in @hola/shared and must not change.

Optional developer endpoints (additive; behind HOLA_ENABLE_DEV_API)
- Dev sessions
  - POST /api/dev/sessions
  - body: { deploymentId? string; appId? string; version? string; mode?: 'upload'|'ref'; ref?: string; options?: Record<string, unknown> }
  - returns: { id, sessionId: string (alias of id), deploymentId, draftId, createdAt, expiresAt }
  - PATCH /api/dev/sessions/:id/sync
    - Description: multipart sync supporting either a full `bundle.tgz` upload or a small delta of file operations.
    - body (delta mode): { files: Array<{ path: string; op: 'add'|'change'|'delete'; contentBase64? string }> }
    - returns: { ok: true, draftId, validation?: ValidationReport, stats?: { added, changed, deleted, bytes } }
  - POST /api/dev/sessions/:id/deploy
  - body: { stream?: boolean }
  - returns: { ok: true, jobId, releaseId }
  - GET /api/dev/sessions/:id/status
  - returns: { state: 'idle'|'validating'|'finalizing'|'deploying'|'error', lastJobId?, validationReport?, activeReleaseId?, lastError? }
  - DELETE /api/dev/sessions/:id
    - returns: { ok: true }
  - GET /api/dev/sessions/:id/events (SSE)
    - events: dev_sync, validate_pass, validate_fail, deploy_started, deploy_ok, deploy_failed

- Ad-hoc helpers (additive; not behind dev sessions)
  - POST /api/validation/compose
    - body: { composeYaml: string; overrides?: string[]; env?: Record<string,string>; secrets?: Record<string,string> }
    - returns: ValidationReport (ports/images/env/traefik rules)
  - POST /api/bundles/import
    - Description: One-shot helper for non-dev flow. Accepts `bundle.tgz` upload (multipart) or `{ ref: string }` when server can pull via ORAS.
    - returns: { appId, version, draftId }
  - POST /api/bundles/register (optional, future)
    - body: { ref: string; metadata?: Record<string, unknown> }
    - returns: { ok: true }

Notes
- These endpoints are additive and may internally use DraftService, ValidationService, and DeploymentService. They are feature-flagged and must be clearly surfaced by /api/system/config for clients to detect.
- When disabled, clients should gracefully fall back to the standard Draft/Deployment flow.
 - Method consistency: dev sync uses PATCH for deltas; servers may accept full re-uploads in the same endpoint when `mode='upload'`.

## Edge cases

- Docker unavailable mid-deploy → fail and rollback, emit actionable error
- Port already taken outside registry → detect via runtime probe before compose up
- Disk full during staging → abort, clean temp, no partial release
- Health never green → timeout, collect logs, rollback
- Secrets missing → validation fail; never attempt deploy
- Compose syntax invalid → validation fail; provide diagnostics

## Testing strategy

- Unit tests: DraftService, ValidationService (ports/env/disk/images), DeploymentService (plan/promotion)
- Integration tests (with Docker): compose up/down flows, health checks, rollback
- Contract tests: ensure endpoint shapes and SSE events unchanged
- Failure tests: forced port conflict, simulated disk full, health timeout → rollback
- Persistence tests: restart service mid-deploy; ensure idempotent recovery

## Rollback strategy

- Maintain at least one prior successful release per deployment
- On failure, auto-rollback to most recent successful release if available
- Manual rollback action selects target from history
- Never delete failed releases automatically; subject to retention policy later

## Retention and cleanup

- Keep N prior successful releases (configurable, default 2)
- Preserve failed releases for 7 days (configurable) then purge
- Logs older than retention window archived or deleted

## Minimal implementation milestones

1) Directory scaffolding + metadata/state files
2) Draft CRUD and materialization to release staging
3) ValidationService: ports/env/compose/images/disk
4) Deploy job: compose up/down, health, atomic promote, rollback
5) Ports registry + reservations
6) SSE events + logs integration
7) Tests and docs

## Open questions (tracked for refinement)

- Should compose project names include releaseId or be stable per deployment? Proposed: stable per deployment (hola-{deploymentId}) for predictable networks/volumes; releaseId used only for artifacts.
- Health check definitions source: bundle manifest vs. user overrides — proposal: manifest defaults with user override allowed.
- Cross-host volume allowlist defaults — proposal: restrict to ~/.hola unless explicitly enabled.

---

This design provides a deterministic, auditable, and recoverable deployment flow with a clear on-disk layout and minimal operational surprises. It leverages existing services (catalog/bundles, jobs/logging, docker/system monitoring) and remains fully compatible with current API contracts.

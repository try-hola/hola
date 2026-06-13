# HOLA Product Requirements & Architecture

> **Status (June 2026):** Hola is in an active **recovery** phase after an idle period. This
> document has been reconciled with the actual codebase — claims that were aspirational or
> never built are now marked as such. The authoritative, dependency-ordered plan of record is
> the **recovery epic, GitHub issue #21**. See **§0 Current Direction & Status** before relying
> on any later section. Full documentation reconciliation lands with issue #20.

## 0. Current Direction & Status

### The thesis
Hola deploys self-hosted apps onto a **single host** and exposes every one of them through **one
consolidated front door — Traefik** — eventually behind **one consolidated login (SSO)**. You log
in once and reach all your apps. The catalog → draft → validate → deploy → manage → survive-restart
machinery exists to feed that front door.

### MVP, in two parts
- **MVP pt.1 — the core loop is real.** Hola deploys a real app as a Docker Compose project,
  exposed via Traefik (no per-app host ports), with state that survives a restart. The control
  plane (web/CLI/API) is guarded by a simple single-admin + API-key scheme. The concrete proof:
  **deploy Gitea through Hola and reach it via Traefik.** Gitea is the flagship deployed app (used
  by the owner for non-public projects); Hola itself remains a public project developed on GitHub.
- **MVP pt.2 — consolidated SSO.** Shared authentication that is **external to each deployed app**
  and reusable across them (single sign-on via Traefik forward-auth / an identity provider such as
  Authentik), so one login covers Gitea and every app deployed after it.

### Audience
Single-operator first (the project owner), with broader home-lab-community aspirations later. Build
single-operator-first without precluding multi-user.

### Honest implementation status
The backend is a well-typed skeleton; roughly **40% is functional**. Real today: storage,
`bun:sqlite` persistence, the Draft lifecycle (create/edit/validate/preflight/finalize), the job
queue, system monitoring, catalog + ORAS pulls, and a Docker CLI wrapper. **Stubbed or simulated
today:** deployment orchestration (jobs simulate steps and do **not** invoke Docker), Traefik
(routing rules are generated as JSON metadata, not emitted to a running proxy), auth (framework
exists but ships with no usable credentials), backups, and notifications. Draft and deployment
state are written to disk but **not yet rehydrated on restart**. The Compose stack is a routing
skeleton with placeholder images, not yet runnable. Closing exactly these gaps is the recovery epic.

### Settled architectural decisions (June 2026)
- **Traefik-only ingress; no per-app host ports.** Apps run on isolated Compose networks and are
  reached only through Traefik. The former host-port reservation/registry is being removed.
- **HTTP framework migration is planned, not done.** The server currently uses a hand-rolled router
  on Bun's `Bun.serve()`. Adopting a Bun web framework (Hono — the pragmatic default — or Elysia)
  is tracked as dedicated future work, separate from the recovery critical path. The PRD's earlier
  "Phase 0: Hono" was aspirational and never implemented.
- **Persistence is `bun:sqlite` + the filesystem.** Drizzle was never adopted; references to it are
  historical.
- **Auth is delivered in two phases** (control-plane admin/API-key first, app SSO second) as above.

### Deferred but tracked
Backups & restore, notifications, change-drafts / blue-green / in-place upgrades, email, telemetry,
and monetization are **deferred until the core install → manage → restart loop works.** The
business/market goals in §2 are longer-term aspirations, not recovery targets.

---

## 1. Vision
Hola streamlines the discovery, deployment, and lifecycle management of self-hosted applications for
home lab enthusiasts. It provides an approachable web experience, a scriptable CLI, and automated
backend services so hobbyists can install, customize, monitor, and maintain apps with confidence
while retaining full control of their infrastructure.

## 2. Goals

> **Recovery note:** the **Business Goals** below are longer-term aspirations and are shelved during
> the recovery. The near-term goal is the MVP defined in §0.

### Business Goals (aspirational / post-recovery)
- Reach 1,000 active users within six months of launch and capture roughly 10% of the home lab
  enthusiast market in year one.
- Cultivate an open-source community with at least 50 contributors during the first year.
- Establish monetization (premium features or support) by month 12.

### User Goals
- Enable low-friction app installs, updates, and lifecycle management.
- Provide a secure, centralized dashboard with health, notifications, and backups.
- Deliver a curated, well-documented app catalog with ratings and one-click installs.
- Offer automation for backup, restore, and migration workflows.

### Non-Goals
- Hosting or providing third-party infrastructure.
- Enterprise multi-tenant SaaS support.
- Deep app development tooling beyond deployment and configuration management.

## 3. Target Users & Personas
- **Alex – Home Lab Enthusiast (Intermediate):** Wants discovery, painless installs, timely updates,
  and health monitoring.
- **Jamie – Newcomer (Beginner):** Needs guided onboarding, clear explanations, and easy rollback
  mechanisms.
- **Morgan – Power User (Advanced):** Requires granular configuration (env, volumes, runtime
  parameters), automated backups, and integration hooks for existing tooling.

## 4. Product Scope & Functional Requirements

### Platform Scope
- Targets a **single-node** home lab host running Docker with **Compose v2**. (Originally scoped to
  OrbStack; the architecture is plain Compose and is not OrbStack-specific.)
- HTTPS/TLS termination and host-based routing via **Traefik** are central — Traefik is the
  consolidated front door, not an optional add-on.
- **No per-app host ports.** Application ingress is handled entirely through Traefik routing.
- Sized for 1–10 users and roughly 5–50 applications.

### Onboarding & First-Time Experience
- Installation via script or container with prerequisite checks.
- First launch establishes the first administrator (mechanism defined by the auth ADR, issue #53).
- **MVP pt.1:** simple single-admin + API-key control-plane access. **MVP pt.2:** consolidated SSO.
  *(Status: a web login/onboarding flow does not exist yet; the web app currently assumes a token.)*

### App Catalog & Install Flow
- Responsive catalog with search, filters, and enriched app detail pages. *(Built and wired.)*
- Install wizard backed by the Draft workflow *(built and wired in the web app)*:
  - Environment variable editing with validation metadata.
  - Compose override upload with syntax validation.
  - Additional file uploads (config, secrets) with list management.
  - Advanced options for volumes and other runtime parameters.
  - Real-time validation, asynchronous preflight checks, and a summary confirmation before deploy.
  - Progress indicators and actionable error handling.
- Deployments are persisted as jobs with SSE-powered status streaming. *(Job records are real; job
  **execution** is currently simulated — real Docker orchestration is issue #15.)*

### Post-Deployment Management
- Dashboard lists deployments with status and lifecycle controls (start, stop, restart, update,
  uninstall) plus access to logs. *(Dashboard and controls are wired; lifecycle actions create jobs
  but do not yet drive real containers — issue #15.)*
- Deployment history retains release-based snapshots with attribution. *(History is served from
  service state; durable release history is issue #14.)*
- **Deferred:** Change Drafts for post-deploy edits (generation versioning, diffs, in-place vs
  blue/green apply/rollback), per-deployment metrics, and backups tabs.

### Backups & Restores *(Deferred — currently stubbed)*
- Planned: scheduled `tar.gz` backups under the data root with bounded retention per deployment, and
  restore/migration tooling per deployment.

### Notifications & Monitoring
- **Deferred:** in-app/email notifications (currently stubbed).
- Health dashboards and logs are accessible per deployment; system monitoring is real (disk, memory,
  Docker, ORAS availability).

### Advanced & Edge-Case Handling
- Routing conflict detection (Traefik host/path) with guided remediation. *(Conflict detection
  exists; production routing emission is issue #16.)*
- Secrets redaction in diffs/logs and preservation of unchanged secrets across changes.
- Concurrency guard preventing simultaneous submitted drafts per deployment. *(Planned.)*

### CLI Experience
- React + Ink CLI (`@hola/cli`) mirrors web workflows for automation via the standard Draft /
  Deployment APIs.
- **Status:** `hola bundle validate` works end-to-end; `hola bundle deploy` currently stops at draft
  finalization (completing it is issue #54); `bundle dev` is an intentional stub.
- Commands emphasize scriptability, colored output, optional JSON, and non-zero exit codes on
  failure. SSE job-watch streaming is planned (#54).
- **Note:** legacy development-session commands were removed in favor of standard Draft/Deployment
  workflows.

## 5. System Architecture Overview

### Deployment Model
- Delivered as a Docker Compose stack including the Hola API (Bun/TypeScript), the React SPA
  frontend, and Traefik. *(An identity provider for SSO arrives with MVP pt.2.)*
- The Hola server is granted Docker access (e.g. `/var/run/docker.sock`) to orchestrate Compose
  deployments. *(Socket mounting and a runnable stack are issue #55.)*

### Core Components
- **Frontend:** React SPA (Vite build).
- **Backend API:** Bun + TypeScript services orchestrating catalog management, OCI pulls via the
  ORAS CLI, bundle processing, job handling, metrics, Docker Compose operations, and (planned)
  backups and auth. **HTTP layer:** currently a hand-rolled router on `Bun.serve()`; a Bun web
  framework migration (Hono/Elysia) is tracked separately.
- **Storage Layout:** a configurable data root (default `~/.hola`) hosting deployments, a `bun:sqlite`
  catalog/index and job store, a secrets store, job logs, generated Traefik runtime config, and
  deployment/release state.
- **Runtime:** Docker engine with Compose v2; deterministic per-deployment project names prevent
  conflicts; apps run on isolated networks.
- **Ingress & Auth:** Traefik terminates HTTPS and routes by host. Authentication is two-phase
  (§0): control-plane admin/API-key first, then consolidated SSO (forward-auth / Authentik) in
  front of deployed apps.

### Data & Configuration
- Catalog metadata in `bun:sqlite` (WAL mode); full-text search planned as needed.
- Deployment storage under the data root with immutable release snapshots and an atomically switched
  `current` pointer. *(Durable persistence + rehydration are issues #11 and #14.)*
- Secrets stored locally with encryption at rest; CLI and UI hide secret values in diffs/logs.

### Environment Configuration System
Hola uses a simplified **3-environment** configuration system (replacing an earlier 15-flag matrix):

- **Test** (`NODE_ENV=test`, `VITEST=true`, or `HOLA_DISABLE_AUTOSTART=true`): all mock services,
  auth/observability disabled, deterministic in-process execution.
- **Development** (`NODE_ENV=development`): real storage/database/monitoring with a **mock Docker**
  service for safety; auth disabled by default (`HOLA_USE_AUTH=true` to enable); observability
  optional (`HOLA_USE_OBSERVABILITY=true`).
- **Production** (default): all real services; auth and observability enabled by default; can be
  overridden via `HOLA_USE_AUTH=false` / `HOLA_USE_OBSERVABILITY=false`.

Service selection happens in the factory by environment, not via per-route branching.

### Key Domain Models
- **Draft:** pre-deployment customization (env, overrides, files, advanced options, status).
- **Upload:** metadata for temporary files associated with drafts.
- **Release:** an immutable, finalized deployment artifact with checksums and metadata.
- **Deployment History Entry:** release/job-based changelog with timestamps, attribution, and
  related job/draft IDs.
- *(Deferred: **ChangeDraft** for live deployments with in-place/blue-green strategies.)*

### API Surface (Representative)
- Draft lifecycle: `POST/GET/PATCH/DELETE /api/drafts/:draftId`, plus validate, preflight, finalize.
- Deployments: `GET/POST /api/deployments`, `GET/PATCH/DELETE /api/deployments/:id`, `actions`,
  `rollback`, `history`, and log streams.
- Jobs: creation returns `jobId` and streams updates via SSE.
- Catalog, settings, and system endpoints. *(Backups/notifications endpoints exist but are stubbed.)*

### Realtime & SSE
- SSE endpoints stream job/deployment logs and system status updates.
- Events include `log`, `job_update`, `system_status`, `deployment_update`, and `heartbeat`, aligned
  with the shared `SSEEvent` union type.
- The server sends heartbeats and manages backpressure; the web client reconnects with backoff.
  *(Real log streaming from containers is wired with orchestration in #15; fallback synthetic logs
  exist today.)*

### Observability & Security
- Metrics: draft/validation/job/rollback counters and HTTP request duration histograms (Prometheus).
- Logging: structured JSON with correlation IDs, attribution, and secret redaction.
- Auth model: two-phase (§0). Validation and preflight guardrails ensure safe configuration changes.

## 6. Server Recovery Roadmap

> Replaces the earlier "Phase 0–7" framing, which is historical. The plan of record is **epic #21**.

Dependency-ordered recovery (`→` denotes "unblocks"):

1. **Restore a green baseline** — install, lint, typecheck, tests, builds all pass. *(#52 — done.)*
2. **Consolidate deployment API state ownership** — one service behind every route. *(#56 — done.)*
3. **Make drafts and releases durable** — persist + rehydrate drafts and finalized artifacts (#11);
   atomic release promotion, history, and rollback that survive restart (#14).
4. **Complete validation and routing** — strict Compose/semantic validation (#13); deterministic
   Traefik routing generation, validation, and persistence (#16).
5. **Connect real orchestration** — `DeploymentService` drives `DockerService` for real Compose
   lifecycle with durable jobs and real log/SSE streaming, no host ports (#15).
6. **Decide auth and ship the stack** — auth architecture ADR + implementation (#53); a runnable
   single-host production Compose stack with images, persistence, Docker access, and routing (#55).
7. **Complete the CLI** — finish `bundle deploy` through deployment + job watch (#54).
8. **Verify** — API contract/routing tests (#17), end-to-end recovery smoke tests (#18), and a
   conditional Docker/Compose integration test (#19).
9. **Align documentation** with the recovered system (#20).

**Recovery definition of done:** a clean checkout passes all gates; a documented Compose stack starts
on a clean Docker host; an administrator can authenticate via the supported flow; one catalog app
completes draft → validation → deployment → job/log streaming; deployment state, releases, routing,
and history survive a restart; lifecycle actions invoke real Compose operations and report truthful
terminal state; contract/smoke/integration tests cover the supported workflow; and docs describe
implemented behavior while clearly marking future work.

## 7. CLI Architecture & Roadmap
- **Package:** `packages/cli` (TypeScript + React + Ink), distributed via a `hola` bin wrapper.
  Depends on `@hola/sdk` and `@hola/shared` for shared contracts.
- **Tooling:** Bun-driven dev, `bun build` to Node-target ESM, strict TypeScript, linting, and tests.
- **Current surface:** `bundle validate` (working), `bundle deploy` (finalizes a draft; full
  deployment + SSE job-watch is #54), `bundle dev` (intentional stub).
- **Planned:** complete deploy/job-watch, then `bundle init/pack/push/logs/clean` with file watching,
  Traefik-aware validation, and stable JSON output.
- **Runtime expectations:** clear status-line UI, `<Static>` log rendering, environment variables
  (`HOLA_API_URL`, `HOLA_TOKEN`), and robust network/auth error handling.

## 8. Monorepo Structure & Tooling
- Bun workspaces:
  - `packages/web` – React/Vite SPA.
  - `packages/server` – Bun REST API.
  - `packages/shared` – shared types and API constants (single source of truth for contracts).
  - `packages/sdk` – isomorphic API client used by web and CLI.
  - `packages/cli` – Ink-based CLI.
  - `packages/compose` – the single-host deployment stack (Traefik + server + web). *(Skeleton; a
    runnable stack is #55.)*
- Root scripts: `bun install`, `bun run dev` (web + server), plus per-package
  `dev`/`build`/`lint`/`typecheck`/`test`. The Vite dev server proxies `/api` to the backend.
- CI (`.github/workflows/ci-bun.yml`) installs Bun and runs lint/typecheck/build/test across
  filtered packages.

## 9. Testing Strategy & Quality Assurance

### Standardized in-process test environment
Tests run **in-process** (no background servers, ports, or external dependencies) for fast, reliable
execution with fresh state per file. Real-service tests use temporary data roots so they pass without
a writable home directory.

- **Helpers:** standardized setup/teardown under `packages/*/src/__tests__/helpers/`.
- **Commands:** `bun test` (all), `bun run test:server` / `test:web`, watch variants, and
  `bun run test:env:integration` for Docker-dependent scenarios (skipped when Docker is unavailable).
- **Organization:** feature-grouped tests under `src/__tests__/` (drafts, deployments, validation,
  auth, …).
- **Quality gates:** no background processes; proper cleanup; environment selected via the runner;
  shared contracts kept aligned with server behavior. Legacy external-server patterns are deprecated.

The recovery adds API contract tests (#17), end-to-end smoke tests (#18), and a conditional Docker
integration test (#19).

## 10. Operational & Platform Considerations
- **Packaging:** Dockerized services; ORAS CLI for OCI artifact pulls; deploy assets in
  `packages/compose` (compose file, env template, install/up/down/logs/status scripts). *(Production
  images and mounts are #55.)*
- **Auth & Ingress:** Traefik handles TLS and host routing; consolidated SSO arrives in MVP pt.2;
  the CLI uses token/API-key auth.
- **Storage hygiene:** encrypted secrets, job logs, release snapshots, generated Traefik config;
  SQLite WAL mode.
- **Reliability:** SSE heartbeat/reconnection, concurrency guards, routing-conflict detection, and
  restart recovery of durable state.
- **Accessibility:** high-contrast UI, responsive design, keyboard navigation, screen-reader support.
- **Deferred:** automated backups/rotation and restore tooling.

## 11. Success Metrics & Tracking

> Aspirational / post-recovery. The recovery's success measure is the §6 definition of done.

- **User Metrics:** active users, apps per user, onboarding completion, satisfaction (NPS/surveys).
- **Business Metrics:** growth, retention, community engagement (stars, contributors), revenue.
- **Technical Metrics:** deployment duration, uptime (>99.5%), failure rate (<2%), backup success.

## 12. Questions & Unknowns

### Resolved (June 2026)
- **Ingress / ports:** Traefik-only; no per-app host ports or port registry.
- **HTTP framework:** hand-rolled router today; migration to a Bun framework (Hono/Elysia) tracked
  as separate future work.
- **Persistence:** `bun:sqlite` + filesystem (not Drizzle).
- **Auth shape:** two-phase — control-plane admin/API-key first, app SSO (forward-auth/Authentik)
  as MVP pt.2. (Exact provider/flow finalized in the #53 ADR.)
- **Audience:** single-operator first, multi-user-capable later.
- **Deferred scope:** backups, notifications, change-drafts/blue-green, email, telemetry,
  monetization.

### Still open
1. **Auth provider specifics:** which forward-auth/IdP for SSO, token/key lifecycle, and first-admin
   bootstrap (the #53 ADR).
2. **Catalog source of truth & governance:** where catalog definitions originate and how they are
   reviewed/trusted.
3. **Backup retention & disk-pressure alerts:** policies beyond a simple per-deployment cap.
4. **Secrets roadmap:** timeline for external secret stores; compliance constraints on encryption.
5. **CLI distribution:** npm/brew publication and Windows/WSL support.
6. **Telemetry & privacy:** what (if any) optional analytics, and consent handling.
7. **Premium feature definition:** free vs paid boundaries (post-recovery).

## 13. Architectural Evolution & Decisions

### Recovery & reconciliation (June 2026)
- Re-anchored the project on the §0 thesis and the two-part MVP after an idle period; established the
  recovery epic #21 as the plan of record.
- Recorded settled decisions: Traefik-only ingress (no host ports / no port registry), `bun:sqlite`
  persistence, two-phase auth, and a tracked (not-yet-done) migration to a Bun web framework.
- Reconciled this PRD with the actual codebase: corrected the Hono and Drizzle claims, marked
  orchestration/Traefik/auth/backups/notifications as stubbed, and flagged that durable state does
  not yet survive restart. Full doc reconciliation completes in #20.

### API simplification (September 2025)
**Decision:** permanently removed development-specific API endpoints (`/api/dev/*`).

**Rationale:** dev APIs added complexity without value over the standard Draft/Deployment workflows;
a smaller surface is easier to maintain and learn.

**Impact:** CLI validation uses the Draft workflow (create → upload → validate); SSE event types were
simplified; web dev dashboards/debug pages were removed; CI was cleaned of obsolete variables. This
established a precedent for preferring unified, production-ready API patterns over development-specific
infrastructure.

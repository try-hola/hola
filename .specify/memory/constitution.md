<!--
Sync Impact Report
==================
Version change: (unratified template) → 1.0.0
Bump rationale: First ratification. All template placeholders replaced with
  concrete, project-specific principles derived from CLAUDE.md and the current
  implementation.

Modified principles: N/A (initial adoption)
Added sections:
  - Core Principles (7 principles)
  - Platform Architecture Constraints
  - Development Workflow & Quality Gates
  - Governance
Removed sections: none

Principles defined:
  I.   Traefik-Only Ingress
  II.  Remote Catalog as Single Source of Truth
  III. Async Deploy Lifecycle
  IV.  Real/Mock Service Pairs
  V.   Generic Cross-App Primitives
  VI.  Auth Is Platform-Agnostic and Default-On
  VII. Quality Gates Before Merge

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — "Constitution Check" gate references
       the constitution dynamically; no edit required.
  ✅ .specify/templates/spec-template.md — no constitution-specific slots; aligned.
  ✅ .specify/templates/tasks-template.md — task categories cover testing,
       integration, and quality gates; aligned.
  ✅ .specify/templates/checklist-template.md — generic; aligned.

Follow-up TODOs: none. RATIFICATION_DATE set to the date of first adoption.
-->

# Hola Constitution

Hola is a self-hosted app-deployment platform: a browsable catalog of apps that
install as Docker Compose stacks, orchestrated by a server and routed by Traefik.
This constitution captures the non-negotiable rules that keep that platform
coherent, safe to operate, and consistent across the Bun-workspace monorepo
(`server`, `web`, `shared`, `sdk`, `cli`, `compose`).

## Core Principles

### I. Traefik-Only Ingress

All app traffic MUST enter through Traefik. Apps MUST NOT publish host ports;
reachability is granted only by emitting Traefik file-provider config
(`/data/runtime/traefik/dynamic.yml`) and joining the app's ingress service to
the external `hola` network. Every app image reference MUST be a pinned tag —
never `latest` or a floating tag. The compose validator
(`@hola/shared/compose-validate`) is the enforcement point: it MUST reject host
ports and unpinned images, and that check MUST NOT be bypassed for convenience.

**Rationale:** A single ingress path is what makes `<app>.<HOLA_BASE_DOMAIN>`
routing, TLS, and auth gating uniform and auditable. Host ports and mutable tags
reintroduce drift and unroutable, unreproducible deployments.

### II. Remote Catalog as Single Source of Truth

The catalog is the remote repository at `try-hola/apps` (default
`HOLA_CATALOG_URL`). This repo MUST NOT carry a bundled or built-in catalog, and
MUST NOT fall back to fake/sample apps when the catalog is unset or unreachable —
an unreachable catalog yields an empty catalog. Per-app metadata (including the
`auth` block) MUST come from the OCI bundle `manifest.json`, not from
`catalog.json`. `MockCatalogService` stays empty; tests that need catalog data
MUST inject their own stub.

**Rationale:** One authoritative, versioned source keeps app definitions
reproducible and prevents silently divergent behavior between environments.

### III. Async Deploy Lifecycle

`createFromDraft`, `promote`, and `rollback` MUST only enqueue a job. The actual
`docker compose up` and all per-deploy work — auth provisioning, env injection,
mount materialization — MUST run later in `RealDeploymentService.runLifecycleJob`,
never at create time.

**Rationale:** Deploy work is slow, side-effectful, and failure-prone. Keeping it
in the lifecycle job preserves a clean create/execute boundary, makes deploys
observable and retryable, and keeps request handlers fast and predictable.

### IV. Real/Mock Service Pairs

Every service with external side effects MUST be provided as a Real/Mock pair
registered in `services/simple-factory.ts`: test and dev environments resolve to
Mock, production resolves to Real. New services MUST follow this convention; code
MUST depend on the service interface, not a concrete implementation.

**Rationale:** The Mock pathway is what lets the default test suite run without
Docker, Authentik, or network access, while production stays fully wired. A
missing Mock breaks hermetic testing.

### V. Generic Cross-App Primitives

Cross-app integration MUST be expressed through generic, capability-driven
primitives reconciled by the server at deploy time — never per-app or
format-specific logic. An app declares what it needs in its manifest `consumes`
array (e.g. `app-registry`, `apps-data`), and the server reconciles the primitive
uniformly (see ADR 0002). Privileged primitives MUST default to least privilege:
`apps-data` is a read-only mount and MUST be reserved for trusted catalog apps.

**Rationale:** Per-app special-casing does not scale and becomes a security and
maintenance liability. Generic primitives keep the server small and every app on
equal, auditable footing.

### VI. Auth Is Platform-Agnostic and Default-On

Per-app auth MUST be provisioned at deploy time by `ProvisionerService` through a
platform-agnostic interface covering the manifest `auth` modes: `native-oidc`,
`forward-auth`, and `native-ldap`. Provisioning logic MUST NOT hard-code
Authentik-only assumptions that block an alternate backend. The server MUST
derive a least-privilege scoped token from the admin bootstrap token rather than
using the bootstrap token for ongoing operations. Authentik is the installed
default (`hola init` sets `HOLA_AUTH_MODE=authentik`); `none` is an internal
dev/test mode only, never an install-time choice.

**Rationale:** SSO that auto-provisions per app is a core promise of the product.
A platform-agnostic interface and scoped credentials keep that promise portable
and safe.

### VII. Quality Gates Before Merge

Changes MUST land via a branch and PR targeting `main`; direct pushes to `main`
are prohibited. Before opening a PR, `bun run typecheck`, `bun run lint`,
`bun run test`, and `bun run build` MUST all pass across packages, and typecheck
MUST be re-run after any lint auto-fix. Integration tests (`*.it.ts`) stay
excluded from the default suite and gated on a reachable Docker daemon. Published
package versions MUST be kept in sync (`web` intentionally stays `0.0.0`).

**Rationale:** These gates are the repository's contract for a mergeable change.
CI has caught typecheck regressions the local run missed after lint fixes, so the
re-check is mandatory, not optional.

## Platform Architecture Constraints

- **Monorepo boundaries.** Orchestration logic lives in `server`; the `web` SPA
  is served by nginx on a single origin proxying `/api`. Shared types and the
  compose validator live in `shared`. The `cli` is the only artifact released as
  a binary (`cli-release.yml`, on `cli-v*` tags).
- **App packaging.** App compose and manifests are distributed as OCI bundles
  pulled via `oras`; they are not vendored into this repo.
- **Runtime data.** Server-generated runtime artifacts (Traefik dynamic config,
  `registry.json`, materialized compose) are written under the data root at
  deploy time and are not committed.
- **New capabilities** that cross app boundaries MUST be introduced as ADRs under
  `docs/adr/` before implementation, consistent with Principle V.

## Development Workflow & Quality Gates

- **Branching.** Branch from `main`, open a PR, squash-merge. For stacked work,
  rebase onto `main` after the parent merges (`git rebase --onto`).
- **Commit trailer.** Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **PR trailer.** PR bodies end with:
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **End-to-end verification.** For changes touching the install/deploy path,
  prefer the disposable-VM tooling (`bin/vm-*`, the `vm-e2e` skill,
  `bin/vm-e2e-suite`, `bin/vm-catalog-test`) to validate on a throwaway host
  before merge. Secrets come from `.devcontainer/mcp.env` or host env — never
  hard-coded.

## Governance

This constitution supersedes ad-hoc practice. When guidance here conflicts with a
convenience shortcut, this document wins.

- **Amendments.** Changes to this constitution MUST be made via PR that updates
  this file, bumps the version per the policy below, and updates the Sync Impact
  Report. Principle changes that affect planning MUST propagate to the affected
  `.specify/templates/*` and agent-guidance files in the same PR.
- **Versioning policy.** Semantic versioning of the constitution itself:
  - **MAJOR** — removing or redefining a principle in a backward-incompatible way.
  - **MINOR** — adding a new principle or materially expanding guidance.
  - **PATCH** — clarifications, wording, and non-semantic refinements.
- **Compliance review.** PR review and the `speckit-plan` Constitution Check gate
  MUST verify compliance with these principles. Deviations MUST be justified in
  the plan's Complexity Tracking section or the change MUST be revised to comply.
- **Runtime guidance.** `CLAUDE.md` and the docs it links (`docs/ARCHITECTURE.md`,
  `docs/OPERATIONS.md`, `docs/MCP_VM_TESTING.md`, `docs/adr/`) provide operational
  detail; where they and this constitution diverge on a non-negotiable, this
  constitution governs and the guidance MUST be corrected.

**Version**: 1.0.0 | **Ratified**: 2026-07-06 | **Last Amended**: 2026-07-06

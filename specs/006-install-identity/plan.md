# Implementation Plan: Install Identity — Self-Describing App Data Roots

**Branch**: `006-install-identity` | **Date**: 2026-09-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-install-identity/spec.md`

## Summary

Write two platform-authored JSON records into every app data root on every
materialization: `.hola/instance.json` (`0644`) describing the install, and
`.hola/env.json` (`0600`) carrying its resolved app environment. Nothing reads
them. The point is that a captured data folder stops being anonymous bytes — it
can say which app and install it belongs to, which version wrote it, and which
generated configuration its data was encrypted under.

The technical approach is deliberately small: one private helper on
`RealDeploymentService`, called from inside the existing "does this app have a data
root?" branch in `materializeCompose`, writing through the storage service's
existing atomic write path, wrapped in one warn-and-continue `try/catch`. No new
service, no new dependency, no new abstraction.

**This is a clock, not a backlog item.** A capture taken today carries what the
data root contained today; no later work can retrofit these records into it. That
is the whole argument for shipping it alone, ahead of the restore features that
consume it.

## Technical Context

**Language/Version**: TypeScript on Bun (repo-wide; server runs on Bun's runtime)

**Primary Dependencies**: none added. Uses `StorageService` (existing),
`getHolaVersion()` from `services/core/system-monitoring.ts`, and
`backupParticipations` / `BACKUP_CONTRACT_REF` from `@hola/shared/contracts`.

**Storage**: Two JSON files per install under
`<HOLA_APPS_BIND_ROOT|/srv/hola/apps>/<deploymentId>/.hola/`. No database change,
no schema migration, no change to the platform's own data volume layout.

**Testing**: `bun test` (server). New suite
`packages/server/src/__tests__/deployments/install-markers.test.ts`, on the
real-filesystem harness from `backup-hooks.test.ts` — required, because
`MockStorageService` discards file modes.

**Target Platform**: Linux host running the Hola server container.

**Project Type**: Server-side feature inside a Bun-workspace monorepo. **No web,
CLI, SDK or shared-type change.**

**Performance Goals**: Negligible and bounded — two small file writes plus one
local JSON read per materialization, on a path that already performs five such
reads and several writes. No request-path impact (materialize runs in the
lifecycle job).

**Constraints**: A record write must never fail a deploy (FR-016). A reader must
never see a half-written record (FR-019). Nothing may read the records (FR-018).

**Scale/Scope**: One pair of files per install; tens to low hundreds per host.
`env.json` is bounded by the app's declared `defaultEnv` — kilobytes at most.

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1 design. Re-derived
independently against `.specify/memory/constitution.md` v1.0.0.*

| Principle | Verdict | Reasoning |
| --- | --- | --- |
| **I. Traefik-Only Ingress** | **N/A** | No compose service, no port, no routing change. The feature *reads* `rule.host` from the already-generated routing rule; it never produces routing. The compose validator is untouched. |
| **II. Remote Catalog as SSOT** | **PASS** | FR-007 forbids introducing a manifest field, catalog field, or operator input to populate the record — every value comes from state the platform already holds or from the finalized manifest. No bundled catalog, no fallback data. |
| **III. Async Deploy Lifecycle** | **PASS — and load-bearing** | The write happens in `materializeCompose`, which runs inside `RealDeploymentService.runLifecycleJob`, never at create time. This is not merely compliant: research R1 shows the rollback correctness of FR-006/SC-010 *depends* on the write staying after the data-restore step of the lifecycle job. Compliance here is a correctness requirement, not a formality. |
| **IV. Real/Mock Service Pairs** | **PASS** | No new service is introduced, so no new pair is owed. The feature depends on `StorageService`, which already has its Real/Mock pair registered in `simple-factory.ts`, and consumes it through the interface. *Noted:* `MockStorageService` discards file modes, which constrains testing (research R11) — a gap in the existing double, not a new violation; filed as a follow-up issue. |
| **V. Generic Cross-App Primitives** | **PASS** | One unconditional record written identically for every app. Zero per-app branching, zero app-format awareness — the server writes JSON and never renders any app's config format. Privileged exposure is unchanged: the records are visible through the *existing* `apps-data` read-only mount, and this feature grants nothing new to anyone. |
| **VI. Auth Platform-Agnostic and Default-On** | **N/A** | `ProvisionerService` is untouched. Worth noting the deliberate interaction: provisioned auth env is *excluded* from `env.json`, which keeps the record free of identity-provider coupling and re-provisionable on any future install. |
| **VII. Quality Gates Before Merge** | **PASS** | Branch + PR to `main`, no direct push. Full gate chain (`typecheck → lint → typecheck → test → build`) before the PR. New tests are unit tests in the default suite, not `*.it.ts`, so they need no Docker daemon. No package version change (no published surface changes). |

**Additional constraint from Platform Architecture Constraints:** *"New
capabilities that cross app boundaries MUST be introduced as ADRs."* **Assessed
and not triggered.** This feature introduces no capability and no cross-app
integration — it writes bookkeeping into a directory the platform already owns and
already mounts. No ADR is required. *This is the judgement most worth re-testing
in review*: if implementation ends up needing a contract change, a grant change,
or a reader, that judgement was wrong and the work has drifted into Sequence 5/6.

**Result: no violations. Complexity Tracking is empty.**

## Project Structure

### Documentation (this feature)

```text
specs/006-install-identity/
├── plan.md              # This file
├── spec.md              # 3 user stories, 19 FRs, 10 SCs, 5 clarifications
├── research.md          # R1–R12 decisions
├── data-model.md        # Exact record shapes
├── quickstart.md        # Unit + disposable-VM verification
├── contracts/
│   └── files.md         # The on-disk format — the feature's ONLY external contract
├── checklists/
│   └── requirements.md  # 16/16
└── tasks.md             # Created by /speckit-tasks, not by this command
```

### Source Code (repository root)

```text
packages/server/src/
├── services/core/
│   └── deployment.ts                    # MODIFIED — helper + one call site
└── __tests__/deployments/
    └── install-markers.test.ts          # NEW — the whole test surface
```

**That is the complete list of production files touched: one.**

Deliberately **not** touched, each for a stated reason:

| Not touched | Why |
| --- | --- |
| `packages/shared/src/index.ts` | The record shapes are server-internal. Nothing outside the server reads them, so exporting types would create an API the feature explicitly does not have (FR-018). |
| `packages/shared/src/contracts.ts` | Consumed read-only (`backupParticipations`, `BACKUP_CONTRACT_REF`). The vocabulary is closed and stays closed. |
| `packages/server/src/services/core/storage.ts` | The existing atomic write path already satisfies FR-019 (research R7). Extending the Mock for modes is a follow-up issue, not this change. |
| `packages/web`, `packages/cli`, `packages/sdk` | No surface change (contracts/files.md). |
| `packages/compose`, `docs/adr/` | No capability, no ADR owed. |

**Structure Decision**: Single-file server change plus one new test suite. The
helper lives on `RealDeploymentService` beside `writeOidcCredentialsFile` and the
registry-feed writer — the two existing precedents for writing platform-authored
JSON into an app data root — rather than in a new module, so a reader finds all
three together.

## Design Overview

Implementation order, each step independently reviewable:

1. **Constants and record types** (module-local, not exported): the `.hola`
   directory name, both file names, both schema versions, and the two record
   interfaces. Defined once so nothing greps for an ambiguous string literal
   (research R10 — note `~/.hola` is an unrelated server-side path).
2. **`writeInstanceMarkers(deployment, appRoot, host)`** on
   `RealDeploymentService`: reads the active manifest, builds both records per
   [data-model.md](./data-model.md), writes them via
   `storageService.writeFile(path, content, mode)`. Entire body — manifest read
   included — inside one `try/catch` that warns and returns (research R8).
3. **The FR-014 code comment** on the `env.json` write: the secrets argument, made
   in full, because a future reader will otherwise re-litigate it from scratch.
   Source material is research R9.
4. **One call site**: after `ensureDir(appRoot)` in the `APP_DATA_TOKEN` branch of
   `materializeCompose`, passing `rule.host`.
5. **Tests**: the 13 scenarios in [quickstart.md](./quickstart.md) §2.
6. **Follow-up issues**: the three in research R12, filed with `gh issue create`
   and their numbers recorded in `tasks.md`. No inline TODOs — repository hard rule.

## Risks

| Risk | Mitigation |
| --- | --- |
| **Scope creep into a reader.** The natural instinct while building this is to add "just one" consumer. | FR-018 and SC-008 are testable; quickstart §4 gives the grep that proves it. Carried verbatim into the implement and review agent prompts. |
| **Write site drifts.** A later refactor moves the write earlier "for tidiness" and silently breaks data-aware rollback. | Research R1 states all three reasons; the call site gets a comment naming the rollback ordering, and a test covers it. |
| **Manifest read escapes the try/catch.** The most likely real defect: catching only the writes leaves `readReleaseManifest`'s throw able to fail a deploy. | Research R8 calls it out; quickstart scenario 11 tests it explicitly. |
| **A mode assertion written against the Mock silently passes.** | Research R11; the harness is mandated, and the test asserts via `fs.stat`. |
| **`source` taken from the wrong place.** It is on `deployment.metadata.source`, not top-level — an easy and silent mistake. | Named in research R4 and in the data-model source column. |

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.

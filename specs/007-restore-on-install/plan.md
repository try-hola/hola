# Implementation Plan: Restore-on-Install from a Live Deployment

**Branch**: `007-restore-on-install` | **Date**: 2026-09-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-restore-on-install/spec.md`

**Baseline**: `ca3d3f4` (`main`, post-spec-006 `921c790`). Every anchor cited in
this plan and in [research.md](./research.md) was verified against that tree.

## Summary

During an app install the operator may pick an existing deployment of that app on
the same host as a **restore source**. The server quiesces the source with the
backup contract's existing pre-hooks, captures its data root, and lays that data
down into the new install **after images are pulled and before any container
starts** — the one moment in an app's life when the data root is empty and no
process holds it open.

The design adds no capability contract, no grant, and no contract endpoint. The
server is both reader and writer, as it already is for a data-aware rollback. Its
whole surface is: a field on the draft-create request, a read route for
candidates, a `restore` block apps declare in their manifest, a widened
`composeUp`, one new step in the install wizard, and four CLI flags.

The technical approach is almost entirely **reuse**: `capturePreUpgradeSnapshot`'s
hook-and-tar path, `runPreHooksFailClosed`'s policy, `restoreTarGzInto`,
`mergeUpgradeAppEnv`'s three-case rule, `resolveContainedDir`'s containment,
`checkUpgradePath`'s skew rules, `writeInstanceMarkers`, and `grants`' consent
shape. The genuinely new code is a candidate resolver, a restore sequence inside
the lifecycle job, and `composeUp`'s service-list/wait option.

## Technical Context

**Language/Version**: TypeScript on Bun (server, shared, cli), React + Vite (web).

**Primary Dependencies**: no new runtime dependency. Existing: `docker compose`
CLI, GNU `tar` (via `snapshot-fs.ts`), `oras` (unchanged).

**Storage**: the host filesystem — app data roots under `HOLA_APPS_BIND_ROOT`
(default `/srv/hola/apps`), platform state under the Hola data dir. No database
schema change; the deployment record is a JSON document that gains two optional
fields.

**Testing**: `bun run test`. Server unit tests under
`packages/server/src/__tests__/deployments/`; the mode- and filesystem-sensitive
paths need the **real-filesystem harness** (`RealStorageService` + `mkdtemp` +
`HOLA_APPS_BIND_ROOT`), copied from `install-markers.test.ts:116-142` or
`snapshot.test.ts:99-125`. Web tests with vitest; CLI tests with vitest.
End-to-end verification on a disposable VM (`bin/vm-e2e-suite`, `vm-e2e` skill).

**Target Platform**: Linux host running the Hola stack under Docker Compose.

**Project Type**: monorepo (Bun workspaces) — server + web + shared + cli, with a
sibling change in the `try-hola/apps` catalog repository.

**Performance Goals**: no latency target. The binding constraint is **disk**: a
restore's peak additional cost must be one compressed archive of the source's
data root (SC-013), not three simultaneous copies. See research R7.

**Constraints**:
- The restore must run inside `runLifecycleJob` (Constitution III).
- A failed restore must fail the install; no partial-success start (FR-022).
- The no-restore path must be byte-for-byte unchanged (FR-023).
- `composeUp`'s existing 5-minute timeout is too short for a `--wait` on a
  freshly-`initdb`'d Postgres and must be parameterised (research R12).

**Scale/Scope**: one production package predominantly (`packages/server`), with
smaller changes in `shared`, `web`, `cli`, and a sibling catalog PR. An app data
root may be tens of gigabytes. A host typically has fewer than 30 deployments, so
candidate discovery is a small scan, not a query problem.

## Constitution Check

*Derived independently against `.specify/memory/constitution.md` v1.0.0. Not
pre-assessed by the requester.*

| Principle | Verdict | Reasoning |
|---|---|---|
| **I. Traefik-Only Ingress** | **N/A** | No ingress, routing, port or image-pinning change. A restored install is routed exactly as any install; the compose validator is untouched. |
| **II. Remote Catalog as Single Source of Truth** | **PASS** | The `restore` block is read from the bundle `manifest.json`, never from `catalog.json` — the same place the `backup` block already comes from. No bundled catalog is introduced. `MockCatalogService` stays empty; candidate discovery reads *deployments*, which is host state, not catalog state. |
| **III. Async Deploy Lifecycle** | **PASS — and load-bearing** | The entire restore executes in `runLifecycleJob` (`deployment.ts:3780-3821`), between the cancellation check and `composeUp`. Create-time work is limited to *validation and refusal* — resolving the candidate, judging version skew, checking acknowledgements — which is the same thing `assertProviderAllowed` already does at `createFromDraft` before any state exists. Capturing tens of gigabytes and running `pg_dump` in a live container is precisely the slow, side-effectful work this principle keeps out of request handlers. |
| **IV. Real/Mock Service Pairs** | **PASS, with an explicit constraint** | No new service is introduced; the feature extends `DeploymentService`, `DockerService` and `DraftService`, all of which already have Real/Mock pairs in `simple-factory.ts`. **The constraint that must not be missed**: `composeUp`'s widened signature has to land in all three of the interface (`docker.ts:67`), the Real implementation (`:231-269`) **and** `MockDockerService` (`:722-725`). A Mock that accepts but ignores `services` would let every test pass while the real path starts the wrong containers. See *Known trap* below. |
| **V. Generic Cross-App Primitives** | **PASS — checked hard, see below** | |
| **VI. Auth Is Platform-Agnostic and Default-On** | **PASS — and protected** | The only auth-adjacent change is moving `writeOidcCredentialsFile` to after the restore (R10). Nothing Authentik-specific is added and `ProvisionerService`'s interface is untouched. The move *defends* this principle: leaving the write where it is means a restored install silently boots with SSO disabled, which is a default-on violation in practice even though no code says so. |
| **VII. Quality Gates Before Merge** | **PASS** | Branch + PR to `main`, no direct push. Full gate before the PR: `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build` (typecheck twice, per the CLAUDE.md note about lint auto-fixes). Integration tests stay excluded from the default suite. Package versions stay in sync. |

### Principle V, checked explicitly

This is the principle most at risk in a feature about restoring *specific kinds of
datastore*, so it gets its own audit rather than a one-line verdict. The test is:
**does the server ever branch on which app it is restoring?**

| Mechanism | App-specific knowledge lives… | Server behaviour |
|---|---|---|
| Which paths to discard | in the app's manifest `restore.discard` | Resolve each through `resolveContainedDir`, delete. Identical for every app. |
| How to reload the payload | in the app's manifest `restore.hook` (`{service, command}`) | Run the command in the named service. Identical for every app. |
| When the hook service is ready | in the app's own compose `healthcheck` | `docker compose up -d --wait <svc>`. Identical for every app. |
| Whether configuration is mandatory | in the app's manifest `restore.requiresEnv` | Refuse or warn. Identical for every app. |
| Which env keys to warn about | **derived**: `isSecret && generate` | Computed from `AppEnvVar`, not declared. No app can get it wrong. |

There is no app name, image name, or datastore name anywhere in the server's
restore path. "Postgres needs its `PGDATA` discarded" is a sentence the *catalog*
says, five times, once per app that means it — never a sentence the server knows.

The deliberate design pressure here is R12's rejection of a bespoke readiness
poll: knowing that "ready" means `pg_isready` for one app and something else for
another is exactly the per-app branching this principle forbids, so the feature
consumes the app's declared healthcheck instead.

### Complexity Tracking

**Empty — no violations to justify.** Recorded explicitly rather than omitted, so
a reader knows the gate was evaluated and not skipped. The two places this
feature could plausibly have earned an entry, and did not:

- **A new service for restore orchestration** — not created. The work lives on
  `RealDeploymentService` beside the snapshot machinery it reuses, which keeps one
  owner for the app data root rather than two.
- **A second hook format for restore** — not created. `AppBackupHook` is reused
  verbatim (R18), so the catalog schema references an existing `$defs/backupHook`.

## Project Structure

### Documentation (this feature)

```text
specs/007-restore-on-install/
├── plan.md              # This file
├── spec.md              # 53 FRs, 13 SCs, 5 clarifications
├── research.md          # R1–R23: decisions, rationale, and four prompt corrections
├── data-model.md        # Every record and request shape, field by field
├── quickstart.md        # Numbered, individually-citable verification scenarios
├── contracts/
│   ├── api.md           # Candidates read route + draft/deployment request additions
│   ├── manifest.md      # The app-side `restore` block and its JSON-schema shape
│   └── cli.md           # The four flags and the acknowledgement flag
├── checklists/
│   └── requirements.md  # 16/16
└── tasks.md             # Phase 2 output — NOT created by /speckit-plan
```

### Source code

```text
packages/shared/src/
├── index.ts                     # RestoreChoice, RestoreCandidate, acknowledgement
│                                #   codes, AppRestoreDeclaration; additions to
│                                #   CreateDraftRequest, Draft, EnhancedDeploymentDetail
└── contracts.ts                 # UNCHANGED — CONTRACTS gains no entry (FR-047)

packages/server/src/
├── services/core/
│   ├── deployment.ts            # The bulk: candidate resolution, the restore
│   │                            #   sequence in runLifecycleJob, lineageId on the
│   │                            #   record, the writeOidcCredentialsFile move
│   ├── draft.ts                 # restoreFrom on createDraft (catalog path);
│   │                            #   refuse it on the install-by-ref path;
│   │                            #   carry it onto the finalized manifest
│   ├── docker.ts                # composeUp: { services?, wait?, timeoutMs? }
│   │                            #   in the interface, Real AND Mock
│   ├── restore-candidates.ts    # NEW: candidate discovery + eligibility + skew
│   ├── upgrade-env.ts           # UNCHANGED — mergeUpgradeAppEnv reused as-is
│   ├── snapshot-fs.ts           # UNCHANGED — tarGzipDir / restoreTarGzInto reused
│   └── path-containment.ts      # UNCHANGED — resolveContainedDir reused
├── server.ts                    # The candidates read route
└── __tests__/deployments/
    └── restore-on-install.test.ts  # NEW — real-filesystem harness

packages/web/src/pages/
└── InstallWizard.tsx            # Restore step at index 0; re-create draft on change;
                                 #   acknowledgement checkboxes; summary warning

packages/cli/src/
├── index.ts                     # Flag registration
├── commands/install/install.ts  # Parsing, mirroring parseGrants
└── lib/deploy-flow.ts           # details-driven hints for restore refusals

try-hola/apps  (sibling PR, separate repo)
├── schemas/manifest.schema.json # The `restore` block, referencing $defs/backupHook
└── src/{guacamole,immich,mealie,paperless-ngx,postiz}/src/manifest.json
```

**Structure Decision**: the existing monorepo layout is used unchanged. One new
server module (`restore-candidates.ts`) is added rather than growing
`deployment.ts` further — candidate discovery is a pure, testable function of
(app id, deployments, identity records, catalog upgrade metadata) with no I/O
ordering concerns, and `deployment.ts` is already past 4,300 lines. The restore
*execution* stays in `deployment.ts` because it is inseparable from the lifecycle
job's ordering.

## Design overview

The implementation decomposes into six groups, in dependency order.

**1 — Shared types.** `RestoreChoice`, `RestoreCandidate`, the acknowledgement
code union, and `AppRestoreDeclaration`; `restoreFrom` on `CreateDraftRequest`,
`Draft` and `FinalizedManifest`; `lineageId` + `restoreFrom` + `restoredAt` on
`EnhancedDeploymentDetail`. No change to `contracts.ts`.

**2 — Candidate discovery** (`restore-candidates.ts`, new). Given an app id, list
eligible deployments (settled state, data root non-empty ignoring `.hola`),
describe each from its identity record with the deployment record as fallback,
group by lineage newest-first, and compute per-candidate skew verdicts and
required acknowledgement codes. Pure enough to unit-test without a filesystem for
the ranking and skew logic.

**3 — Draft entry.** `createDraft` accepts `restoreFrom` on the catalog path,
reads the candidate's environment record from the apps-root sibling directory,
seeds `appEnv` via `mergeUpgradeAppEnv`, and defaults name/subdomain from the
candidate. The install-by-ref path refuses `restoreFrom`. `finalizeDraft` carries
it outside `canonicalSpec`, alongside `channel`.

**4 — Persistence.** `createFromDraft` validates the choice again (the candidate
may have changed since draft creation), enforces acknowledgement codes the way
`grants` are enforced, and persists `restoreFrom` and `lineageId` onto the record.
`writeInstanceMarkers`' `lineageId` expression becomes
`deployment.lineageId ?? deployment.id`.

**5 — Restore execution** (`runLifecycleJob`). The ten-step sequence in R8,
inserted between `:3813` and `:3815`, guarded so that an install with no restore
choice — or one whose restore has already been consumed — takes today's path
exactly. Requires `composeUp`'s widened signature.

**6 — Surfaces.** The candidates read route; the wizard step; the CLI flags; the
catalog sibling PR; the four follow-up issues from R23.

### Known trap, carried into tasks

`MockDockerService.composeUp` (`docker.ts:722-725`) currently logs and returns
success. When its signature widens it must **record** the requested services and
wait flag so tests can assert on them. A Mock that accepts the new options and
ignores them produces a green suite over a broken restore — the single most
likely way this feature ships subtly wrong, and the reason Constitution IV exists.

## Phase status

- **Phase 0 — Research**: complete → [research.md](./research.md) (R1–R23, including
  four corrections to the prompt of record: the job payload's shape, the absent
  `CreateDeploymentRequest` type, the root-relative archive that voids the
  "locate the subtree" trap, and `checkUpgradePath`'s inability to express two of
  the four skew rules).
- **Phase 1 — Design & contracts**: complete → [data-model.md](./data-model.md),
  [contracts/](./contracts/), [quickstart.md](./quickstart.md); `CLAUDE.md` plan
  pointer updated.
- **Phase 2 — Tasks**: not started. `/speckit-tasks` produces `tasks.md`.

### Post-design Constitution re-check

Re-evaluated after the design artifacts were written. **No verdict changed.** The
design added one new server module and one new API route, neither of which touches
a principle: the module is internal and Real/Mock-neutral (a pure function over
already-fetched state), and the route is an ordinary authenticated platform read,
not a contract endpoint. Principle V's audit was performed *against the finished
`restore` block shape* in `contracts/manifest.md`, not against an intention, and
the block contains no server-interpreted app identity.

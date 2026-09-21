# Implementation Plan: restore@1 — the provider half

**Branch**: `008-restore-provider` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-restore-provider/spec.md` (76 FRs, 17 SCs, 5 clarifications)

## Summary

Spec 007 shipped restore-on-install with exactly one possible source: a live sibling deployment on this host.
This feature adds a second source — a backup provider holding captures of apps that may no longer exist here —
which is what makes the platform's recovery story real rather than a clone button.

The technical shape is forced by two facts established by a read-only sweep of `main@03290b8`
(`anchors-008.md`, `seams-008.md`):

1. **Spec 007's restore sequence has one narrow substitution point, not a clean whole-function seam.** From
   the payload post-condition check (`dirHasContents(targetAppRoot, …)`, `deployment.ts:4080`) onward — discard,
   marker rewrite, credential placement, service-scoped start, fail-closed reload hook — every step runs
   unchanged for any payload already landed in `targetAppRoot`. Landing it there — step 4, local's
   `restoreTarGzInto(stagingPath, targetAppRoot)` at `:4073` — is itself origin-specific, not shared: a provider
   delivers an already-extracted tree that must be *located and moved* (R9), not a tar.gz sitting at
   `stagingPath` to extract, so step 4 has two real implementations, not one reused unchanged (data-model.md
   §8). Everything *upstream of step 4* (`:3953-4053`) is bound to a local deployment and cannot be reused
   either: `getRestoreSource` (`:838-843`) is an in-memory registry lookup, `CandidateSource.deployment` is a
   non-optional `EnhancedDeploymentDetail`, the quiesce hooks run `docker compose exec` against the source's own
   containers, and the capture derives its path from `appRootFor(sourceDeployment.id)`. So this feature splits
   `performRestoreOnInstall` into **acquisition** (steps 1–4, origin-specific, two implementations) and
   **application** (steps 5–10, origin-agnostic, one implementation, unchanged). That is exactly what FR-042
   requires and it is cheaper than it looks — but only because the split falls in the right place, which had to
   be verified rather than assumed.
2. **Promoting `restore@1` is not a table row.** The spec-007 carve-out in `coerceRefs`
   (`services/core/contracts.ts:45-48`) resolves the ref *before* the contract table is consulted, so a
   `CONTRACTS` entry added without deleting the carve-out is dead code that compiles, passes, and does nothing.
   This is the identical failure mode that made spec 007 ship inert.

Everything else follows the platform's existing shapes: the request queue mirrors `BackupBrokerStateStore`'s
persistence pattern (keyed per request rather than one-per-host), the four provider endpoints mirror the
`backup@1` broker's route/capability/service layering, and provider candidates reuse `groupIntoLineages`
untouched.

## Technical Context

**Language/Version**: TypeScript on Bun (server, shared, cli), React + Vite (web). Node-free toolchain.

**Primary Dependencies**: no new runtime dependencies. Reuses `oras` (catalog bundles), Docker Compose,
Traefik, and the existing contract-token machinery.

**Storage**: JSON records under the server's own data root via `StorageService` — `config/restore-broker.json`
(request queue) and `config/restore-index.json` (published index), both following
`config/backup-broker.json`'s read-modify-write pattern. No database.

**Testing**: `bun run test` (server `bun test`, web/cli `vitest`). Mode-sensitive and container-sensitive
scenarios use the real-filesystem harness spec 007 established, because `MockStorageService` discards file
modes (#475) and `MockDockerService` starts no containers.

**Target Platform**: self-hosted Linux host running the Hola compose stack.

**Project Type**: monorepo web service — `packages/{server,web,shared,sdk,cli,compose}` plus a sibling catalog
repo (`try-hola/apps`, prepared-not-submitted).

**Performance Goals**: not latency-bound. The one timing constraint that matters is the bounded wait on a
provider: default 30 minutes (FR-031c), chosen against a repository restore of a large app data root.

**Constraints**: no server→app calls; no captured bytes through the server's API; the provider never chooses a
destination; a failed or expired restore fails the install without starting the app.

**Scale/Scope**: one provider per host; tens of apps; captures numbering in the hundreds for a long-lived
repository. The index is metadata only and is read on candidate listing, not on every request.

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v1.0.0 before Phase 0 and re-checked after Phase 1.*

| Principle | Verdict | Basis |
|---|---|---|
| **I. Traefik-Only Ingress** | **PASS** | No ingress change. The provider's endpoints are on the existing server API; no app gains a host port; the compose validator is untouched. |
| **II. Remote Catalog as Single Source of Truth** | **PASS** | No catalog is vendored. The provider's bundle change is prepared as a diff for the owner to submit (FR-063). The server reads `provides`/`accepts`/`restore` from the bundle manifest as it already does. |
| **III. Async Deploy Lifecycle** | **PASS, load-bearing** | The restore request is created *and awaited inside* `runLifecycleJob`, never at `createFromDraft`. Draft creation and `createFromDraft` only validate the choice, exactly as spec 007 does. A request created at create time would make an install's side effects begin before its job — the precise thing III forbids. |
| **IV. Real/Mock Service Pairs** | **PASS** | The new stores are plain classes over `StorageService` (itself a Real/Mock pair), following `BackupBrokerStateStore`'s precedent rather than inventing a fifth service. No new service with external side effects is introduced. `MockDockerService` needs no change: the provider path starts no extra containers beyond the hook services spec 007 already parameterised. |
| **V. Generic Cross-App Primitives** | **PASS, with an ADR — the principle most at risk** | See the audit below. |
| **VI. Auth Is Platform-Agnostic and Default-On** | **PASS** | No provisioner change. Contract-scoped tokens are minted by existing generic machinery (`contractCapability` keys off `CONTRACTS` alone). |
| **VII. Quality Gates Before Merge** | **PASS** | Branch + PR to `main`; full gate `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build`; integration tests stay out of the default suite. |

### Principle V audit — done hard, because this is where the feature could go wrong

Principle V says cross-app integration must be generic and capability-driven, and that *"privileged primitives
MUST default to least privilege: `apps-data` is a read-only mount."* This feature introduces the platform's
first **writable** mount granted to an app. That is a genuine widening and it is treated as one.

| Question | Answer | Evidence |
|---|---|---|
| Is any server code branching on which app is the provider? | **No.** The provider is whichever install declares `provides: ["restore@1"]` and holds consent. No app id, image name or slug appears in server code. | Enforced by a scope-boundary grep in quickstart §9, mirroring spec 007's. |
| Is any server code branching on which app is being restored? | **No.** The `restore` block is app-declared data interpreted uniformly, unchanged from spec 007. | `restore-candidates.ts`'s existing "never branches on which app" property is preserved. |
| Does the write privilege default to least? | **Yes.** One platform-owned scratch directory, sibling to the apps root. Not any app's data root, not the apps root, not the Docker socket. | FR-010, FR-011, FR-012. |
| Can it be acquired without consent? | **No — and this is the reason for a sibling contract rather than a `backup@1` grant.** Consent is recorded per contract ref (`grantedContracts`), while a grant's *kind* is resolved live from `CONTRACTS`. Attaching a write kind to `backup@1` would widen every already-consented provider on its next materialisation with no consent event. A new ref cannot: the app must newly declare it and the operator must newly consent. | FR-014, FR-015, SC-003. Verified in `anchors-008.md` item 2. |
| Does the constitution require anything else? | **Yes — an ADR.** *"New capabilities that cross app boundaries MUST be introduced as ADRs under `docs/adr/`."* | ADR 0006 is in scope (FR-018). |

**Verdict: compliant, conditional on ADR 0006 landing in this change.** Recorded in Complexity Tracking below
because it is the one place the platform's privilege surface grows.

## Design overview

Ten groups. Groups 1–2 are the spine everything else depends on.

**1 — Contract promotion, and the retirement of the marker.**
`CONTRACTS` gains `restore@1` (`brokered`, `providerKind: 'app'`, `participation: 'declared'`,
`acceptorBlock: 'restore'`, `providerGrant: { kind: 'restore-staging', … }`). `PARTICIPATION_MARKERS`,
`RESTORE_PARTICIPATION_REF`, `isParticipationMarker` and the `coerceRefs` carve-out are **deleted in the same
change**. A regression test must fail if the carve-out survives (FR-003) — without it, this feature ships
inert exactly as spec 007 did. `draft.ts`'s raw `accepts.includes('restore@1')` (`:397-402`) keeps working but
is routed through the same vocabulary as every other contract.

**2 — The staging root and its mount.**
A new `ProviderGrantKind` `'restore-staging'`; a new injector in `compose-mounts.ts` alongside
`injectReadonlyMount` (which hardcodes `:ro` and cannot be parameterised into this); a
`restoreStagingRoot()` accessor reading `HOLA_RESTORE_STAGING_ROOT` with default `/srv/hola/restore`,
following `appsBindRoot()`'s exact pattern including the externally-provisioned assumption — the server reads
and uses the path, it does not create it. Naming: the provider-facing directory is the **restore staging
root**; spec 007's per-deployment tar directory is renamed to **capture staging** so the two are never
confused (FR-019).

**3 — The request queue.**
New `restore-broker-state.ts` modelled on `backup-broker-state.ts` — same persistence, same expiry shape
(`isPrepareExpired`'s "unparseable timestamp reads as expired" fail-closed rule included) — but keyed by
request id, because the backup store's defining property (one open operation per host) does not hold here.
Four routes under `/api/contracts/restore/`, each with its own capability-map row in `middleware/auth.ts`
(a contract principal is deny-by-default even for reads — the `backup@1` precedent needed two rows for two
routes, so four routes need their own, FR-032).

**4 — The index.**
`config/restore-index.json`, keyed by publishing provider deployment id, replaced wholesale on publish
(FR-024), discarded when that provider is removed or its consent revoked (FR-025a).

**5 — Candidates gain an origin.**
`RestoreCandidate` gains `source` and `confidence` and its identifier becomes origin-independent — today
`deploymentId` *is* the candidate id and is copied straight into `defaultCandidateId`
(`restore-candidates.ts:147`). This is the feature's widest blast radius: **12+ non-test call sites**, and one
of them is a user-facing CLI contract (`--restore-from <id>`, and `--restore-list` printing `Default: <id>`).
`groupIntoLineages` itself needs no change.

**6 — Acquisition vs application.**
`performRestoreOnInstall` splits. Application (step 5 onward, the post-condition check at `:4080`) is shared
verbatim. Acquisition (steps 1–4) is origin-specific: the local path keeps steps 1–4 unchanged, including
`restoreTarGzInto` at `:4073`; the provider path creates a request, waits on the persisted record, and then
must **locate the app data root within the delivered tree** (FR-041) and rename-or-copy it into `targetAppRoot`
— step 4's provider-side implementation — because a repository tool reproduces absolute paths, which is
precisely the trap spec 007's step-5 comment names and defers, and which issue #486 tracks.

**7 — Restore coverage.** `judgeRestoreCoverage` beside `judgeBackupCoverage`, with its own state vocabulary
(FR-053a) — the capture vocabulary describes being read consistently, which says nothing about being put back.

**8 — Retiring the fabricated surface (#484).** Delete the stub route, its request/response types, and the UI
affordance that calls it.

**9 — ADR 0006**, documenting the writable-mount primitive.

**10 — Catalog preparation, stopping before any PR** (FR-063).

## Known trap

`MockDockerService` records `composeUp` calls including `services`/`wait` (spec 007's fix). Any new mock
interaction this feature adds must be **recorded and asserted**, not merely accepted — a mock that silently
swallows an argument makes every test using it pass while production diverges. Spec 007's plan carried this
warning and the review found a real instance of it.

The second trap is larger and has already bitten this codebase once: **a change that is invisible to the unit
suite because the suite never traverses the path that breaks.** Spec 007's inert `restore@1` passed 1,133
tests, an adversarial review and full CI, because every test built manifests directly and none went through
catalog coercion. FR-003 exists to make that specific failure loud; the VM scenarios in quickstart exist to
catch the class.

## Project Structure

### Documentation (this feature)

```text
specs/008-restore-provider/
├── spec.md              # 76 FRs, 17 SCs, 5 clarifications
├── prompt.md            # prompt of record (Notion Sequence 6)
├── plan.md              # this file
├── research.md          # Phase 0 decisions R1..Rn
├── data-model.md        # Phase 1 entity + field definitions
├── quickstart.md        # Phase 1 numbered verification scenarios
├── contracts/           # Phase 1 external surface
│   ├── api.md           # provider endpoints + candidate additions
│   ├── manifest.md      # the provider declaration + the restore block
│   └── grant.md         # the staging grant and its consent
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/shared/src/
├── contracts.ts                     # CONTRACTS entry; delete marker machinery; judgeRestoreCoverage
└── index.ts                         # candidate/source/confidence types, request + index types, API constants

packages/server/src/
├── server.ts                        # 4 provider routes; candidates route gains provider entries
├── middleware/auth.ts               # capability rows, one per provider route
└── services/core/
    ├── contracts.ts                 # DELETE the coerceRefs carve-out
    ├── compose-mounts.ts            # writable staging injector
    ├── restore-broker-state.ts      # NEW — request queue store
    ├── restore-index.ts             # NEW — published index store
    ├── restore-candidates.ts        # origin-independent id, source, confidence
    ├── draft.ts                     # validate a provider-sourced choice
    └── deployment.ts                # acquisition/application split; staging root; grant injection

packages/web/src/pages/InstallWizard.tsx     # candidate id + origin/confidence surfacing
packages/cli/src/                            # --restore-from id format, --restore-list output
docs/adr/0006-*.md                           # NEW — the writable-mount primitive
```

**Structure Decision**: existing monorepo layout, no new package. Two new server modules, both under
`services/core/`, both plain classes over `StorageService` following `backup-broker-state.ts`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **A writable bind mount granted to an app** — the first on this platform, widening Principle V's least-privilege default | A provider cannot deliver captured bytes without writing them somewhere, and the one direction the architecture permits is the provider writing where the platform tells it to | *Streaming the capture through the server's API* was rejected: it puts every restored byte through the platform, contradicts FR-022/SC-002, and makes the server a bottleneck and a memory risk for multi-gigabyte data roots. *Granting write on the app's own data root* was rejected as strictly more privilege for no gain. *Reusing `apps-data`* was rejected because it would silently widen every already-consented provider (FR-015). Mitigated by: one scratch directory, sibling to the apps root, per-ref consent, and ADR 0006. |
| **Splitting `performRestoreOnInstall`** rather than keeping one linear sequence | The two origins genuinely differ in acquisition and genuinely agree in application; pretending otherwise means either a second full sequence (forbidden by FR-042) or local-deployment assumptions leaking into the provider path | *One sequence with conditionals threaded through all ten steps* was rejected: steps 1–3 have no meaningful provider behaviour, so the conditionals would be `if (local)` guards around three quarters of the function. |

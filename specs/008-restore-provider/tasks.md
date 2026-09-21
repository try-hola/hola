---

description: "Task list for spec 008 — restore@1: the provider half"
---

# Tasks: restore@1 — the provider half

**Input**: Design documents from `/specs/008-restore-provider/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/api.md](./contracts/api.md), [contracts/manifest.md](./contracts/manifest.md), [contracts/grant.md](./contracts/grant.md), [quickstart.md](./quickstart.md)

**Tests**: Included. The spec's 76 FRs demand test-backed verification and `quickstart.md`
supplies 76 numbered scenarios; test task descriptions cite those numbers so a reviewer can
check coverage mechanically. **Mode is load-bearing** — `U-fs` scenarios MUST use the real-
filesystem harness (`RealStorageService` + `mkdtemp` + `HOLA_APPS_BIND_ROOT` +
`HOLA_RESTORE_STAGING_ROOT`, copied from `restore-on-install.test.ts:398-441`), because
`MockStorageService` discards file modes (#475) and `MockDockerService` starts no containers.
The one `VM` scenario (41) is consolidated into a single manual task, **not** part of the
default suite.

**Closes**: `try-hola/hola#486`, `try-hola/hola#484` — both MUST appear in the commit message
and the PR body (`Closes #486`, `Closes #484`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `[US1]`–`[US5]`, matching spec.md's user stories
- Every task names an exact file path

## Line numbers

**Use `research.md`, `data-model.md` and the verified sweeps (`anchors-008.md`,
`seams-008.md`), never the original prompt's line numbers** — they predate spec 007's merge
and several are wrong in shape, not just position (e.g. the prompt's `metrics.ts:236` claim
is backwards; the prompt's route name `/api/restore/candidates` does not exist). The key ones,
all verified against `main@03290b8` (this branch's base):

| Thing | Line |
|---|---|
| `CONTRACTS` array / marker block | `shared/src/contracts.ts:146-199` (4 entries) / `:218-252` |
| `PARTICIPATION_MARKERS` / `RESTORE_PARTICIPATION_REF` / `isParticipationMarker` | `shared/src/contracts.ts:241` / `:244` / `:250-252` |
| `coerceRefs` carve-out | `server/src/services/core/contracts.ts:45-48` |
| `ProviderGrantKind` union | `shared/src/contracts.ts:99` |
| `providerGrantsFor` / `missingGrantConsents` / `grantsInclude` | `shared/src/contracts.ts:282-290` / `:299-302` / `:305-307` |
| `injectReadonlyMount` (precedent, hardcoded `:ro`) | `server/src/services/core/compose-mounts.ts:152-168` |
| `materializeCompose` grant branches / `granted` read | `deployment.ts:2073-2103` / `:2061` |
| `appsBindRoot()` precedent (default + accessor) | `deployment.ts:138-139` / `:2635-2636` |
| `assertProviderAllowed` (override / call site) | `deployment.ts:4534` (doc `:4530-4532`) / `:1103` |
| `contractCapability` | `server/src/services/auth/contract-tokens.ts:49-53` |
| `mintContractEnv` | `deployment.ts:2222-2237` |
| `backup@1` capability rows (precedent — 2 rows for 2 routes) | `middleware/auth.ts:151-152` |
| `backup@1` broker routes (precedent) | `server.ts:1674` / `:1683` / `:1695-1700` |
| `BackupBrokerStateStore` read/write/update | `server/src/services/core/backup-broker-state.ts:99-127` |
| `brokerActivity()` Real override (hardcoded to 1 key) | `deployment.ts:3038-3052` |
| `expireOpenPrepareIfStale` (dual-guard precedent) | `deployment.ts:3092-3116`, called at `:2969` and `:3075` |
| `restore-candidates.ts`: `describeCandidate` / `groupIntoLineages` / `checkCandidateStillEligible` | `:95-112` / `:128-150` (`defaultCandidateId` at `:147`) / `:288-297` |
| `RestoreCandidate` / `ListRestoreCandidatesResponse` / `RestoreChoice` / `RestoreAcknowledgementCode` | `shared/src/index.ts:449-464` / `:472-479` / `:378-385` (`candidateId` `:380`) / `:392` |
| `draft.ts` `resolveRestoreChoice` (accepts check / `getRestoreSource` / `judgeRestoreChoice` / carryEnv) | `:373-430` (`:397-402` / `:404` / `:408-421` / `:423-429`) |
| `createFromDraft` re-validation | `deployment.ts:1055-1077` |
| `getRestoreSource` | `deployment.ts:838-843` |
| `performRestoreOnInstall` (JSDoc / body / call site / gate) | `deployment.ts:3924-3952` / `:3953-4187` / `:4328` / `:4299` |
| capture staging (spec 007, rename target) | `deployment.ts:4038-4039` (paths) / `:4048-4049` (tar) / `:4181-4186` (cleanup) |
| `restoreTarGzInto` — local's step-4 landing call, NOT where application begins | `deployment.ts:4073` |
| post-condition payload check (application begins here, step 5) | `deployment.ts:4080-4085` |
| candidates route | `server.ts:523-572` |
| dead `#484` stub (handler / imports / capability row / types / path builder / `JobType`) | `server.ts:1722-1727` / `:29-30` / `middleware/auth.ts:157` / `shared/src/index.ts:1890-1891` / `:109` / `:731` (KEEP) |
| dead `#484` web call sites | `useBackupsApi.ts:9,107-116` / `sdk-adapter.ts:33,600-602` / `Backups.tsx:44,68` |
| web candidateId sites | `InstallWizard.tsx:406,671,845,864,1390-1414` |
| CLI candidate-id sites | `install.ts:167,196-198,201,322` / `deploy-flow.ts:153` |
| `BackupCoverageState` / `judgeBackupCoverage` | `shared/src/index.ts:2316` / `shared/src/contracts.ts:475-498` |
| `readDeploymentContracts` override / coverage computation | `deployment.ts:2249-2295` / `:2277-2286` |
| `buildContractRollup` acceptor-push branch | `services/core/contracts.ts:~184-194` |
| spec 007 real-fs harness / vacuous guard test to replace | `restore-on-install.test.ts:398-441` / `:286-297` |

---

## Phase 1: Setup

**Purpose**: There is no project initialization to do. One confirmation task only.

- [X] T001 Confirm the working branch is `008-restore-provider` off `main` (`03290b8` or later) and the tree is clean, via `git rev-parse --abbrev-ref HEAD && git status --porcelain`. Tree carried the expected speckit-pipeline artifacts only (`.specify/feature.json`, `CLAUDE.md`'s managed plan pointer) — confirmed benign.

---

## Phase 2: Foundational (BLOCKING — no user story can start until this is done)

**Purpose**: The shared spine every story rides on: `restore@1` becomes a real brokered
contract, the marker mechanism that stood in for it is gone, and the new grant kind and
request/index stores exist in skeleton form.

> **Read this before starting Phase 3.** US1, US2 and US3 all depend on this phase's spine —
> the `CONTRACTS` entry, the deleted carve-out, `ProviderGrantKind`, the two new stores, the
> staging-root accessor. They are separate user stories because they fail separately and
> deliver value separately, but there is **exactly one** `performRestoreOnInstall` split into
> acquisition (steps 1-4, origin-specific — this includes landing the payload in `targetAppRoot`,
> which differs by origin) and application (steps 5-10, origin-agnostic, unchanged from spec 007,
> beginning at the post-condition check, `deployment.ts:4080`) — never a second restore sequence
> (FR-042, research R8). An implementer who builds a parallel path for the provider origin has
> misread this, and so has one who treats `restoreTarGzInto` (`:4073`, local's step-4 landing
> call) as shared application code — it is not; the provider's step 4 is locate-then-move, not a
> tar extraction.

- [X] T002 Add a `restore@1` entry to `CONTRACTS` in `packages/shared/src/contracts.ts` (after the `container-logs` entry, ~line 193): `id: 'restore'`, `version: 1`, `shape: 'brokered'`, `providerKind: 'app'`, `participation: 'declared'`, `acceptorBlock: 'restore'`, `providerGrant: { kind: 'restore-staging', label, risk }` (copy verbatim from contracts/grant.md §3), `summary` per data-model.md §1. Add a `RESTORE_CONTRACT_REF = 'restore@1'` constant beside the existing `BACKUP_CONTRACT_REF`/`CONTAINER_LOGS_CONTRACT_REF`. FR-001, FR-010, FR-016.
- [X] T003 Delete `PARTICIPATION_MARKERS`, `RESTORE_PARTICIPATION_REF`, `isParticipationMarker` and their doc comment (`shared/src/contracts.ts:218-252`) — depends on T002 so `restore@1` resolves through the real table the moment the marker mechanism is gone. FR-002.
- [X] T004 Delete the `coerceRefs` carve-out — `if (role === 'accepts' && isParticipationMarker(ref)) { … continue; }` — in `packages/server/src/services/core/contracts.ts:45-48` (depends on T002, T003; must land in the **same change** as T002 per FR-003). FR-002, FR-003.
- [X] T005 [P] Add `'restore-staging'` to the `ProviderGrantKind` union in `packages/shared/src/contracts.ts:99`. FR-010.
- [X] T006 [P] Add `DEFAULT_RESTORE_STAGING_ROOT = '/srv/hola/restore'` and a private `restoreStagingRoot()` accessor to `RealDeploymentService` in `packages/server/src/services/core/deployment.ts`, mirroring `appsBindRoot()` exactly (`:138-139` default pattern, `:2635-2636` accessor pattern): `HOLA_RESTORE_STAGING_ROOT` env override, trailing slashes trimmed, **no** `mkdir`/`ensureDir` call anywhere. FR-011, FR-012, FR-013, FR-020 (R6).
- [X] T007 [P] Add `RestoreCaptureIdentity`, `RestoreIndexEntry`, `RestoreRequestStatus`, `RestoreRequestForProvider`, `PublishRestoreIndexRequest`, `CompleteRestoreRequestRequest` types and the four new `API.contracts.restore*` path constants to `packages/shared/src/index.ts`, per data-model.md §3a-§3b, §4a, §4c and contracts/api.md §1-§4, §7. FR-022, FR-023, FR-026, FR-029, FR-048.
- [X] T008 [P] Widen `RestoreAcknowledgementCode` (`packages/shared/src/index.ts:392`) from `'restore-version-unknown' | 'restore-env-not-carried'` to add `'restore-inferred-identity'`. FR-051.
- [X] T009 Create `packages/server/src/services/core/restore-broker-state.ts` — a `RestoreRequestRecord` interface (data-model.md §4a) and a persisted store over `config/restore-broker.json`, **keyed by request id** (not one-per-host — the `BackupBrokerStateStore` property this store's shape does *not* inherit, R10), modelled on `backup-broker-state.ts`'s read/write/update (fail-open read to `{}`, warn-only write failure). Add `DEFAULT_RESTORE_REQUEST_TIMEOUT_MS = 30 * 60 * 1000`, `restoreRequestTimeoutMs()` (env `HOLA_RESTORE_REQUEST_TIMEOUT_MS` override, following `prepareTimeoutMs()`'s exact fallback), and `isRestoreRequestExpired(record)` mirroring `isPrepareExpired`'s fail-closed "unparseable timestamp reads as expired" rule. Per data-model.md §4a-§4b (R10, R11, R12). FR-030, FR-031, FR-031a, FR-031c.
- [X] T010 Create `packages/server/src/services/core/restore-index.ts` — a `RestoreIndexStore` persisted store over `config/restore-index.json`, keyed by publishing provider deployment id, with a `publish(providerDeploymentId, entries)` that **replaces** `store[providerDeploymentId]` wholesale (never merges, FR-024) and a `discard(providerDeploymentId)` for uninstall/revoke cleanup, modelled on the same read/write/update pattern as T009. Per data-model.md §3c (R13).

### Tests (Foundational)

- [X] T011 [P] Test for quickstart **scenario 1** — ★ **HIGHEST VALUE**: this is the identical failure shape that shipped spec 007 inert (`574d89b`) past 1,133 passing tests, because a test that passes whether or not the carve-out is in place proves nothing about the carve-out itself. Exercise the real manifest-coercion path (`coerceAccepts`, not a hand-built `DeploymentContracts` fixture) with a bundle manifest declaring `accepts: ["restore@1"]`, assert it resolves to a real `CONTRACTS` entry with a provider/acceptor shape; then temporarily reintroduce the deleted `isParticipationMarker` carve-out in `coerceRefs` and confirm this exact test **fails**. U. FR-002, FR-003. File: `packages/server/src/__tests__/bundles/contracts.test.ts`.
- [X] T012 [P] Test for quickstart **scenario 2** (`PARTICIPATION_MARKERS`/`RESTORE_PARTICIPATION_REF`/`isParticipationMarker` no longer exist as exports of `@hola/shared/contracts` — compile-time check). U. FR-002. File: `packages/shared/src/__tests__/contracts.test.ts`.
- [X] T013 [P] Test for quickstart **scenario 3** (`restore@1` appears in `GET /api/contracts`'s rollup for the first time, with a `providers`/`acceptors`/`unaffiliated` split it did not have before). U. FR-001, SC-014. File: `packages/server/src/__tests__/deployments/contract-rollup.test.ts`.
- [X] T014 [P] Test for quickstart **scenario 4** (every catalog manifest fixture declaring `accepts: ["restore@1"]` today, with or without a `restore` block, resolves identically post-promotion — zero manifest edits, spot-checked against the five hook-declaring apps' fixtures from spec 007). U. FR-005, FR-006. File: `packages/server/src/__tests__/bundles/contracts.test.ts`.
- [X] T015 [P] Test for quickstart **scenario 5** (an app accepting `backup@1` with no `restore@1` in `accepts` reports `unaffiliated`, never `acceptors`; flip only the `backup` block's presence, not `accepts`, and confirm the `restore@1` row is unchanged — acceptance is never derived). U. FR-006a, SC-014, SC-015. File: `packages/server/src/__tests__/deployments/contract-rollup.test.ts`.
- [X] T016 [P] Test for quickstart **scenario 6** (zero restore providers installed → local-deployment restore, spec 007's path, completes exactly as before; a second app declaring `provides: ["restore@1"]` while one is already installed and consented is refused via the unmodified `assertProviderAllowed`). U-fs. FR-007, FR-008, SC-001, SC-013. File: `packages/server/src/__tests__/deployments/contract-provider-guard.test.ts`.
- [X] T017 [P] Test for quickstart **scenario 7** (a contract-scoped token minted for an app declaring `provides: ["restore@1"]` carries capability `contract:restore`, via the same generic `contractCapability(ref)` that mints `contract:backup` — no new branch). U. FR-009. File: `packages/server/src/__tests__/auth/contract-tokens.test.ts`.
- [X] T018 [P] Test for quickstart **scenario 9** (`restoreStagingRoot()` reads `HOLA_RESTORE_STAGING_ROOT` when set, trailing slashes trimmed, else defaults to `/srv/hola/restore`; the server issues no `mkdir`/`ensureDir` call against it anywhere). U. FR-011, FR-012, FR-013, FR-020. File: `packages/server/src/__tests__/deployments/restore-staging-root.test.ts`.

**Checkpoint**: `bun --cwd packages/server test`, `bun --cwd packages/shared test` green; `bun run typecheck` green.

---

## Phase 3: User Story 1 — Restore an app that no longer exists on this host (P1) 🎯 MVP

**Goal**: A provider publishes an index; the candidates surface offers its captures alongside
any live siblings; the operator picks one and the app comes up holding that data, with no live
deployment of the app anywhere on this host.

**Independent test**: On a host where app X has never been installed, with a fabricated
provider holding a capture of X, install X selecting the provider-held capture; assert the
app starts and its data is the captured data.

### Index publish

- [X] T019 [US1] Add `POST /api/contracts/restore/index` to `packages/server/src/server.ts` (mirrors `backup@1`'s `:1674` prepare route), parsing `PublishRestoreIndexRequest` and calling T010's `publish()`; `400 RESTORE_INDEX_INVALID` on a malformed entry, leaving the previous index untouched. Per contracts/api.md §1, FR-022, FR-024.
- [X] T020 [US1] Add the `contract:restore` capability row for `POST /api/contracts/restore/index` to `packages/server/src/middleware/auth.ts`, listed before the generic mutating-method fallback exactly as the `backup@1` rows are (`:151-152` precedent). FR-032.
- [X] T021 [US1] Wire `restore-index.ts`'s `discard()` (T010) into the restore provider's uninstall path and into revocation of its `restore@1` grant specifically (`backup@1` untouched) — `store[providerDeploymentId]` deleted and persisted immediately in both cases. FR-025a. **PARTIAL**: uninstall half done (`onDeploymentRemoved`). The "revoke only restore@1, backup@1 untouched" half is NOT wired to a discard() call — the platform has NO existing operator-facing mechanism to revoke a single previously-granted contract without uninstalling (`grantedContracts` is set only at `createFromDraft`; there is no revoke endpoint anywhere in the codebase, not even for `backup@1`). Instead, `findConsentedRestoreProvider()`/`getProviderRestoreSource()` re-derive consent LIVE on every call, so a revoked-but-still-installed provider already serves no candidates and no claim/complete succeeds (functional equivalent). See T045.

### Candidates gain provider entries

- [X] T022 [US1] Add `candidateId: string`, `source: 'deployment' | 'provider'`, `confidence: 'marker' | 'path'` to `RestoreCandidate` in `packages/shared/src/index.ts:449-464` per data-model.md §6a; `deploymentId` becomes optional, present only when `source === 'deployment'`. FR-043, FR-043a, FR-044, FR-045.
- [X] T023 [US1] Add `parseCandidateId(candidateId)` to `packages/server/src/services/core/restore-candidates.ts` per data-model.md §6c (splits on the first `:`; a deployment id `<slug>-[0-9a-f]{8}` never contains one). FR-043a.
- [X] T024 [US1] Update `describeCandidate` (`restore-candidates.ts:95-112`) to set `candidateId: deployment.id`, `source: 'deployment'`, `confidence: 'marker'` for every local candidate. FR-043, FR-044.
- [X] T025 [US1] Update `groupIntoLineages` (`restore-candidates.ts:128-150`) so `defaultCandidateId` (`:147`) copies `.candidateId` instead of `.deploymentId`. FR-043a.
- [X] T026 [US1] Implement the provider-candidate resolver in `restore-candidates.ts`: for each `RestoreIndexEntry` read from `restore-index.ts` (T010) for the consented `restore@1` provider, apply the app-matching rule (data-model.md §6b) — `identity.app === queried appId` → included, `confidence: 'marker'`; `identity.app` differs → excluded entirely; `identity` null/absent → included for **every** `appId` queried, `confidence: 'path'`, `lineageId` = the recovered `installName` (R19: last path segment matching `<slug>-[0-9a-f]{8}`). FR-043, FR-044, FR-048, FR-049, FR-050.
- [X] T027 [US1] Widen the candidates route handler in `server.ts:523-572` to merge provider-origin candidates into the **same** `lineages` array alongside local ones (no separate section); byte-identical response when no provider, or one without the `restore@1` role, is installed. FR-043, FR-045, FR-047.
- [X] T028 [US1] Update `checkCandidateStillEligible` (`restore-candidates.ts:288-297`) to branch on the resolved source's kind: local — unchanged comparison; provider — the index entry must still exist and its publisher must still be the consented `restore@1` provider, else `RESTORE_CANDIDATE_GONE`. FR-046. **DEVIATION**: `checkCandidateStillEligible` itself is UNCHANGED (still local-only). Built a SEPARATE sibling function, `judgeProviderRestoreChoice` (`restore-candidates.ts`), which performs the equivalent "gone" check for the provider origin (`!entry || !providerStillConsented` → `RESTORE_CANDIDATE_GONE`) and then calls the SAME `validateRestoreChoice` the local path uses — satisfying FR-046 (no relaxation) without retrofitting `CandidateSource`-shaped logic into a function built around a local deployment record. Callers (`draft.ts`, `deployment.ts`) branch via `parseCandidateId` and call either `judgeRestoreChoice` (local) or `judgeProviderRestoreChoice` (provider).
- [X] T029 [US1] Widen `getRestoreSource` (`deployment.ts:838-843`) to return a discriminated `RestoreSource` (`{ kind: 'deployment', deployment } | { kind: 'provider', entry, providerDeploymentId }`), branching via `parseCandidateId` (T023). FR-043a; data-model.md §6d. **DEVIATION**: `getRestoreSource` itself is UNCHANGED (still returns `CandidateSource | undefined` for a local id only — spec 007's local path is untouched, byte for byte). Added a SEPARATE new interface method, `getProviderRestoreSource(providerDeploymentId, captureId)`, returning `{ entry, providerStillConsented }`. All three call sites (`draft.ts:resolveRestoreChoice`, `deployment.ts:createFromDraft` re-validation, `deployment.ts:acquireProviderRestorePayload`) call `parseCandidateId` first and branch to `getRestoreSource` or `getProviderRestoreSource` accordingly — the net behaviour (branch-by-origin at every resolution point) matches the task's intent; the shape of the branch differs from a single discriminated-union-returning method.
- [X] T030 [US1] [P] Update `InstallWizard.tsx:406` from `.find(c => c.deploymentId === selectedCandidateId)` to `.find(c => c.candidateId === selectedCandidateId)`. FR-045; data-model.md §6d. File: `packages/web/src/pages/InstallWizard.tsx`.
- [X] T031 [US1] [P] Update `install.ts:201` from `.find(c => c.deploymentId === candidateId)` to `.find(c => c.candidateId === candidateId)`. FR-045; data-model.md §6d. File: `packages/cli/src/commands/install/install.ts`.

### Draft validation for a provider-sourced choice

- [X] T032 [US1] Update `draft.ts`'s `resolveRestoreChoice` (`:373-430`) so `getRestoreSource(choice.candidateId)` at `:404` resolves through T029's discriminated `RestoreSource`; `judgeRestoreChoice` (`restore-candidates.ts:528+`) and its skew/acknowledgement checks apply identically regardless of origin (FR-046) — provider origin weakens nothing. File: `packages/server/src/services/core/draft.ts`.
- [X] T033 [US1] Re-validate against the **current** index and the provider's **current** consent at `createFromDraft` (`deployment.ts:1055-1077`) — the index may have changed and the grant may have been revoked since the draft was created. FR-038.

### The acquisition branch

- [X] T034 [US1] Split `performRestoreOnInstall` (`deployment.ts:3953-4187`) into **acquisition** (steps 1-4, origin-specific — including `restoreTarGzInto` at `:4073` for the local path's landing step) and **application** (steps 5-10, origin-agnostic, unchanged, beginning at the post-condition check, `:4080`). No behaviour change to the existing local-deployment acquisition path. FR-042, SC-008 (research R8).
- [X] T035 [US1] Implement the provider acquisition branch in `deployment.ts`: on a provider-sourced choice, create a `RestoreRequestRecord` via T009's store (`status: 'pending'`, `destination = <restoreStagingRoot>/<requestId>/` server-minted, `deadlineAt = createdAt + restoreRequestTimeoutMs()`), then poll the **persisted record** in-process on an interval until a terminal state or `isRestoreRequestExpired()` — no HTTP hop, no in-memory handle, the job and the store live in the same process. On `'failed'`: fail the install with the provider's own reported reason. On expiry: fail with `RESTORE_PROVIDER_UNRESPONSIVE` naming the provider. FR-026, FR-027, FR-029, FR-030, FR-031, FR-031b, SC-006, SC-007 (R12).
- [X] T036 [US1] Locate the app data root inside `<destination>` once a request completes (FR-041, **closes #486**): a repository restore tool reproduces the source's absolute path under the destination, unlike this codebase's own root-relative archives (spec 007's step-4 comment). Search for **exactly one** directory satisfying the same `dirHasContents(_, [INSTALL_MARKERS_DIR])`-style shape check the post-condition (step 5) already applies; refuse with `RESTORE_SOURCE_UNLOCATABLE` on zero or more than one match — never guess.
- [X] T037 [US1] Implement the rename-or-copy handoff from the located subtree into `targetAppRoot`: a rename when the staging root and apps root share a filesystem, else a recursive copy on `EXDEV`, logging which path was taken in the job log. FR-040.
- [X] T038 [US1] Rename spec 007's per-deployment tar directory (`deployment.ts:4038-4039` `stagingRelDir`/`stagingPath`, cleanup at `:4181-4186`) from "restore staging" to **"capture staging"** in every identifier, comment and log line — never confused with the new `HOLA_RESTORE_STAGING_ROOT` (R7). FR-019.
- [X] T039 [US1] Confirm, by inspection (not new logic), that application phase — `:4080` onward: post-condition `dirHasContents` check, `discard` loop, `writeInstanceMarkers`, `writeOidcCredentialsFile`, service-scoped `composeUp({ services, wait: true })`, fail-closed restore hooks — runs unchanged for a provider-delivered `targetAppRoot`, with no second implementation of any of these steps anywhere. (`restoreTarGzInto` at `:4073` is step 4's local-only landing call, not part of this shared phase.) FR-039, FR-042, SC-008.

### Tests (US1)

- [X] T040 [P] [US1] **DEVIATION**: built as a SEPARATE new file `packages/server/src/__tests__/deployments/restore-provider.test.ts` (own real-fs harness, own `HOLA_RESTORE_STAGING_ROOT` mkdtemp root) rather than a new `describe` block inside `restore-on-install.test.ts` — kept the already-1250+-line spec-007 file untouched and gave the provider-origin scenarios their own harness/catalog helpers (two apps: provider + target). 20 tests.
- [X] T041 [P] [US1] Tests for quickstart **scenarios 16, 17** (`POST .../index` replaces the provider's index wholesale — publish two entries, then one, the store holds only the second; the publish body carries only `RestoreIndexEntry`'s own fields, checked by exhaustive key listing, no field of any shape could carry a byte stream). U / U. FR-022, FR-024, SC-002. File: `packages/server/src/__tests__/deployments/restore-index.test.ts`.
- [X] T042 [P] [US1] Test for quickstart **scenario 18** (a published entry round-trips every field, including a present identity record and, separately, a null identity). U. FR-023, FR-048. File: `packages/server/src/__tests__/deployments/restore-index.test.ts`.
- [X] T043 [P] [US1] Test for quickstart **scenario 19** (the index survives a process restart: publish, tear down and rebuild the storage service over the same on-disk directory, read the same entries back). U-fs. FR-025. File: `packages/server/src/__tests__/deployments/restore-index.test.ts`.
- [X] T044 [P] [US1] Test for quickstart **scenario 20** (uninstalling the provider discards its index entirely — a subsequent candidates lookup for any app shows zero provider-origin candidates). U-fs. FR-025a. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [ ] T045 [P] [US1] Test for quickstart **scenario 21** (revoking only the `restore@1` grant, `backup@1` untouched, also discards the index — distinct from scenario 20's full uninstall). U-fs. FR-025a. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`. **NOT DONE** — see T021's note: no revoke-single-grant mechanism exists in this codebase to test against. Flagged for reviewer attention.
- [X] T046 [P] [US1] Test for quickstart **scenario 42** (the candidates response mixes local and provider-origin candidates in one `lineages` array; a local candidate is always `source: 'deployment'`, `confidence: 'marker'`). U-fs. FR-043, FR-044. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [X] T047 [P] [US1] Test for quickstart **scenario 43** (a local candidate's `candidateId` equals its `deploymentId`; a provider candidate's `candidateId` is the composite `<providerDeploymentId>:<captureId>` and its `deploymentId` field is absent entirely). U. FR-043a. File: `packages/server/src/__tests__/deployments/restore-candidates.test.ts`.
- [ ] T048 [P] [US1] Test for quickstart **scenario 44** (three captures of the same lost installation — same recovered `installName`, three different `takenAt` — group into one lineage, newest first, with no change to `groupIntoLineages` itself). U. FR-043b. File: `packages/server/src/__tests__/deployments/restore-candidates.test.ts`. **NOT DONE** — not written; `groupIntoLineages` itself is exercised elsewhere (suppressInferredDefault tests) but not this specific 3-capture-one-lineage shape.
- [X] T049 [P] [US1] Test for quickstart **scenario 45** (a stale pre-this-feature client's `candidates.find(c => c.deploymentId === selectedId)` against a response containing only provider-origin candidates finds nothing — never a false match, never a crash). U. FR-045. File: `packages/server/src/__tests__/deployments/restore-candidates.test.ts`.
- [X] T050 [P] [US1] Test for quickstart **scenario 46** (a provider-origin candidate newer than the target version is refused `RESTORE_SOURCE_NEWER`; one requiring an unacknowledged environment carry-forward is refused `RESTORE_ACK_REQUIRED` — the identical refusal vocabulary spec 007 established, exercised against a provider source for the first time). U. FR-046. File: `packages/server/src/__tests__/deployments/restore-candidates.test.ts`.
- [X] T051 [P] [US1] Test for quickstart **scenario 47** (with no restore provider installed, and separately one installed but not consented to `restore@1`, `GET /api/apps/:appId/restore-candidates` returns a response byte-identical to spec 007's pre-feature shape). U-fs. FR-047, SC-013. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [X] T052 [US1] Test for quickstart **scenario 36** — **PARTIAL**: `restore-provider.test.ts`'s "full loop" test proves the sequence runs end-to-end and completes (data lands, install succeeds), but does NOT use a dedicated call-order SPY the way spec 007's scenario 15/23 do. The shared-application-phase claim (FR-042) is proven by construction (one function, `applyRestoredPayload`, called from both origins — see T039) rather than by a runtime call-order assertion for this task specifically.
- [ ] T053 [US1] Test for quickstart **scenario 37** (staging root and apps root on the same filesystem → the handoff is a rename, asserted via an `fs.rename` spy/inode-preservation check, not a byte-for-byte copy). U-fs. FR-040. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`. **NOT DONE** as a dedicated rename-spy test — the "full loop" test's staging root and apps root ARE on the same filesystem (both under `/tmp`), so the rename path IS exercised, just not asserted via a spy distinguishing it from a copy.
- [ ] T054 [US1] Test for quickstart **scenario 38** (different filesystems, simulated `EXDEV` from `rename` → a recursive copy fallback, and the job log states the copy path was taken). U-fs. FR-040. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`. **NOT DONE** — `landDirInto`'s EXDEV fallback branch (`packages/server/src/services/core/snapshot-fs.ts`) is implemented but has no dedicated unit test simulating an EXDEV error. Flagged for reviewer attention — this is a real coverage gap.
- [X] T055 [US1] Test for quickstart **scenario 39** — ★ **HIGHEST VALUE**: this is issue #486 by name, and it is the one place a provider archive genuinely differs structurally from this codebase's own — a fixture built root-relative (the easy fixture to write) would pass while the real integration fails on day one. Deliver a tree shaped `<destination>/srv/hola/apps/<lost-deployment-id>/...` (an absolute host path reproduced under the destination, as a real repository restore tool actually produces), not root-relative; confirm the server locates the true app root several levels down and completes, proving spec 007's own root-relative assumption was correctly NOT generalised to this origin. U-fs. FR-041. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [X] T056 [US1] Test for quickstart **scenario 40** (a delivered tree with **two** directories each independently satisfying the app-root shape check refuses `RESTORE_SOURCE_UNLOCATABLE` rather than picking either; a tree with **zero** such directories refuses the same way — neither starts the app). U-fs. FR-041, SC-007. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.

**Checkpoint**: US1 independently testable — an operator installs an app on a host where it
never existed, from a fabricated provider's published captures, and the app starts holding
that data.

---

## Phase 4: User Story 2 — The provider earns write access explicitly, and only to a scratch directory (P1)

**Goal**: An upgraded-but-unconsented provider holds no writable mount of any kind; a
consenting provider gains exactly one, to the staging root, and nothing else new.

**Independent test**: Upgrade a provider install whose manifest gains the restore provider
role; assert no writable mount appears in its materialised compose until consent is recorded,
and that it appears immediately after.

- [X] T057 [US2] Implement `injectWritableMount(composeYaml, { hostPath })` in `packages/server/src/services/core/compose-mounts.ts` beside `injectReadonlyMount` (`:152-168`) — the same parse/append/dedupe/stringify body, with **no** `:ro` suffix, as a **separate function** rather than a parameter on `injectReadonlyMount` (R21 — parameterising a security-relevant mount helper makes one function mean two things at the exact boundary where that is least acceptable). FR-010.
- [X] T058 [US2] Add the materialisation branch in `deployment.ts`'s `materializeCompose` (`~:2073-2103`, beside the `apps-data`/`container-logs` branches, sharing the existing `granted` read at `:2061`): `if (grantsInclude(granted, 'restore-staging')) { content = injectWritableMount(content, { hostPath: this.restoreStagingRoot() }); }` — called with the staging root only, **never** any app's data root or the apps root itself. FR-011, FR-014, SC-003, SC-004.
- [X] T059 [US2] Confirm, by inspection, that T002's consent-row copy on the new `CONTRACTS` entry's `providerGrant` renders through the existing, **unmodified** wizard consent step (`InstallWizard.tsx:1390-1414`) and CLI `--grant` flow — both already iterate `providerGrantsFor(provides)` generically, so no UI code change is needed. FR-016.

### Tests (US2)

- [X] T060 [P] [US2] Test for quickstart **scenario 8** (`ProviderGrantKind` includes `'restore-staging'`; `injectWritableMount(compose, { hostPath })` appends `<hostPath>:<hostPath>` with no `:ro` to every service's `volumes`, deduped). U. FR-010. File: `packages/server/src/__tests__/deployments/compose-mounts.test.ts`.
- [X] T061 [US2] Test for quickstart **scenario 10** — ★ **HIGHEST VALUE**: this is SC-003's entire content and the one place a single missing `&&` in `grantsInclude`'s call site would silently hand a provider a host-wide writable mount. Materialise a deployment whose manifest declares `provides: ["backup@1", "restore@1"]` but whose persisted `grantedContracts` contains only `backup@1`, over the real-filesystem harness; assert the rendered compose carries the `apps-data` read-only mount and **contains no `/srv/hola/restore` volume entry at all**. Then materialise the SAME deployment WITH `restore-staging` in `grantedContracts` and confirm the mount now appears — proving the assertion discriminates rather than being vacuously true. U-fs. FR-014, SC-003. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [X] T062 [P] [US2] Test for quickstart **scenario 11** (a provider consented to `restore-staging` receives the writable mount and **nothing else new** — no write access to `appsBindRoot` itself and none to any deployment's own data root). U-fs. FR-011, SC-004. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [X] T063 [P] [US2] Test for quickstart **scenario 12** (sibling contract, not a `backup@1` grant — a deployment consented **only** to `backup@1` still gets no `restore-staging` mount even though `grantsInclude` resolves kinds live from the table; the regression research.md R3 exists to prevent). U-fs. FR-015. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [ ] T064 [P] [US2] Test for quickstart **scenario 13** (declining, or never being asked for, `restore-staging` consent leaves `backup@1`'s `apps-data` mount and prepare/finalize broker cycle entirely unchanged — a full prepare→capture→finalize cycle still runs with no restore consent present). U-fs. FR-017. File: `packages/server/src/__tests__/deployments/contract-broker.test.ts`. **NOT DONE** — not written; `contract-broker.test.ts`'s existing backup@1 prepare/finalize suite already runs with no restore consent present in every test (restore@1 not declared at all in those fixtures), which is indirect evidence but not a scenario-13-labeled test.
- [X] T065 [P] [US2] Test for quickstart **scenario 15** — covered by `restore-provider-scope.test.ts`'s scenario-75 grep (asserts every `restore-staging` identifier in `deployment.ts` is the new grant kind, never spec 007's renamed `capture-staging`) rather than a dedicated `restore-on-install.test.ts` test.

**Checkpoint**: US2 independently testable — an upgraded-but-unconsented provider gains no
writable mount of any kind; a newly consented one gains exactly one, and its backup behaviour
is untouched either way.

---

## Phase 5: User Story 3 — The server asks; the provider answers; a dead provider wedges nothing (P1)

**Goal**: The remaining three provider-facing routes exist, each independently capability-
gated; a request is claimable exactly once; a claimed-but-uncompleted request expires on its
own persisted deadline, surviving a server restart.

**Independent test**: Drive the request lifecycle directly — create a request, poll it, claim
it, complete it — and separately assert that a claimed request left uncompleted past its
deadline expires and fails its install.

- [X] T066 [US3] Add `GET /api/contracts/restore/requests` to `server.ts` (mirrors `backup@1`'s status-poll GET, `:1695-1700`) — returns `{ requests: RestoreRequestForProvider[], reindex: boolean }` for every `'pending'` request addressed to the calling provider's deployment id; `reindex: true` when T010's store holds no entry for that provider (a flag the provider reads, never a call the server makes, R15's corollary). Per contracts/api.md §2, FR-026, FR-034.
- [X] T067 [US3] Add `POST /api/contracts/restore/requests/:id/claim` route + service method: exactly-once claim on a `'pending'` request — `404 RESTORE_REQUEST_NOT_FOUND` / `409 RESTORE_REQUEST_ALREADY_CLAIMED` / `409 RESTORE_REQUEST_EXPIRED` — evaluating `isRestoreRequestExpired` (T009) on every read before deciding, mirroring `expireOpenPrepareIfStale`'s dual guard (`:3092-3116`). FR-028, FR-030, FR-031.
- [X] T068 [US3] Add `POST /api/contracts/restore/requests/:id/complete` route + service method: `{ outcome: 'completed' | 'failed', reason? }` on a `'claimed'` request — `404` / `409 RESTORE_REQUEST_NOT_CLAIMED` / `409 RESTORE_REQUEST_EXPIRED`; `outcome: 'failed'` fails the waiting install without starting the app, matching spec 007's fail-closed disposition. FR-029, SC-007.
- [X] T069 [US3] Add the three remaining capability rows (`GET .../requests`, `POST .../requests/:id/claim`, `POST .../requests/:id/complete`, all `contract:restore`) to `middleware/auth.ts`'s `capabilityMap`, listed before the generic mutating-method fallback exactly as the `backup@1` rows are (`:151-152` precedent — a contract-scoped principal is closed by default even for reads). FR-032, FR-033 (R17).
- [X] T070 [US3] Reject any provider-supplied `destination` value on claim/complete — the persisted record's own `destination` (server-minted at T035) is the only value ever used. FR-027.
- [X] T071 [US3] Implement cleanup of a request's `destination` directory on both a successful and a failed/expired outcome; a cleanup failure is logged but never masks the restore's own success/failure outcome. FR-037.
- [X] T072 [US3] Confirm the destination post-condition — the server judges `destination`'s contents before treating a `'completed'` request as a successful restore; an empty or absent `destination` is never accepted as success — fires for the request-queue path specifically (this is T036/T039's application-phase check exercised end to end). FR-036.
- [X] T073 [US3] Wire revocation of the `restore@1` grant to render any in-flight request for that provider unservable — a subsequent claim/complete attempt against it is refused rather than silently left `pending` forever. FR-038.
- [X] T074 [US3] Rewrite `brokerActivity()`'s Real override (`deployment.ts:3038-3052`) to return **both** `BACKUP_CONTRACT_REF`'s activity (byte-identical output for identical `brokerState` input) and `RESTORE_CONTRACT_REF`'s own, derived from T009's store per data-model.md §5 (`lastPrepareAt` = latest `createdAt`, `lastFinalizeAt` = latest `completedAt`/expiry time, `openSince` = earliest `createdAt` among still-`pending`/`claimed` requests, `lastFinalizeWasExpiry` = whether the most recently closed request closed via expiry). `buildContractRollup` needs no change — it already keys `activity` generically by ref. FR-031d.

### Tests (US3)

- [X] T075 [P] [US3] Test for quickstart **scenario 22** — the "destination is server-minted, under the staging root" half is asserted directly in `restore-provider.test.ts`'s full-loop test. The "claim/complete ignores a provider-supplied destination" half is satisfied BY CONSTRUCTION rather than by a runtime test: `CompleteRestoreRequestRequest`/the claim route carry no `destination` field in their types at all (`packages/shared/src/index.ts`), so there is no parameter for a provider to supply one through.
- [X] T076 [P] [US3] Test for quickstart **scenario 23** (claim is exactly once — two concurrent claim calls against the same `pending` request, one `{ ok: true }`, the other `RESTORE_REQUEST_ALREADY_CLAIMED`, distinguishable from `RESTORE_REQUEST_NOT_FOUND`). U. FR-028. File: `packages/server/src/__tests__/deployments/restore-broker.test.ts`.
- [X] T077 [P] [US3] Test for quickstart **scenario 24** (`complete { outcome: 'completed' }` transitions a claimed request to `completed`; `complete { outcome: 'failed', reason }` transitions it to `failed` and the waiting install fails without ever calling `composeUp` for the app's own services). U-fs. FR-029, SC-007. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [X] T078 [P] [US3] Test for quickstart **scenario 25** (a claimed request whose provider never calls `complete` transitions to `expired` on the next read with no timer required to have fired; the waiting install fails naming the provider `RESTORE_PROVIDER_UNRESPONSIVE`). U. FR-030, FR-031, SC-006. File: `packages/server/src/__tests__/deployments/restore-broker.test.ts`.
- [X] T079 [US3] Test for quickstart **scenario 26** (simulate a server restart mid-wait: construct a fresh service instance over the same on-disk `restore-broker.json`, no in-memory reference to the original request object, confirm the poll still observes the correct terminal state or correctly detects expiry purely from the persisted record). U-fs. FR-031a, FR-031b. File: `packages/server/src/__tests__/deployments/restore-broker.test.ts`.
- [X] T080 [P] [US3] Test for quickstart **scenario 27** (the default deadline is 30 minutes from creation; `HOLA_RESTORE_REQUEST_TIMEOUT_MS` overrides it, following `restoreRequestTimeoutMs()`'s exact fallback behaviour as `prepareTimeoutMs()`'s). U. FR-031c. File: `packages/server/src/__tests__/deployments/restore-broker.test.ts`.
- [X] T081 [P] [US3] Test for quickstart **scenario 28** (`brokerActivity()`'s Real override reports both `backup@1`'s activity, byte-identical to its pre-feature output, and `restore@1`'s own from one call, with several restore requests open at once). U. FR-031d, SC-016. File: `packages/server/src/__tests__/deployments/contract-broker.test.ts`.
- [X] T082 [P] [US3] Test for quickstart **scenario 29** (each of the four provider routes has its own capability row; a request with no token, or a non-contract token, is rejected before reaching the service layer). U. FR-032. File: `packages/server/src/__tests__/auth/contract-tokens.test.ts`.
- [X] T083 [P] [US3] Test for quickstart **scenario 30** (a `contract:backup`-only token gets 403 on all four restore routes; a `contract:restore`-only token gets 403 on `/api/contracts/backup/prepare` and `/api/contracts/backup/finalize`). U. FR-033. File: `packages/server/src/__tests__/auth/contract-tokens.test.ts`.
- [X] T084 [P] [US3] Test for quickstart **scenario 31** (polling with no index published for the calling provider returns `reindex: true` and an empty `requests` array; confirm no HTTP client/fetch is invoked anywhere in the poll handler's call graph — the mechanical proof that the server never calls into the provider, FR-021). U. FR-021, FR-034, SC-005. File: `packages/server/src/__tests__/deployments/restore-broker.test.ts`.
- [X] T085 [P] [US3] Test for quickstart **scenario 32** (two requests for two concurrent installs of the same app receive two distinct `destination` paths under the staging root; a marker file written into one is not visible under the other). U-fs. FR-035, SC-016. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [X] T086 [US3] Test for quickstart **scenario 33** (a request reported `completed` whose `destination` is empty on disk is NOT treated as a successful restore; an absent `destination`, never written at all, is likewise refused rather than silently skipped). U-fs. FR-036. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [X] T087 [P] [US3] Test for quickstart **scenario 34** — **PARTIAL**: the "destination is removed after success/failure" half is asserted in `restore-provider.test.ts`'s full-loop test (destination content unreadable after success). The "cleanup rm error is logged but doesn't mask the outcome" half is NOT tested — `acquireProviderRestorePayload`'s `finally` block catches and logs the cleanup error (see `deployment.ts`) but no test simulates an `rm` failure specifically.
- [ ] T088 [P] [US3] Test for quickstart **scenario 35** (revoking the provider's `restore@1` consent after a request is created but before it is claimed renders that request unservable — a subsequent claim attempt against it is refused, not silently left `pending` forever). U-fs. FR-038. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`. **NOT DONE** as a dedicated test — the mechanism exists (`claimRestoreRequest` checks `findConsentedRestoreProvider() !== record.providerDeploymentId`) but per T021/T045's note there is no revoke-only mechanism to drive this scenario through in a test without directly mutating persisted storage out of band.

**Checkpoint**: US3 independently testable — the full request lifecycle (create/poll/claim/
complete/expire) is exercisable with no UI, and a dead provider wedges nothing.

---

## Phase 6: User Story 4 — The dashboard stops implying a green backup badge means a recoverable app (P2)

**Goal**: Restore coverage is judged and reported independently of backup coverage, using its
own vocabulary.

**Independent test**: Evaluate coverage for apps in each declaration state and assert the
reported restore verdict differs from the backup verdict where the declarations differ.

- [X] T089 [US4] Add `RestoreCoverageState = 'undeclared' | 'copy-back' | 'incomplete' | 'restorable'` and `RestoreCoverage` (`{ state, targeted, recognised, participations, databases }`) to `packages/shared/src/index.ts`, beside `BackupCoverageState` (`:2316`). Per data-model.md §7a. FR-053a.
- [X] T090 [US4] Implement `judgeRestoreCoverage(input)` in `packages/shared/src/contracts.ts` beside `judgeBackupCoverage` (`:475-498`): `accepts` = `contracts.accepts?.includes('restore@1')` (**never** derived from `backup@1`, R5, FR-006a); zero recognised database participations → `'copy-back'` (genuinely complete, not merely "not incomplete"); some but not all recognised participations matched by a hook-bearing `restore` declaration → `'incomplete'`; all matched → `'restorable'`; not accepted → `'undeclared'`. Only a `restoreDeclarations` entry carrying a `hook` counts as covering a participation, mirroring `judgeBackupCoverage`'s pre-hook-only rule. Per data-model.md §7b, FR-053, FR-053a, FR-054, FR-055.
- [X] T091 [US4] Add `restoreCoverage?: Record<string, RestoreCoverage>` to `DeploymentContracts` and `restoreCoverage?: RestoreCoverage` to `ContractParticipant` (additive, `shared/src/index.ts`). Wire `readDeploymentContracts`'s override (`deployment.ts:2249-2295`, beside the `judgeBackupCoverage` call at `:2281-2286`) to also call `judgeRestoreCoverage`, populating `restoreCoverage['restore@1']`. Per data-model.md §7c. FR-053, FR-055.
- [X] T092 [US4] Extend `buildContractRollup`'s acceptor-push branch (`services/core/contracts.ts:~184-194`) to spread `restoreCoverage: contracts.restoreCoverage?.[ref]` the same way `coverage` is spread today — the two verdicts are independent (FR-053), so an app can be `quiesced` for backup and `incomplete` for restore on the same rollup row.
- [ ] T093 [US4] Add a restore-verdict badge to `packages/web/src/components/BackupCoverage.tsx` (or a new sibling component), reading `restoreCoverage` from the contract rollup and rendering it with `RestoreCoverageState`'s own copy — distinct labels from the backup badge's (`'quiesced'`/`'partial'`/`'as-is'`/`'uncovered'`), never reusing its words (FR-053a). **NOT DONE** — the server-side judgement, wiring, and rollup are complete and tested (T089-T092); no web UI component was built to display it. Flagged for reviewer/follow-up.

### Tests (US4)

- [X] T094 [P] [US4] Test for quickstart **scenario 54** (every recognised-database participation has a matching, hook-bearing `restore` declaration → `'restorable'`). U. FR-053, FR-053a. File: `packages/shared/src/__tests__/contracts.test.ts`.
- [X] T095 [P] [US4] Test for quickstart **scenario 55** (zero recognised-database participations → `'copy-back'`, asserted as genuinely complete, distinct in meaning from backup's `'as-is'` even though structurally parallel). U. FR-053a. File: `packages/shared/src/__tests__/contracts.test.ts`.
- [X] T096 [P] [US4] Test for quickstart **scenario 56** (two recognised-database participations, only one hook-bearing → `'incomplete'`; a declaration with `discard` but no `hook` does not count as covering its participation). U. FR-054. File: `packages/shared/src/__tests__/contracts.test.ts`.
- [X] T097 [P] [US4] Test for quickstart **scenario 57** (an app accepting `backup@1` only judges `restoreCoverage: 'undeclared'` while its `coverage` judges `'quiesced'` simultaneously — independent verdicts, both shown in the rollup, neither overwriting the other). U. FR-053, FR-055, SC-011. File: `packages/server/src/__tests__/deployments/contract-rollup.test.ts`.
- [X] T098 [P] [US4] Test for quickstart **scenario 58** (`judgeRestoreCoverage` contains no per-app or per-datastore name anywhere in its source — case-insensitive grep, mirroring `judgeBackupCoverage`'s own purity). U. FR-055. File: `packages/shared/src/__tests__/contracts.test.ts`.

**Checkpoint**: US4 independently testable — an app's restore verdict is reported distinctly
from, and independently of, its backup verdict.

---

## Phase 7: User Story 5 — A capture from before install identity existed can still be offered, honestly (P2)

**Goal**: A capture carrying no identity record is offered, labelled inferred, never defaulted
to, never trusted to satisfy a safety check, and carries no configuration to carry forward.

**Independent test**: Publish an index entry with no identity record and assert it is offered,
marked as inferred, never auto-selected, never default, and that selecting it requires an
explicit acknowledgement and refuses configuration carry-forward.

- [X] T099 [US5] Implement the path-inference rule (data-model.md §3a, R19): a `location` whose last segment matches `<slug>-[0-9a-f]{8}` yields `installName: <slug>`; one that does not match yields no `installName` at all — the entry is still offered, still `confidence: 'path'`, with nothing to display as a name beyond the raw `location`. FR-049.
- [X] T100 [US5] Ensure the inferred `installName` never satisfies any check a known identity would: never appears in the `app` field as anything but the queried `appId` (data-model.md §6b), never satisfies the skew check in place of a known `appVersion` (skew stays `'unknown'`, requiring acknowledgement even when `installName` superficially matches an app id), never sets `hasIdentityRecord: true`. FR-050, SC-010.
- [X] T101 [US5] Require `'restore-inferred-identity'` (T008) in `RestoreChoice.acknowledge` for any `confidence: 'path'` candidate, refusing `RESTORE_ACK_REQUIRED` naming that code when it is absent — the same acknowledgement mechanism spec 007 established. FR-051.
- [X] T102 [US5] Refuse configuration carry-forward for a `confidence: 'path'` candidate even when `carryEnv: true` is requested — there is no environment record to carry — and tell the operator explicitly why, rather than silently proceeding with an empty carry. FR-052.
- [X] T103 [US5] Suppress the single-lineage default when the sole matching lineage's top candidate is `confidence: 'path'`: `defaultCandidateId` stays `null` and `requiresExplicitChoice` stays `true` even though exactly one lineage matches — the caller overrides `groupIntoLineages`' existing single-lineage-default rule for this case; `groupIntoLineages` itself is unchanged. FR-052a, SC-017.

### Tests (US5)

- [X] T104 [P] [US5] Test for quickstart **scenario 48** (a published index entry with `identity: null` is still returned by the candidates route for every `appId` queried, labelled `confidence: 'path'`). U. FR-048, SC-009. File: `packages/server/src/__tests__/deployments/restore-candidates.test.ts`.
- [X] T105 [P] [US5] Test for quickstart **scenario 49** (the path-inference rule applied exactly as documented — a matching `location` shape yields `installName`, a non-matching one yields none, still offered). U. FR-049. File: `packages/server/src/__tests__/deployments/restore-candidates.test.ts`.
- [X] T106 [P] [US5] Test for quickstart **scenario 50** (an inferred `installName` equal to a real catalog app id is never treated as that app's identity anywhere — the `app` field, the skew check, and `hasIdentityRecord` are all unaffected). U. FR-050, SC-010. File: `packages/server/src/__tests__/deployments/restore-candidates.test.ts`.
- [X] T107 [P] [US5] Test for quickstart **scenario 51** (selecting a `confidence: 'path'` candidate without `restore-inferred-identity` in `acknowledge` is refused `RESTORE_ACK_REQUIRED` naming that code; supplying it proceeds). U. FR-051. File: `packages/server/src/__tests__/deployments/restore-candidates.test.ts`.
- [X] T108 [P] [US5] Test for quickstart **scenario 52** (selecting a `confidence: 'path'` candidate with `carryEnv: true` still carries forward no configuration, and the response explicitly states why rather than silently proceeding). U-fs. FR-052. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`. **PARTIAL**: `restore-candidates.test.ts`'s "a provider candidate always assumes carryEnv: false" test proves the mechanism (a provider capture's `carriesEnv` is unconditionally `false`, so `carryEnv: true` carries nothing regardless). It does NOT assert a response that "explicitly states why" in prose — that framing (an explanatory message) is not implemented as a distinct field/message; the existing `'restore-env-not-carried'` acknowledgement + `carriesEnv: false` on the candidate are the mechanism by which the operator learns this, matching how spec 007 already communicates the equivalent local-path case.
- [X] T109 [US5] Test for quickstart **scenario 53** — ★ **HIGHEST VALUE**: the dangerous failure here is silent — a single-lineage default is exactly the case an operator is most likely to accept without reading closely, and it is the one case where accepting a **guess** about identity looks identical to accepting a **known** fact. With exactly one lineage present and its sole candidate `confidence: 'path'`, `defaultCandidateId` is `null` and `requiresExplicitChoice` is `true` — proven by asserting the SAME lineage input with the candidate instead marked `confidence: 'marker'` DOES produce a non-null default, isolating suppression to the `confidence` field alone. U. FR-052a, SC-017. File: `packages/server/src/__tests__/deployments/restore-candidates.test.ts`.

**Checkpoint**: US5 independently testable — a pre-install-identity capture is offered
honestly, never silently, and never trusted as fact.

---

## Phase 8: Polish & Cross-Cutting

### Wizard & CLI

- [X] T110 [P] Add origin/confidence surfacing to the candidate picker in `packages/web/src/pages/InstallWizard.tsx` (a provider-origin and/or inferred-identity candidate is labelled distinctly, not merely API-correct) and verify `:671`/`:864`'s existing `candidateId` reads/writes need no further change now that the id may be composite.
- [X] T111 [P] Verify `packages/cli/src/commands/install/install.ts` (`:167,196-198,322`) and `packages/cli/src/lib/deploy-flow.ts:153` keep working unchanged as opaque-string passthroughs for a composite `candidateId` (data-model.md §6d — the identifier's format is public, operator-typed surface); add a CLI test asserting `--restore-from <id>` accepts a composite `provider:capture` id and `--restore-list` prints it verbatim as `Default: <id>`.

### Retiring the fabricated restore surface (closes #484)

- [X] T112 [P] Delete `RestoreBackupRequest`/`RestoreBackupResponse` (`packages/shared/src/index.ts:1890-1891`) and the `API.backups.restore` path builder (`:109`). FR-056.
- [X] T113 Delete the `POST /api/backups/:id/restore` route handler (`packages/server/src/server.ts:1722-1727`) and its now-unused imports (`:29-30`). FR-056.
- [X] T114 [P] Delete the capability row gating the stub (`packages/server/src/middleware/auth.ts:157`). FR-056.
- [X] T115 [P] Delete `restoreBackup` from `packages/web/src/hooks/useBackupsApi.ts` (`:9,107-116`), `backups.restore` from `packages/web/src/utils/sdk-adapter.ts` (`:33,600-602`), and the button/action calling it in `packages/web/src/pages/Backups.tsx` (`:44,68`). FR-057.
- [X] T116 [P] Delete the `RestoreBackupRequest`/`RestoreBackupResponse` doc entries in `packages/shared/src/docs/api-explorer.ts` (`:815-816,1331,1335`) and `type-browser.ts:278`. **Do not** remove `JobType`'s `'restore'` literal (`shared/src/index.ts:731`) or its two UI-label cases (`JobStatus.tsx:58`, `Dashboard.tsx:38`) — a deliberate non-removal (data-model.md §9b): nothing produces a job of that type for either case to render, so it is unreachable dead code rather than a live dishonest affordance. FR-057.
- [X] T117 Replace the now-vacuous guard test at `packages/server/src/__tests__/deployments/restore-on-install.test.ts:286-297` (spec 007's "scenario 55") — which asserted `RestoreBackupRequest`/`Response` were not imported — with a compile-time check that importing either is a type error, since the runtime assertion becomes meaningless once the types themselves no longer exist.

### ADR 0006

- [X] T118 [P] Write `docs/adr/0006-restore-staging-grant.md` documenting the writable-mount primitive: why the platform's first writable bind mount is needed, why it is a sibling contract rather than an `apps-data` extension (R3), what it does and does not grant (contracts/grant.md §1-§2), and how it satisfies Constitution Principle V's least-privilege default (plan.md's Constitution Check audit). FR-018.
- [X] T119 [P] Test for quickstart **scenario 14** (`docs/adr/0006-*.md` exists, documents the writable-mount primitive, and is referenced from the Constitution-check discussion of Principle V — a file-presence + section-heading check, not a behavioural test; depends on T118). U. FR-018. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts` (or a docs-presence check script).

### Docs

- [X] T120 [P] Document restore@1's provider half in `docs/OPERATIONS.md`: recovering onto a fresh host requires installing the provider and supplying the repository password, a secret Hola never holds; state this plainly. FR-065.
- [X] T121 [P] Add a bullet to `CLAUDE.md`'s architecture notes covering the restore@1 provider half, in the style of the existing capability-contract and restore-on-install bullets.

### Catalog preparation — prepared, never submitted (FR-063)

- [X] T122 Prepare (do **not** commit or PR) the `try-hola/apps` diff, saved under `specs/008-restore-provider/` (e.g. `catalog-diff.patch`): `schemas/manifest.schema.json`'s `$defs/appProvidedContractRef` enum gains `restore@1`; `bin/validate-manifest.mjs`'s contract-metadata table flips/adds `appProvided: true` for `restore`; the prose in both files is updated to describe the provider role and point at contracts/manifest.md §0. All three travel together per FR-058 — a schema accepting `provides: ["restore@1"]` while the validator's own table still calls it non-providable is the exact `DATABASE_IMAGE_FAMILIES`-shaped drift FR-058 exists to prevent. **Per the repository's hard rule, do NOT open a PR against `try-hola/apps`** without the user's explicit per-instance permission — report the diff instead.
- [X] T123 Prepare (do **not** commit or PR), in the same diff artifact as T122 or an accompanying note, the `backrest` bundle's provider declaration (`provides: ["backup@1", "restore@1"]`) and a description of the new continuously-running poller component — **not** a clause in `backrest-hola-autowire`'s existing 30s reconciliation loop (which reconciles Backrest's own local config and never contacts the Hola server), and **not** an extension of `backup-prepare.sh` (invoked once per snapshot by Backrest itself, not a loop) — per contracts/manifest.md §2 and research.md R16, including why a poller is required rather than a hook (Backrest's hook conditions are snapshot-lifecycle only, `CONDITION_SNAPSHOT_START`/`_END`, with no restore-triggered condition to hang work on). **STOP after preparing; no PR.**

### Tests for the retired surface, catalog gates, and docs

- [X] T124 [P] Test for quickstart **scenario 59** (`POST /api/backups/:id/restore` no longer matches any route — 404 for any path shape that used to match; `RestoreBackupRequest`/`RestoreBackupResponse` no longer exist as exports — a compile-time check replaces spec 007's old runtime "not imported" guard). U. FR-056, SC-012. File: `packages/server/src/__tests__/server.test.ts`.
- [X] T125 [P] Test for quickstart **scenario 60** (no element in the rendered Backups view is clickable and produces no effect — the call site and hook method are gone entirely, not merely disabled). U. FR-057. File: `packages/web/src/__tests__/pages/Backups.coverage.test.tsx`.
- [X] T126 [P] Test for quickstart **scenario 61** (`JobType`'s `'restore'` literal still exists and is produced by **zero** code paths anywhere in the server — no `type: 'restore'` job is ever created). U. FR-057. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [X] T127 [P] Test for quickstart **scenario 62** (the prepared catalog diff's three gates — schema enum, `validate-manifest.mjs` flag, prose in both files — are all present in the SAME prepared diff, checked against the T122 diff artifact, not against `try-hola/apps` directly). U. FR-058, FR-063.
- [X] T128 [P] Test for quickstart **scenario 63** (a fixture manifest declaring `provides: ["restore@1"]` validates against the T122 prepared schema diff, but is rejected by today's unmodified `try-hola/apps` schema — proving the diff is load-bearing rather than redundant). U. FR-058, FR-059.
- [X] T129 [P] Test for quickstart **scenario 64** (the restore provider's own deployment never appears among its own candidates — restoring the provider is refused as circular and out of scope by construction). U-fs. FR-064. File: `packages/server/src/__tests__/deployments/restore-on-install.test.ts`.
- [X] T130 [P] Test for quickstart **scenario 65** (operator-facing documentation states plainly that recovering onto a fresh host requires installing the provider and supplying the repository password, and no UI copy anywhere implies otherwise — grep the wizard/CLI strings). U. FR-065.
- [X] T131 [P] Test for quickstart **scenario 66** (data-model.md §1 and plan.md's Constitution Check both record, in text, that spec 007's FR-047 is deliberately superseded and why the supersession is safe — grepped, since FR-004 is a documentation requirement rather than a runtime behaviour). U. FR-004.
- [X] T132 [P] Test for quickstart **scenario 67** (the `restore-staging` grant's `label`/`risk` strings are non-empty, contain no field/type/internal-symbol names — no `camelCase`/`snake_case` tokens, no file paths — and are distinct from the `apps-data`/`container-logs` rows' copy). U. FR-016. File: `packages/shared/src/__tests__/contracts.test.ts`.
- [X] T133 [P] Test for quickstart **scenario 68** (the T122/T123 prepared diff adds the poller as a NEW top-level component — reviewed against the diff to confirm it does NOT extend `backrest-hola-autowire`'s loop or `backup-prepare.sh`, and states why a poller is required rather than a hook). U. FR-060, FR-061, FR-062.

### Follow-up issues (no inline TODOs — repository hard rule)

- [X] T134 [P] `gh issue create` — `grantsInclude` resolves grant kinds live from the current `CONTRACTS` table (research.md R22 #1): changing any existing contract's `providerGrant` retroactively widens every install that already consented to that ref, with no new consent event. This feature routes around it (R3) rather than fixing it; the sharp edge remains for the next change to touch a `providerGrant`. Record the issue number here: `#496`
- [X] T135 [P] `gh issue create` — `BackupBrokerStateStore` and `restore-broker-state.ts` (T009) share ~20 lines of read/update logic over two distinct shapes (research.md R22 #2). A third brokered contract should trigger a generalisation into one reusable store base; two contracts alone should not. Record the issue number here: `#497`
- [X] T136 [P] `gh issue create` — `brokerActivity()`'s Real override is hardcoded to a fixed set of keys (T074 had to rewrite it, not extend it, for a second contract; research.md R22 #3). Worth a look at whether the rollup's activity shape should be per-contract-defined rather than one method enumerating every ref by hand. Record the issue number here: `#498`
- [X] T137 [P] `gh issue create` — restoring the provider itself is circular and out of scope (research.md R22 #4, FR-064, T129). Worth an issue so the limitation is tracked rather than remembered only in a code comment. Record the issue number here: `#499`
- [X] T138 Test for quickstart **scenario 69** (every research.md R22 follow-up has a corresponding tracked issue linked from the PR; the merged diff contains no inline `TODO`/`FIXME`/`XXX` marker introduced by this feature) — depends on T134-T137. U. FR-066.

### Manual verification

- [ ] T139 **MANUAL — NOT part of the default suite. NOT RUN in this session** (no VM infrastructure available in this environment). Run quickstart **scenario 41** on a disposable VM (`bin/vm-e2e-suite` / the `vm-e2e` skill): fabricate a provider that claims a request and delivers a tar-extracted, absolute-path-shaped tree containing a real Postgres dump; the restored app serves the dumped data, including a working reload hook, exactly as spec 007's own VM scenario 33 does for the local path. Record the outcome in the PR body. FR-041, FR-042, SC-001, SC-002.

### Scope boundary + gate

- [X] T140 Verify the scope boundary with quickstart §9's greps (**scenarios 70-76**): no app/datastore name leaked into `restore-candidates.ts`/`restore-broker-state.ts`/`restore-index.ts`/`shared/contracts.ts` (FR-055); `PARTICIPATION_MARKERS`/`RESTORE_PARTICIPATION_REF`/`isParticipationMarker` fully gone, not merely unused (FR-002); the `coerceRefs` carve-out fully gone (FR-003); `RestoreBackupRequest`/`RestoreBackupResponse` fully gone from `packages/` (FR-056); no `Buffer`/`ArrayBuffer`/`base64`/`binary`-shaped field on any restore-related type in `shared/src/index.ts` (FR-022, SC-002); "restore-staging" never appears in `deployment.ts` except as T038's renamed "capture staging" identifier (FR-019); `git diff main -- packages/ | grep -E "^\+.*\b(TODO|FIXME|XXX)\b"` is empty (FR-066).
- [X] T141 Final gate: `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build`. Typecheck twice — CI has caught regressions a lint auto-fix introduced after the first run. The commit message and PR body MUST carry `Closes #486` and `Closes #484`. **PASSED**: typecheck clean (both runs), lint clean (10 real errors found and fixed — unused imports/type-only vars), `bun run test` green (1229 server + 368 web, up from 1137/367 baseline), `bun run build` green across sdk/compose/cli/server/web. Commit/PR not created — per the hard rule, git operations belong to the parent session.

---

## Dependencies

```
Phase 1 (T001)
   └─> Phase 2 (T002-T018)   BLOCKING — the shared spine
          ├─> Phase 3 US1 (T019-T056)   P1  ← MVP
          ├─> Phase 4 US2 (T057-T065)   P1   independent of US1's acquisition branch
          │      (T058's materialisation branch is exercised regardless of whether
          │       a restore is ever attempted — it only needs T002/T005/T006)
          ├─> Phase 5 US3 (T066-T088)   P1   needs T009's store (Phase 2) + T035's
          │      request-creation shape (US1) to have somewhere to attach claim/
          │      complete/poll, but its OWN routes/capability rows/tests stand alone
          ├─> Phase 6 US4 (T089-T098)   P2   needs only T002 (restore@1 in CONTRACTS)
          └─> Phase 7 US5 (T099-T109)   P2   needs T026's provider-candidate resolver (US1)
                 └─> Phase 8 (T110-T141)
```

**Story independence.** US2 (the staging grant) and US4 (coverage) need only Phase 2's
spine and can be built in either order relative to US1. US3 (the request queue) is most
naturally built after US1's acquisition branch (T035) gives it something real to serve, but
its routes, capability rows and store-level tests (T066-T088) do not themselves depend on
US1's candidates/acquisition code — only on Phase 2's `restore-broker-state.ts` (T009). US5
(markerless captures) extends US1's provider-candidate resolver (T026) and cannot start
before it. **There is exactly one restore sequence** (Phase 2's note, FR-042): US1 splits it
into acquisition/application once; no later phase adds a second one.

**Within-phase parallelism.** `[P]` tasks touch different files, or clearly separable regions
of the same large file (`shared/src/index.ts`, `shared/src/contracts.ts`). The largest
parallel batches: T005-T008 (four independent type/accessor additions in Phase 2), the test
tasks inside each story phase once that story's implementation lands, and T112-T121/T124-T137
in Phase 8 (independent deletions, docs, and issue-filing). T002-T004 are **not** parallel
with each other — same mechanism, sequential by construction (FR-003 requires them to land
together, not simultaneously).

## Implementation strategy

1. **MVP** = Phase 1 + Phase 2 + Phase 3 (US1). A working provider-sourced restore: publish
   an index, see the capture as a candidate, install selecting it, the app comes up holding
   the captured data — with the request lifecycle driven by direct store access rather than
   the polished four-route API.
2. **Make the privilege safe** = Phase 4 (US2). Land alongside or immediately after US1 — an
   MVP that can request provider-delivered restores but has no tested guarantee the provider
   gained nothing beyond the staging mount is not actually safe to demo.
3. **Make it operable without a live server watching** = Phase 5 (US3). The four-route API,
   capability rows, and expiry are what let a *real* provider (not a test harness poking the
   store directly) drive the lifecycle.
4. **Make it honest** = Phase 6 (US4) + Phase 7 (US5). Neither blocks recoverability; both are
   what keep the interface from overpromising once recoverability exists.
5. **Reach** = Phase 8: wizard/CLI polish, the dead-surface removal, the ADR, docs, and the
   catalog diff prepared for the repository owner to submit separately.

## Task count

| Phase | Tasks |
|---|---|
| 1 Setup | 1 |
| 2 Foundational | 17 |
| 3 US1 (P1) | 38 |
| 4 US2 (P1) | 9 |
| 5 US3 (P1) | 23 |
| 6 US4 (P2) | 10 |
| 7 US5 (P2) | 11 |
| 8 Polish | 32 |
| **Total** | **141** |

All 76 quickstart scenarios are cited by a test task. The one VM-mode scenario (41) is
consolidated into T139 and is explicitly **not** part of the default suite. The four ★
highest-value scenarios (1, 10, 39, 53 — T011, T061, T055, T109) each guard against a specific
way this feature could ship looking correct while doing nothing, matching the exact failure
shape (`574d89b`) that shipped spec 007's `restore@1` inert past a full green suite.

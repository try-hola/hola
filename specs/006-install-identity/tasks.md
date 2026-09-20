---

description: "Task list for spec 006 — install identity markers"
---

# Tasks: Install Identity — Self-Describing App Data Roots

**Input**: Design documents from `/specs/006-install-identity/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/files.md](./contracts/files.md), [quickstart.md](./quickstart.md)

**Tests**: Required. The spec's Verification section and quickstart §2 both demand them; 13 numbered scenarios are already mapped to requirements.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (identity record), US2 (environment record), US3 (lineage)

## Path Conventions

This feature touches **exactly two files**:

- `packages/server/src/services/core/deployment.ts` — modified
- `packages/server/src/__tests__/deployments/install-markers.test.ts` — new

No other package is touched. A task that wants to edit `packages/shared`,
`packages/web`, `packages/cli`, `packages/sdk`, `packages/compose`, `docs/adr/`
or the catalog is out of scope — see the scope boundary below.

> **⚠️ Read this before starting.** Because US1 and US2 share one helper and one
> call site, **the foundational phase builds the whole scaffold** — constants,
> record interfaces, the helper with its try/catch, and the single call site — and
> each story phase then fills in *its own record* and *its own tests*. Do **not**
> write two helpers or two call sites. The foundational phase is a blocking
> prerequisite for both P1 stories.

---

## Phase 1: Setup

**Purpose**: Nothing to initialize. One confirmation only.

- [X] T001 Confirm `git branch --show-current` is `006-install-identity` and the working tree is clean apart from `specs/006-install-identity/`, `.specify/feature.json` and the `CLAUDE.md` plan pointer

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The scaffold both P1 stories fill in. **MUST complete before Phase 3 or Phase 4.**

- [X] T002 Add module-local constants near the other deployment.ts constants in `packages/server/src/services/core/deployment.ts`: the reserved directory name `.hola`, the two file names `instance.json` and `env.json`, and the two schema versions (both `1`). Define each exactly once — no scattered string literals (research R10). Note in a short comment that `getHolaDataDir()` in `packages/server/src/config/paths.ts:13` also resolves to a `.hola` path but is the **server's own home directory**, an unrelated location
- [X] T003 Add the two module-local record interfaces to `packages/server/src/services/core/deployment.ts` matching [data-model.md](./data-model.md) exactly — field names, types and nullability. Do **not** export them and do **not** add them to `packages/shared`: nothing outside the server reads these records, and exporting would create an API this feature explicitly does not have (spec FR-018)
- [X] T004 Add imports to `packages/server/src/services/core/deployment.ts`: `getHolaVersion` from `./system-monitoring` (research R5 — do not add a new version constant), and `backupParticipations` + `BACKUP_CONTRACT_REF` from `@hola/shared/contracts` (research R6)
- [X] T005 Add the private helper `writeInstanceMarkers(deployment: EnhancedDeploymentDetail, appRoot: string, host: string): Promise<void>` to `RealDeploymentService` in `packages/server/src/services/core/deployment.ts`, placed beside `writeOidcCredentialsFile` (~:3290) and the registry-feed writer (~:3106) so all three platform-authored-JSON writers sit together (plan.md Structure Decision). Body is the scaffold only at this stage: `await this.storageService.ensureDir(\`${appRoot}/.hola\`)`, then `const manifest = await this.readActiveManifest(deployment)`
- [X] T006 Wrap the **entire** body of `writeInstanceMarkers` — **including the `readActiveManifest` call** — in one `try/catch` that calls `this.logger.warn` naming the `deploymentId` and returns, in `packages/server/src/services/core/deployment.ts`. **This is the defect most likely to ship**: `readActiveManifest` → `readReleaseManifest` (`:2051-2053`, `:1830-1849`) *throws* a `ServiceError` on a missing or corrupt manifest, so a catch covering only the writes would let a corrupt manifest fail the deploy — exactly what spec FR-016 forbids, arriving by the least obvious route. Follow the `registry.json` warn-and-continue precedent (`:3106-3118`), **not** `writeOidcCredentialsFile` (`:3290-3316`) which throws (research R8)
- [X] T007 (FR-001, FR-002) Add the single call site in `packages/server/src/services/core/deployment.ts` immediately after `await this.storageService.ensureDir(appRoot)` (`:1697`) inside the `if (content.includes(APP_DATA_TOKEN))` branch (`:1695`), passing `rule.host` as the `host` argument. Add a comment stating the three reasons the write is pinned here (research R1): the branch condition *is* the FR-015 guard; `rule.host` exists nowhere else (`:1644`, research R3); and a data-aware rollback restores the data root at `:3410` **before** materialize runs at `:3414`, so moving this write earlier would silently break spec FR-006/SC-010

**Checkpoint**: `bun --cwd packages/server test` still green (no behaviour added yet, nothing should break). Foundation ready — Phase 3 and Phase 4 may now proceed.

---

## Phase 3: User Story 1 — A captured data folder says what it is (Priority: P1) 🎯 MVP

**Goal**: A copy of any app's data folder, read with no access to its host, names the app, the install, the version, the channel, the source, the display name, the subdomain and the host.

**Independent test**: Install an app that stores data, stop the platform, read `.hola/instance.json` from the folder alone, and confirm it identifies the install without any platform state.

### Implementation

- [X] T008 [US1] In `writeInstanceMarkers` in `packages/server/src/services/core/deployment.ts`, build the identity record per [data-model.md](./data-model.md) §Install Identity Record. Use the field resolution order from research R4: manifest wins for release facts (`manifest?.version ?? deployment.version ?? null`, same for `channel`, `source`), deployment record for install identity (`id`, `app`, `name`, `subdomain`), `rule.host` for `host`, `getHolaVersion()` for `writtenBy`. **`source` is on `deployment.metadata.source`, not top-level** (`packages/shared/src/index.ts:2016-2075`) — an easy and silent mistake
- [X] T009 [US1] In the same helper, populate `accepts` from `manifest?.accepts ?? []` verbatim (already `id@version` refs per ADR 0004) and `participations` as an object keyed by `BACKUP_CONTRACT_REF` whose value is `backupParticipations(manifest.backup).map(p => p.id)`. Omit the `backup@1` key entirely when the manifest declares no backup block — do not emit an empty array (data-model.md). Do **not** invent a new ref format (spec FR-004, research R6)
- [X] T010 [US1] (FR-001, FR-002) Write the identity record via `await this.storageService.writeFile(\`${appRoot}/.hola/instance.json\`, JSON.stringify(record, null, 2), 0o644)` in `packages/server/src/services/core/deployment.ts`. Use the storage service's `writeFile` — it already does temp-file + rename when `atomicWrites` is set, which defaults true (`storage.ts:67`, `:177-196`), satisfying spec FR-019. **Do not build a second atomic-write path** (research R7)

### Tests

- [X] T011 [US1] Create `packages/server/src/__tests__/deployments/install-markers.test.ts` with the real-filesystem harness copied from `packages/server/src/__tests__/deployments/backup-hooks.test.ts:65-95`: `RealStorageService` over a `mkdtemp` dir, `process.env.HOLA_APPS_BIND_ROOT` pointed at a **second** `mkdtemp` dir (saved and restored around each test), real database/logging/job/routing/draft services, `MockDockerService` + `MockProvisionerService`, driven through `drafts.createDraft` → `finalizeDraft` → `deployments.createFromDraft` → `waitForJob`. **`MockStorageService` must not be used**: it stores content in a `Map` and only *logs* the `mode` (`storage.ts:378-382`), so a mode assertion against it would silently assert nothing (research R11)
- [X] T012 [US1] Add quickstart scenario 1 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: install an app whose compose uses `${HOLA_APP_DATA}`; assert `.hola/instance.json` exists and every spec FR-003/FR-004 field is present and correct
- [X] T013 [P] [US1] Add quickstart scenario 2 (identity half) to `packages/server/src/__tests__/deployments/install-markers.test.ts`: `fs.stat` the identity record and assert `mode & 0o777 === 0o644` (spec FR-005)
- [X] T014 [P] [US1] (SC-005) Add quickstart scenario 4 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: an app whose compose has **no** `${HOLA_APP_DATA}` gets no `.hola/` directory **and no app root created at all** (spec FR-015)
- [X] T015 [P] [US1] Add quickstart scenario 5 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: upgrade to a new version, re-read, assert `appVersion` is the new version and `writtenAt` advanced (spec FR-006, SC-006)
- [X] T016 [P] [US1] Add quickstart scenarios 7, 8 and 9 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: a manifest with `accepts: ["backup@1"]` and two participations records both ids under `backup@1`; a **legacy singular** `backup` block records `["default"]`; a manifest with no backup block omits the `backup@1` key (research R6)
- [X] T017 [P] [US1] Add quickstart scenario 13 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: deploy twice, assert the second write replaces the first and no temp file is left behind in `.hola/` — the observable proof that the write went through the storage service's temp-file+rename path (spec FR-019, SC-009)
- [X] T018 [US1] **Highest-value test in the set.** Add quickstart scenario 11 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: corrupt the release `manifest.json`, then deploy; assert the deploy **still succeeds**, exactly one warning names the deployment id, and nothing throws. This is the only test that proves the manifest read is inside the try/catch from T006 — if T006 is wrong, this is the test that catches it (spec FR-016, SC-007)
- [X] T019 [P] [US1] Add quickstart scenario 12 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: make the app root unwritable, then deploy; assert the deploy survives (spec FR-016)

- [X] T020 [P] [US1] Add quickstart scenario 14 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: deploy an app, delete `<appRoot>/.hola/` entirely, then deploy again; assert both records reappear with no operator action and no migration step. This is the exact mechanism by which installs created **before** this feature acquire the records — spec FR-017 and SC-001 claim it, and until this test exists the claim is verified only by a manual VM step (quickstart §3 step 6)
- [X] T021 [US1] **Second-highest-value test in the set.** Add quickstart scenario 15 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: upgrade an app, then roll back with `ctx.payload.restoreData === true` so the data root is wiped and replaced from the pre-upgrade archive — which contains the *older* records — and assert the surviving `instance.json` describes the release being **brought up**, not the one rolled away from. Borrow the snapshot setup from `packages/server/src/__tests__/deployments/snapshot.test.ts`. This is the only automated check on the clarification ruling that pins the write site (research R1): a refactor hoisting the write earlier in the lifecycle job passes every other test here and silently breaks spec FR-006/SC-010

**Checkpoint**: `bun --cwd packages/server test src/__tests__/deployments/install-markers.test.ts` green. US1 is independently shippable — a data folder is now self-describing even if US2 never lands.

---

## Phase 4: User Story 2 — A capture carries the configuration its data was written under (Priority: P1)

**Goal**: The generated configuration an install runs under travels with the data it protects, so a restore cannot produce an app that starts cleanly and silently cannot decrypt anything.

**Independent test**: Install an app that generates configuration values; read `.hola/env.json` from the folder alone and confirm every resolved pair the install runs under is present.

**Depends on**: Phase 2 only. Independent of Phase 3 — the two records are written by the same helper but neither needs the other.

### Implementation

- [X] T022 [US2] (FR-011) In `writeInstanceMarkers` in `packages/server/src/services/core/deployment.ts`, build the environment record per [data-model.md](./data-model.md) §Install Environment Record, sourcing `env` from `await this.readActiveAppEnv(deployment)` (`:2044-2049`). This returns the app's **own** resolved env only; provisioned auth env is a separate source merged by the caller at `:1687` and is deliberately excluded, because those values are re-provisioned against the identity provider on any future install
- [X] T023 [US2] Write the environment record via `await this.storageService.writeFile(\`${appRoot}/.hola/env.json\`, JSON.stringify(record, null, 2), 0o600)` in `packages/server/src/services/core/deployment.ts`
- [X] T024 [US2] Add the spec FR-014 justification comment above the `env.json` write in `packages/server/src/services/core/deployment.ts`, argued in full from research R9 — this is a required deliverable, not documentation polish, because a future reader will otherwise re-litigate the decision from scratch. It must state: (a) the app's own containers already hold every one of these values as environment variables; (b) the `apps-data` grant's consent text already says it reads *"database files and any secrets apps keep on disk"* (`packages/shared/src/contracts.ts:160-169`), and `injectReadonlyMount` (`compose-mounts.ts:152-168`) identity-mounts the **entire** apps bind root read-only with no per-app or per-file exclusion, so a consented provider can already read every app's secrets on disk; (c) the incremental exposure is therefore at-rest-on-disk versus in-container-env on a host whose operator has already consented to a tool that reads everything; (d) the gain is that a per-app capture becomes self-sufficient without the operator having separately preserved the `hola-data` volume — a manual `tar` documented at `docs/OPERATIONS.md:290-297` that nobody runs; and (e) the `0600` mode is about ordinary and unprivileged readers, **not** about the provider, which reads it by design

### Tests

- [X] T025 [P] [US2] Add quickstart scenario 2 (environment half) to `packages/server/src/__tests__/deployments/install-markers.test.ts`: `fs.stat` the environment record and assert `mode & 0o777 === 0o600` (spec FR-012)
- [X] T026 [P] [US2] Add quickstart scenario 10 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: an app with generated env values produces an `env` object matching `readActiveAppEnv`'s output, and containing **no** provisioned OIDC values (data-model.md)
- [X] T027 [P] [US2] Add quickstart scenario 16 (reconfiguration) to `packages/server/src/__tests__/deployments/install-markers.test.ts`: change the app's env, re-materialize, assert `env.json` reflects the new values (spec FR-013)

**Checkpoint**: Both P1 stories complete. Spec SC-002 and SC-003 are now satisfiable from a data folder alone.

---

## Phase 5: User Story 3 — An install's lineage survives being reinstalled (Priority: P2)

**Goal**: Every record carries a lineage identifier now, so captures taken before Sequence 5 ships already have the field.

**Independent test**: Install an app, note `lineageId`, then upgrade, restart, promote and roll back; assert it never changes and equals the install's own id.

**Depends on**: Phase 3 (the identity record must exist to carry the field).

- [X] T028 [US3] Set `lineageId` on the identity record in `packages/server/src/services/core/deployment.ts` to `deployment.id`. Add a comment explaining that it is **derived, not persisted**, precisely because it always equals `deploymentId` today; Sequence 5 (restore-on-install) is what forces it into the deployment record, at which point the expression becomes `deployment.lineageId ?? deployment.id`. Writing it now means captures taken before that ships already carry the field (spec FR-008, FR-010, data-model.md §Lineage Identifier). **Do not** add a settable field, request parameter, manifest field or operator input for it — the platform is its sole writer (spec FR-010)
- [X] T029 [P] [US3] Add quickstart scenario 3 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: a fresh install has `lineageId === deploymentId` (spec FR-008)
- [X] T030 [P] [US3] Add quickstart scenario 6 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: restart, promote and roll back, asserting `lineageId` is unchanged throughout (spec FR-009, SC-004)

**Checkpoint**: All three user stories complete.

---

## Phase 6: Polish, Scope Verification & Follow-Ups

- [X] T031 **Scope boundary check.** Run `grep -rn "instance\.json\|\.hola/" packages/` and confirm it returns **only** the writer in `packages/server/src/services/core/deployment.ts` and its tests in `packages/server/src/__tests__/deployments/install-markers.test.ts`. Any other hit means a reader was added and scope has drifted into Sequence 5 (spec FR-018, SC-008; quickstart §4). Also confirm `git diff --stat` shows exactly two files changed, and assert spec FR-007 by confirming the diff introduces **no** new operator-facing input, manifest field, catalog field or host setting — every recorded value must come from state the platform already held
- [X] T032 [P] Add quickstart scenario 17 to `packages/server/src/__tests__/deployments/install-markers.test.ts`: uninstall the app and assert the whole data root is removed with `.hola/` inside it, leaving no orphan directory under the apps bind root. Covers the uninstall edge case ruled on in the spec's Clarifications — `removeAppData` (`packages/server/src/services/core/deployment.ts:3864-3872`) skips deletion when `dirHasContents` is false, and the reserved directory now makes a never-written data root non-empty, so this test pins the resulting behaviour
- [X] T033 [P] File follow-up issue: hoist the repeated release-manifest read in `materializeCompose` — six per-need reads of the same file per materialize via `readActiveIngressService`/`…Security`/`…GrantedContracts`/`…Consumes`/`…AppEnv` plus this feature's; a single hoisted read threaded through would be cleaner but touches five existing call sites, so it is its own change (research R2, R12.1). Record the issue number here: `#474`
- [X] T034 [P] File follow-up issue: `MockStorageService` discards file modes (`packages/server/src/services/core/storage.ts:378-382`) — it stores content in a `Map` and only logs `mode`, with no `stat`/`getMode` accessor, forcing every mode-sensitive test onto the real-filesystem harness (research R11, R12.2). Record the issue number here: `#475`
- [X] T035 [P] File follow-up issue: no operator-facing surface reports that a data root is unattributed — spec FR-016 warns in the server log when a record cannot be written, and an operator has no way to see it short of reading logs. **The issue body MUST state that the fix is a *reader* and therefore belongs with Sequence 5/6, explicitly out of scope for spec 006 under FR-018** (research R12.3). Record the issue number here: `#476`
- [X] T036 Record the three issue numbers from T033–T035 in this file, replacing each `#____` placeholder. **No inline TODOs anywhere in the source** — repository hard rule (CLAUDE.md, plan.md)
- [X] T037 **Final checkpoint.** Run `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build` and make it green. `typecheck` runs twice on purpose — CI has caught regressions a lint auto-fix introduced after the first pass (CLAUDE.md, Constitution VII). Record pre-existing baseline failures rather than chasing them

---

## Dependencies

```text
Phase 1 (T001)
    │
Phase 2 (T002→T007)  ← BLOCKING: builds the one helper + the one call site
    │
    ├──────────────┬────────────────┐
    ▼              ▼                │
Phase 3 (US1)   Phase 4 (US2)       │   ← independent of each other
 T008→T021       T022→T027          │
    │                               │
    ▼                               │
Phase 5 (US3) ──────────────────────┘
 T028→T030   (needs the identity record from Phase 3)
    │
    ▼
Phase 6 (T031→T037)
```

**The one dependency an implementer is most likely to get wrong**: US1 and US2
are independent *stories* but share a *single helper and single call site*, both
built in Phase 2. Do not create a second helper for the environment record.

**Sequential within a file**: T002–T010, T022–T024 and T028 all edit
`deployment.ts` and must be done in order, not in parallel. Test tasks marked
`[P]` all append independent `test(...)` blocks to one new file — they are
parallelizable in authoring but must be merged into a single file.

## Parallel Opportunities

- **Phase 3 ∥ Phase 4** once Phase 2 lands — different records, no shared state.
- **T013, T014, T015, T016, T017, T019, T020** — independent test cases.
- **T025, T026, T027** — independent test cases.
- **T029, T030** — independent test cases.
- **T033, T034, T035** — three `gh issue create` calls, no ordering.

## Implementation Strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1).** That alone makes every app data
folder self-describing and is independently shippable. Phase 4 (US2) is equal
priority and is what makes a restore *correct* rather than merely *possible* —
both should land in this change, but either could ship without the other.

**Ship order**: foundation → US1 → US2 → US3 → polish. Phase 5 is deliberately
last and deliberately trivial: it is one field, and its whole value is that it
cannot be retrofitted into captures taken before it ships.

## Scope Boundary — carry this into every task

Nothing reads these records in this feature (spec FR-018, SC-008). No contract
change, no catalog change, no manifest field, no API response change, no CLI
change, no UI change, no restore logic, no candidate detection. Sequences 5 and 6
are the consumers, and this feature is valuable precisely because it ships
without them. Any design element that implies a reader is a follow-up issue
(T032–T035), not part of this change.

**There are no GitHub issues to close for this feature.**

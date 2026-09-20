---

description: "Task list for spec 007 — Restore-on-Install from a Live Deployment"
---

# Tasks: Restore-on-Install from a Live Deployment

**Input**: Design documents from `/specs/007-restore-on-install/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. The spec's FRs demand test-backed verification and
`quickstart.md` supplies 57 numbered scenarios; test task descriptions cite those
numbers so a reviewer can check coverage mechanically.

**Closes**: `try-hola/hola#429`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: `[US1]`–`[US5]`, matching spec.md's user stories
- Every task names an exact file path

## Line numbers

**Use `research.md` and the verified anchors, never the original prompt's line
numbers** — they predate spec 006's merge (`921c790`) and several are wrong in
shape, not just position. The key ones:

| Thing | Line |
|---|---|
| `runLifecycleJob` deploy/start/rollback branch | `deployment.ts:3780-3821` |
| `writeOidcCredentialsFile` call (to be moved) | `deployment.ts:3800` |
| `composePull` / `isCancelled` / `composeUp` | `:3807` / `:3813` / `:3815` |
| deployment record literal, `channel,` | `:1008-1062`, `:1028` |
| `writeInstanceMarkers`, `lineageId` expression | `:3322-3402`, `:3374` |
| `capturePreUpgradeSnapshot` (Real) | `:2492-2578` |
| `runPreHooksFailClosed` / `runPostHooks` | `:2684-2701` / `:2709-2724` |
| draft appEnv seed: catalog / install-by-ref | `draft.ts:473` / `:606` |
| `canonicalSpec` / checksum / outside-spec comment | `draft.ts:886-906` / `:908` / `:932-943` |
| `composeUp` iface / Real / Mock | `docker.ts:67` / `:231-269` / `:722-725` |

---

## Phase 1: Setup

**Purpose**: There is no project initialization to do. One confirmation task only.

- [X] T001 Confirm the working branch is `007-restore-on-install` off `main` (`ca3d3f4` or later) and the tree is clean, via `git rev-parse --abbrev-ref HEAD && git status --porcelain`

---

## Phase 2: Foundational (BLOCKING — no user story can start until this is done)

**Purpose**: The shared spine every story rides on.

> **Read this before starting Phase 3.** US1 (restore the data) and US2 (carry the
> configuration) share **one** draft-seed call site and **one** restore sequence.
> They are separate user stories because they fail separately and deliver value
> separately — but they are **not** separate code paths. Phase 2 therefore carries
> the shared spine (types, the widened `composeUp`, the candidate module skeleton,
> `lineageId` on the record), and each story phase adds only its own behaviour and
> its own tests on top. An implementer who builds a second restore path for US2
> has misread this; there is exactly one.

- [X] T002 [P] Add `RestoreChoice`, `RestoreCandidate`, `RestoreSkewVerdict`, `RestoreRefusalCode`, `RestoreWarning` and `AppRestoreDeclaration` to `packages/shared/src/index.ts` per data-model.md §1–§5, §7
- [X] T003 [P] Add `restoreFrom?: RestoreChoice` to `CreateDraftRequest` (`packages/shared/src/index.ts:1299-1316`) and to `Draft` (`:1220-1297`); leave `PatchDraftRequest` (`:1339`) closed to its existing four fields
- [X] T004 [P] Add `restoreFrom?: RestoreChoice` to `FinalizedManifest` in `packages/server/src/services/core/draft.ts:56-124`
- [X] T005 [P] Add `lineageId?: string`, `restoreFrom?: RestoreChoice` and `restoredAt?: string` to `EnhancedDeploymentDetail` (`packages/shared/src/index.ts:2017-2076`), all optional so every record already on disk stays valid with no migration
- [X] T006 Widen `composeUp` to `{ services?: string[]; wait?: boolean; timeoutMs?: number }` in the interface at `packages/server/src/services/core/docker.ts:67` and the Real implementation at `:231-269`, emitting `docker compose … up -d [--wait] [services…]`; keep `profiles` travelling via `COMPOSE_PROFILES` (`withComposeProfiles`, `:192-195`), NOT a CLI flag; `timeoutMs` overrides the 5-minute `execAsync` cap at `:248` because a `--wait` on a freshly-`initdb`'d Postgres can exceed it (research R12)
- [X] T007 Update `MockDockerService.composeUp` at `packages/server/src/services/core/docker.ts:722-725` to accept the new options and **record** the requested services and wait flag on the instance so tests can assert on them — plan.md's "Known trap": a Mock that accepts and ignores `services` yields a green suite over a restore that starts the wrong containers (Constitution IV)
- [X] T008 Create `packages/server/src/services/core/restore-candidates.ts` with the candidate resolver's shape: eligibility predicate, description merge (identity record first, deployment record fallback), lineage grouping/ordering, skew verdict, required-acknowledgement derivation. Pure functions over already-fetched state — no I/O, no app names (Constitution V)
- [X] T009 Persist `lineageId` on the deployment record in `createFromDraft` (`packages/server/src/services/core/deployment.ts`, record literal `:1008-1062`, beside `channel,` at `:1028`): the candidate's lineage on a restore, else the deployment's own id
- [X] T010 Change `writeInstanceMarkers`' `lineageId` expression at `packages/server/src/services/core/deployment.ts:3374` from `deployment.id` to `deployment.lineageId ?? deployment.id`, and update the comment at `:3366-3373` — which explicitly predicted this change — to say it has now happened and to name spec 007. The `??` fallback is what makes this zero-migration: an older record reads `undefined` and yields exactly the value it always wrote

**Checkpoint**: `bun --cwd packages/server test` green; `bun run typecheck` green.

---

## Phase 3: User Story 1 — An operator installs an app and gets their data back (P1)

**Goal**: Pick a candidate during install; the app comes up holding its data.

**Independent test**: Install an app, put recognisable data in it, install a second
copy restoring from the first, confirm the second serves that data on first boot.

### Candidate discovery + route

- [X] T011 [US1] Implement candidate eligibility in `packages/server/src/services/core/restore-candidates.ts` per data-model.md §2: same app, not self, settled state (`running`/`stopped` — not in flight, not `error`), and `dirHasContents(appRoot, [INSTALL_MARKERS_DIR])`. The ignore-list is load-bearing — without it every materialised install looks like it holds data, which is the data-loss shape spec 006's review caught at `deployment.ts:2513`
- [X] T012 [US1] Implement candidate description in `restore-candidates.ts`: read `.hola/instance.json`, fall back per-field to the deployment record, set `hasIdentityRecord`, degrade `lineageId` to the deployment id when the record is absent (FR-003)
- [X] T013 [US1] Implement lineage grouping and newest-first ordering in `restore-candidates.ts`, with `defaultCandidateId: null` + `requiresExplicitChoice: true` when two or more lineages match (FR-005, FR-036)
- [X] T014 [US1] Add `GET /api/apps/:appId/restore-candidates` to `packages/server/src/server.ts` per contracts/api.md §1, with the optional `?version=` query; return `200` with `lineages: []` when there are none — never `404` (FR-042)

### Draft entry + persistence

- [X] T015 [US1] Accept `restoreFrom` on the catalog draft path in `packages/server/src/services/core/draft.ts` at the `resolvePlatformTokens` seed site (`:473`), resolving and validating the candidate before seeding
- [X] T016 [US1] **Refuse** `restoreFrom` on the install-by-ref path (`draft.ts:606`) with `RESTORE_NOT_SUPPORTED` — never ignore it. Honouring it on one seed path and dropping it on the other is exactly the silent-empty-restore failure the spec exists to prevent (research R2)
- [X] T017 [US1] Carry `restoreFrom` onto the finalized manifest **outside** `canonicalSpec` in `draft.ts:932-943`, beside `channel`, and extend that comment to cover it so the checksum stays a pure function of the deployable spec (FR-009)
- [X] T018 [US1] Re-validate the restore choice in `createFromDraft` (`deployment.ts:915`) before any state is created — the candidate may have been deleted or started a lifecycle action since the draft — and persist `restoreFrom` onto the record (FR-010)

### The restore sequence

- [X] T019 [US1] Implement the restore sequence in `runLifecycleJob`'s deploy/start/rollback branch (`deployment.ts:3780-3821`), inserted after the cancellation check at `:3813` and before `composeUp` at `:3815`, in exactly the ten-step order of research R8: assert target empty → re-resolve candidate → quiesce + capture → extract → assert payload present → discard → rewrite marker → write OIDC file → `up --wait` hook services → run restore hooks
- [X] T020 [US1] Guard the whole sequence on `restoreFrom && !restoredAt` **and** the action being the deployment's first deploy, so a restart/promote/rollback never re-runs it and a retried job cannot re-quiesce a live source (FR-012, data-model.md §8)
- [X] T021 [US1] Implement capture staging in `deployment.ts`: tar the source's data root to a staging file under the **target** deployment's own directory, distinct from the snapshot store, deleted in a `finally` on success and failure alike. Extract straight into the target data root — the archive is root-relative (`tar -C <dir> .`), so there is no intermediate extracted copy and peak cost is one archive (research R7, FR-016a, SC-013)
- [X] T022 [US1] **Move** the `writeOidcCredentialsFile` call from `deployment.ts:3800` into the restore sequence, after extraction — conditionally, so that an install with no restore keeps the call exactly where it is today (FR-019, FR-023, research R10)
- [X] T023 [US1] Rewrite `.hola/instance.json` after extraction and discards by calling the existing `writeInstanceMarkers` (`:3322`), which already computes every field correctly. Two independent reasons it is required: extraction `rm -rf`s the root and destroys the marker, and the restored tree carries the **source's** record (FR-018, research R11)
- [X] T024 [US1] Set `restoredAt` on the deployment record on success (data-model.md §6)
- [X] T025 [US1] Fail the install on any restore failure, with no fallback to starting the app on an empty or partial root (FR-022)

### Tests (US1)

- [X] T026 [P] [US1] `packages/server/src/__tests__/deployments/restore-on-install.test.ts` — set up the **real-filesystem harness** (`RealStorageService` + `mkdtemp` + `HOLA_APPS_BIND_ROOT`), copied from `install-markers.test.ts:116-142` or `snapshot.test.ts:99-125`. Required because `MockStorageService` discards file modes (#475) and `MockDockerService` starts no containers
- [X] T027 [P] [US1] Tests for quickstart **scenarios 1–4** (candidate listing, identity-record fallback, marker-only root excluded, unsettled/error states excluded) in `restore-on-install.test.ts` — U-fs
- [X] T028 [P] [US1] Tests for quickstart **scenarios 5, 6, 7** (lineage grouping/ordering/explicit-pick; works with no provider installed; empty list is `200` not `404`) in `restore-on-install.test.ts` — **mixed modes**: 5 and 7 are pure unit, but **6 is U-fs** and needs the real-filesystem harness
- [X] T029 [P] [US1] Tests for quickstart **scenarios 8, 9** (catalog path accepts, install-by-ref refuses with `RESTORE_NOT_SUPPORTED`; patch and finalize still closed) in `restore-on-install.test.ts`
- [X] T030 [P] [US1] Test for quickstart **scenario 11** (two finalizes differing only in `restoreFrom` produce the **same** checksum) in `restore-on-install.test.ts`
- [X] T031 [P] [US1] Tests for quickstart **scenarios 12, 13, 14** (record carries `restoreFrom`+`lineageId` and the payload is unchanged; fresh vs restored `lineageId`; `restoredAt` makes later actions skip) — U-fs
- [X] T032 [P] [US1] Tests for quickstart **scenarios 15, 16** (restore runs between `composePull` and `composeUp`; non-empty target aborts with `RESTORE_TARGET_NOT_EMPTY` while a marker-only root proceeds) — U-fs
- [X] T033 [US1] Test for quickstart **scenario 18** — **highest value**. Proves FR-016 is a post-condition assertion and not a subtree search: with the archive emptied the install must fail `RESTORE_PAYLOAD_EMPTY` rather than report success. The prompt's "locate the subtree at `<staging><candidate.path>`" describes a provider archive tool and cannot occur with this codebase's root-relative helpers (research R9). U-fs — real-filesystem harness
- [X] T034 [P] [US1] Test for quickstart **scenario 19** (staging lives under the target, is gone after success and failure, never appears in the source's snapshot listing) — U-fs
- [X] T035 [US1] Test for quickstart **scenario 22** — **highest value**. The OIDC ordering trap. It MUST be written so that it **fails** if the `writeOidcCredentialsFile` call is left at `:3800`; a test that passes either way tests nothing. Verify by temporarily reverting T022 and watching it go red. U-fs — real-filesystem harness
- [X] T036 [US1] Test for quickstart **scenario 23** — asserts `MockDockerService` **records** `services` and `wait` and that `{services:['db'],wait:true}` starts nothing else. This is plan.md's "Known trap" (Constitution IV)
- [X] T037 [US1] Test for quickstart **scenario 27** — **highest value**. The regression guard: with no `restoreFrom`, the deploy job's calls and their order are identical to `main`'s, including `writeOidcCredentialsFile`'s original position (FR-023, SC-009)
- [X] T038 [P] [US1] Tests for quickstart **scenarios 21, 25** (restored marker describes the new install while `lineageId` is the source's; every failure leaves a failed install) — U-fs

**Checkpoint**: US1 independently testable — a restore works end to end for a
plain-file-copy app, with no configuration carried and no app declaration.

---

## Phase 4: User Story 2 — The restored app can read the data it was given (P1)

**Goal**: Carried configuration means data encrypted under a generated value stays readable.

**Independent test**: Restore an app storing something encrypted under a generated
key and read that item back through the app.

> **Shares US1's spine.** The seeding happens at the same `draft.ts` call site
> T015 touched, and the restore sequence is unchanged. This phase adds the env
> read, the merge, the derived warning and the acknowledgement gate — not a second
> code path.

- [X] T039 [US2] Read the candidate's environment record from `<appsBindRoot>/.hola/<candidateId>/env.json` in `draft.ts` — **outside** the app data root, which is where spec 006 actually shipped it (`envRecordDirFor`, `deployment.ts:2474-2475`), not inside it as the prompt of record assumed (research R17)
- [X] T040 [US2] Seed `appEnv` through the existing `mergeUpgradeAppEnv` (`packages/server/src/services/core/upgrade-env.ts:35-44`) unchanged — carried value wins, a new key with a `generate` recipe is minted, anything else rides through. This adds a second production call site beside `server.ts:1295`
- [X] T041 [US2] Derive the uncarried-configuration warning in `restore-candidates.ts`: exactly the `AppEnvVar` entries (`shared/src/index.ts:903-958`) where `isSecret === true` **and** `generate` is present. Derived, never declared — a manifest field would rot and an app author could get it wrong (FR-033)
- [X] T042 [US2] Implement the two acknowledgement codes (`restore-version-unknown`, `restore-env-not-carried`) in `restore-candidates.ts` + `createFromDraft`, computed server-side and enforced exactly as `grants` already are on `CreateDeploymentFromDraftRequest` (`shared/src/index.ts:2257-2289`) — refused when required and absent (FR-037a, research R16)
- [X] T043 [US2] Default the new install's `name` and `subdomain` from the candidate, and emit a `host-divergence` warning when the operator changes the subdomain (FR-035)

### Tests (US2)

- [X] T044 [P] [US2] Test for quickstart **scenario 10** (the three-case merge: carried wins, generate-recipe key minted, other new key rides through) — U-fs
- [X] T045 [P] [US2] Tests for quickstart **scenarios 38, 43** (the warning names exactly the `isSecret && generate` keys — not every secret; declining available configuration still warns and still requires the acknowledgement) — U-fs
- [X] T046 [P] [US2] Tests for quickstart **scenarios 40, 42** (name/subdomain default and divergence warning; a required-and-absent acknowledgement fails with `RESTORE_ACK_REQUIRED`)

**Checkpoint**: US2 independently testable — a restored install's configuration
matches its source's, and every uncarried key is named.

---

## Phase 5: User Story 3 — A restore that cannot be right refuses before the app starts (P1)

**Goal**: Every unsafe restore fails loudly, before any container runs.

**Independent test**: Drive each refusal and confirm the install fails, the reason
is specific, and no app container started.

- [X] T047 [US3] Implement the skew verdict in `restore-candidates.ts` in the order of data-model.md §4, evaluating **source-newer before** `checkUpgradePath`. `checkUpgradePath` (`shared/src/index.ts:423-460`) short-circuits on `!isNewerVersion(to, from)` and returns `ok` for a newer source, so evaluating it first would let the case through (research R15)
- [X] T048 [US3] Implement `RESTORE_SOURCE_NEWER` (refuse always) and `RESTORE_UPGRADE_PATH` (refuse, surfacing `suggestedVersion`), reusing `checkUpgradePath` verbatim for the two rows it can express — a third production call site beside `deployment.ts:1104` and `:3178` (FR-029, FR-030)
- [X] T049 [US3] Implement the unknown-version path: proceed only with `restore-version-unknown`, else `RESTORE_ACK_REQUIRED` naming it (FR-032)
- [X] T050 [US3] Implement `RESTORE_ENV_REQUIRED`: an app whose `restore` block sets `requiresEnv: true` **refuses** when there is no environment record, rather than warning (FR-034)
- [X] T051 [US3] Implement `RESTORE_CANDIDATE_GONE` and `RESTORE_CANDIDATE_BUSY` on re-resolution inside the job (research R8 step 2), so a candidate deleted or made busy between choice and deploy fails the install rather than being captured optimistically. Covers quickstart **scenario 16a** — U-fs, real-filesystem harness (FR-013a)
- [X] T052 [US3] Run restore hooks fail-closed via the existing `runPreHooksFailClosed` policy (`deployment.ts:2684-2701`) with started-only cleanup (`runPostHooks`, `:2709-2724`), failing the install with `RESTORE_HOOK_FAILED` on a hook failure or a hook service that never becomes healthy (FR-021)
- [X] T053 [US3] Ensure a failed restore leaves the deployment in `error` with its data root intact — no automatic deletion — and that such a deployment is thereafter excluded from candidacy (FR-022a, research R20)
- [X] T054 [US3] Ensure every refusal carries `details.code` (and `suggestedVersion` where applicable) in the same `CONFLICT` envelope as `PROVIDER_EXISTS`/`ALREADY_INSTALLED`, so clients build guidance from structure (FR-037)

### Tests (US3)

- [X] T055 [US3] Test for quickstart **scenario 34** — **highest value**. Must assert *directly* that `checkUpgradePath(newer, older, meta)` returns `ok`, so the test itself documents why FR-029 is stated independently rather than delegated
- [X] T056 [P] [US3] Tests for quickstart **scenarios 35, 36, 37** (guarded hop refuses with `suggestedVersion`; equal and clean-path proceed; unknown version gated on its acknowledgement)
- [X] T057 [P] [US3] Tests for quickstart **scenarios 39, 41** (`requiresEnv` refuses; every refusal carries `details.code`)
- [X] T058 [P] [US3] Test for quickstart **scenario 26** (failed restore stays in `error`, keeps its data root, and drops out of the candidate list) — U-fs, real-filesystem harness

**Checkpoint**: US3 independently testable — every refusal path verified without
a container ever starting.

---

## Phase 6: User Story 4 — An app says how it wants to be restored (P2)

**Goal**: Discards and hooks make restore correct for database-backed apps.

**Independent test**: Restore an app whose declaration discards the captured
database directory and loads a dump; confirm the result holds the dumped data.

- [X] T059 [US4] Implement `AppRestoreDeclaration` reading in `deployment.ts`, keyed by **backup** participation id, reusing `AppBackupHook` (`shared/src/index.ts:295-298`) verbatim — no second hook format (FR-026, FR-027)
- [X] T060 [US4] Implement the three declaration states: no `restore@1` ⇒ not offered; `restore@1` with no block ⇒ plain file copy, no discards, no hook; `restore@1` + block ⇒ apply it. The middle state already exists on 12 of 17 catalog acceptors, so this gives an existing shape meaning rather than requiring adoption (FR-025)
- [X] T061 [US4] Apply `discard` paths after extraction and before any container starts, resolving each through `resolveContainedDir` (`packages/server/src/services/core/path-containment.ts:30`) exactly as push targets do (`deployment.ts:2952`); a path resolving outside the data root **refuses** the restore rather than being skipped (FR-017)
- [X] T062 [US4] Start only the hook services with `{ services, wait: true, timeoutMs }` and run each participation's restore hook against them, relying on the app's own declared `healthcheck` rather than any bespoke readiness poll — per-app readiness knowledge in the server is exactly what Constitution V forbids (FR-020)
- [X] T063 [P] [US4] Prepare the catalog change in `/workspaces/apps` — `schemas/manifest.schema.json` gains the `restore` array referencing the existing `$defs/backupHook`, and the five hook apps (guacamole, immich, mealie, paperless-ngx, postiz) gain a `restore` block per contracts/manifest.md. **Read each app's own `compose.yaml` for its `discard` path — do not assume mealie's `postgres`**; the mount point is per-app and a wrong path either discards nothing or discards the wrong directory. Every hook needs `-v ON_ERROR_STOP=1`. **STOP after preparing the diff and report it — do NOT open a PR on `try-hola/apps`** (repository hard rule: no PR on a repo without the user's explicit per-instance permission)

### Tests (US4)

- [X] T064 [P] [US4] Tests for quickstart **scenarios 20, 29** (discards applied before any container starts; escaping path refuses; two participations both restore) — U-fs
- [X] T065 [P] [US4] Tests for quickstart **scenarios 30, 31, 32** (no-block plain copy vs. undeclared app; hook shape is `AppBackupHook` with no second type in `shared`; every current catalog manifest still validates and a `restore` block validates) — **mixed modes**: 31 and 32 are pure unit, but **30 is U-fs** and needs the real-filesystem harness

**Checkpoint**: US4 independently testable at the unit level; scenario 33 (a real
Postgres restore) is covered by the manual VM task.

---

## Phase 7: User Story 5 — Clone an app with its data, from the command line (P2)

**Goal**: One command produces a second copy holding the source's data. Closes #429.

**Independent test**: From the CLI, install a second copy naming the first as the
source; confirm it is independently addressable and holds the data while the
source keeps running.

- [X] T066 [P] [US5] Register `--restore-from <id|latest>`, `--no-restore`, `--restore-list`, `--carry-env`/`--no-carry-env` and `--ack <code>` in `packages/cli/src/index.ts` beside the existing `--grant` registration at `:163`
- [X] T067 [US5] Parse them in `packages/cli/src/commands/install/install.ts`, mirroring `parseGrants` (`:82-93`) for the repeatable/comma-separated `--ack`
- [X] T068 [US5] Implement `--restore-list` against the candidates route with **no draft created**, rendering per contracts/cli.md and naming on each warning line the flag that would satisfy it
- [X] T069 [US5] Make the non-interactive default **no restore** (FR-044): with no restore flag, no restore happens even when candidates exist. A candidate existing is not consent, and silence must never overwrite an operator's install decision with a guess
- [X] T070 [US5] Refuse `--restore-from latest` when two or more lineages match — "latest" is ambiguous across unrelated histories (FR-036)
- [X] T071 [US5] Build every restore refusal hint from `details` in `packages/cli/src/lib/deploy-flow.ts`, never from the server's message, per the rule and reasoning already at `:137-155`; one branch per `RESTORE_*` code (FR-045)

### Tests (US5)

- [X] T072 [P] [US5] Tests for quickstart **scenarios 49, 50** (each flag behaves as specified, `latest` refuses across lineages; no flag ⇒ no restore even with candidates present) in `packages/cli`
- [X] T073 [P] [US5] Tests for quickstart **scenarios 51, 52** (hint correct from `details` alone with the message blanked; `--ack` parses repeated and comma-separated exactly as `--grant`) in `packages/cli`

**Checkpoint**: US5 independently testable; #429's outcome reachable in one command.

---

## Phase 8: Polish & Cross-Cutting

### Wizard

- [X] T074 Add the restore step at index 0 of `steps` in `packages/web/src/pages/InstallWizard.tsx:29-36`, before Configuration — forced, because Configuration renders `appEnv` and `appEnv` is seeded by the restore choice (FR-038)
- [X] T075 Re-create the draft when the restore choice changes, following `switchChannel`'s existing delete-and-recreate pattern at `InstallWizard.tsx:507-549`; this is the established pattern, not a workaround (FR-039)
- [X] T076 Render carried values as ordinary `appEnv` rows through the existing mask/reveal component (`:1187-1372`), with no separate or privileged widget (FR-040)
- [X] T077 Add acknowledgement checkboxes and the unconditional summary-step acknowledgement naming data **and credentials** and that jobs, webhooks and integrations may fire on start (FR-041)
- [X] T078 [P] Web tests for quickstart **scenarios 44–48** in `packages/web/src/__tests__/pages/`

### Manual verification

- [ ] T079 **MANUAL — NOT part of the default suite.** Run quickstart **scenarios 17, 24, 28, 33, 53, 56** on a disposable VM (`bin/vm-e2e-suite` / the `vm-e2e` skill): source untouched after capture; failing hook aborts the install; end-to-end mealie restore; real Postgres discard-and-load; #429 clone-with-data; a whole restore with no backup provider installed. These need real containers and a real database. Record the outcome in the PR body

### Docs

- [X] T080 [P] Document restore-on-install in `docs/OPERATIONS.md` — what it does, when it refuses, and that a restore carries credentials as well as data
- [X] T081 [P] Add a bullet to the `CLAUDE.md` architecture notes covering restore-on-install, in the style of the existing capability-contract and release-channel bullets

### Follow-up issues (no inline TODOs — repository hard rule)

- [X] T082 [P] `gh issue create` — the dead `POST /api/backups/:id/restore` stub (`server.ts:1663-1668`) fabricates a jobId and creates no job; `RestoreBackupRequest`/`Response` and `JobType`'s `'restore'` are unused; `Backups.tsx`/`useBackupsApi.ts`/`BackupCoverage.tsx` talk to it. Note the vocabulary adjacency to spec 007 and point at #160. Record the issue number here: `#484`
- [X] T083 [P] `gh issue create` — `install-markers.test.ts:704` cites `~:3410`/`~:3414` for the restore-before-materialize ordering; the real lines are `:3793`/`:3797`. The ordering claim still holds. Propose the comment cite symbols rather than line numbers, since this is direct evidence that line-number comments rot. Record: `#485`
- [X] T084 [P] `gh issue create` — Sequence 6 inherits the absolute-path subtree trap: a provider archive tool (restic/borg) reproduces the source's absolute path under the restore target, so its payload is NOT at the staging root. Spec 007's FR-016 post-condition assertion is what generalises. Record: `#486`
- [X] T085 [P] `gh issue create` — `composeUp`'s 5-minute `execAsync` default (`docker.ts:248`) deserves a deliberate look now that one caller parameterises it; the other call sites inherit it by accident rather than by decision. Record: `#487`

### Scope boundary + gate

- [X] T086 Verify the scope boundary with quickstart §9's greps: `git diff main -- packages/shared/src/contracts.ts` empty (no capability contract added, FR-047); `git diff main -- packages/web/src/pages/Backups.tsx packages/web/src/hooks/useBackupsApi.ts` empty (dead stub untouched); `grep -rniE "postgres|mealie|immich|gitea|paperless" packages/server/src/services/core/restore-candidates.ts` empty (no app name leaked into the platform — the mechanical form of plan.md's Principle V audit)
- [X] T087 Test for quickstart **scenarios 54, 55** — `CONTRACTS` still exactly `auth@1`/`backup@1`/`push@1`/`container-logs@1`, no new grant kind, no `/api/contracts/*` change, `JobType` unchanged; nothing in this feature imports `RestoreBackupRequest`
- [X] T088 Final gate: `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build`. Typecheck twice — CI has caught regressions a lint auto-fix introduced after the first run

---

## Dependencies

```
Phase 1 (T001)
   └─> Phase 2 (T002-T010)   BLOCKING — the shared spine
          ├─> Phase 3 US1 (T011-T038)   P1  ← MVP
          │      └─> Phase 4 US2 (T039-T046)   P1   shares US1's seed site + sequence
          │      └─> Phase 5 US3 (T047-T058)   P1   guards US1's sequence
          │             └─> Phase 6 US4 (T059-T065)   P2   discards/hooks need US3's fail-closed
          ├─> Phase 7 US5 (T066-T073)   P2   needs T014's route + T015's draft field only
          └─> Phase 8 (T074-T088)
```

**Story independence.** US1 is a complete MVP alone. US2, US3 and US4 each extend
US1's single restore sequence rather than adding their own — this is stated three
times on purpose, in Phase 2's note, in Phase 4's note, and here. US5 is the only
story reachable without the restore sequence being finished, since `--restore-list`
needs just the candidates route.

**Within-phase parallelism.** `[P]` tasks touch different files. The largest
parallel batches: T002–T005 (four independent type additions), and the test tasks
inside each story phase once that story's implementation lands. T006 and T007 are
**not** parallel with each other — same file, and T007 depends on T006's signature.

## Implementation strategy

1. **MVP** = Phase 1 + Phase 2 + Phase 3 (US1). A working restore for the 12
   plain-file-copy catalog apps, with no configuration carried.
2. **Make it safe** = Phase 5 (US3). Land before Phase 4 if time is short: an
   unsafe restore that proceeds is worse than one that cannot carry configuration.
3. **Make it correct for databases** = Phase 4 + Phase 6.
4. **Reach** = Phase 7 + Phase 8.

## Task count

| Phase | Tasks |
|---|---|
| 1 Setup | 1 |
| 2 Foundational | 9 |
| 3 US1 (P1) | 28 |
| 4 US2 (P1) | 8 |
| 5 US3 (P1) | 12 |
| 6 US4 (P2) | 7 |
| 7 US5 (P2) | 8 |
| 8 Polish | 15 |
| **Total** | **88** |

All 57 quickstart scenarios are cited by a test task. The six VM-mode scenarios
(17, 24, 28, 33, 53, 56) are consolidated into T079 and are explicitly **not**
part of the default suite.

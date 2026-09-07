# Tasks: Contract Cardinality and the Container-Logs Contract

**Input**: Design documents from `specs/004-contract-cardinality/` (issues #426, #245)

**Prerequisites**: plan.md, spec.md, research.md (R1–R12 + test strategy R10), data-model.md, contracts/{api,manifest,compose,web}.md, quickstart.md

**Tests**: Requested. Spec SC-001…SC-008 require automated coverage for coercion, the broker's ordering/cleanup/reporting, the provider guard, coverage judgement and rendering, the container-logs grant and validator pins, labels, the implicit rollup, and the proxy. Test tasks precede implementation within each story and MUST fail before the implementation task lands.

**Organization**: Grouped by user story in the order the prompt sequenced the work: vocabulary → coercion + runner (US1) → guard (US3) → coverage (US2) → labels (US5) → container-logs (US4) → implicit rollup (US6) → docs, follow-ups, gates.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US6 from spec.md
- Paths are repository-relative. Server tests: `bun --cwd packages/server test <file>`; web/CLI tests: `cd packages/{web,cli} && npx vitest run <file>`; run tests in the **foreground**.

## Hard invariants (from CLAUDE.md / constitution — bind every task)

- Bun workspaces; **no new dependencies**.
- Remote catalog only; `MockCatalogService` stays empty; tests inject stubs.
- Per-deploy work (labels, grant injection) runs in `materializeCompose` inside the lifecycle job, never at create time. Create-time guards have no side effects.
- Real/Mock pairs: new guard logic lives in `RealDeploymentService` overrides; base classes stay permissive.
- No per-app special cases anywhere in the server (no `postiz`, no app ids); recognise image families, match contract refs.
- `CONTRACTS` stays a closed set; unknown or implicit-`accepts` refs degrade with a warning, never a failure.
- `validateVolumes` is not weakened; the platform's post-validation injection is the only path to the socket; the sidecar never joins `hola` or publishes ports (Traefik-only ingress).
- Every published singular `backup` manifest and every on-disk release manifest keeps working; readers go through `backupParticipations`.
- Deferred work becomes a GitHub issue, never an inline TODO.
- Gates before PR: `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build`.

---

## Phase 1: Setup

- [X] T001 Record the baseline: run `bun run test` in the foreground from the repo root on the unchanged branch and note any pre-existing failures under "Baseline" at the bottom of `specs/004-contract-cardinality/tasks.md`, so later runs are compared against it.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Shared vocabulary and wire types every story reads.

- [X] T002 Extend `packages/shared/src/index.ts` per `data-model.md` "Wire types": add `AppBackupParticipation = { id: string; preHook?: AppBackupHook; postHook?: AppBackupHook }` and `AppBackupDeclaration = AppBackupConfig | AppBackupParticipation[]` beside `AppBackupConfig` (~line 309, keep `AppBackupConfig` documented as the singular form); change the `backup?:` field on `GetCatalogAppVersionDetailResponse` (~line 990) and `Draft` (~line 1173 block) to `AppBackupDeclaration`, and likewise `FinalizedManifest.backup` in `packages/server/src/services/core/draft.ts` (~line 103); add `BackupCoverageState = 'quiesced' | 'partial' | 'as-is' | 'uncovered'` and `ContractCoverage = { state; targeted: number; recognised: number; participations: Array<{ id: string; service?: string }>; databases: string[] }`; add `coverage?: Record<string, ContractCoverage>` to `DeploymentContracts` (~line 2035) and `coverage?: ContractCoverage` to `ContractParticipant` (~line 2057), marking `hooks` on both `@deprecated` in the doc comment (still emitted); add `participation: 'declared' | 'implicit'` and `providerConflict?: true` to `ContractRollup` (~line 2077); add `participations: Array<{ deploymentId: string; participationId: string }>` to `ContractBackupPrepareResponse` (~line 2009) and `participationId: string` to `ContractBackupFinalizeResponse.results[]` (~line 2024); add `'RESERVED_SERVICE_NAME'` to the compose validation issue code union (~line 1805). Run `bun run typecheck` and fix every compile error this causes by deferring to `backupParticipations` (T003) where a reader assumed the object shape.
- [X] T003 Extend `packages/shared/src/contracts.ts`: add `participation: 'declared' | 'implicit'` to `ContractDefinition` (required; document it as "whether an app opts in via `accepts`, or is a subject by virtue of running") and set `declared` on `auth@1`, `backup@1`, `push@1`; widen `ProviderGrantKind` to `'apps-data' | 'container-logs'`; add the `container-logs@1` entry exactly as research.md R9 (shape `provisioned`, providerKind `app`, participation `implicit`, no `acceptorBlock`, the `container-logs` grant with the R9 label/risk text, summary); export `CONTAINER_LOGS_CONTRACT_REF = 'container-logs@1'`; add and export `backupParticipations(value: unknown): AppBackupParticipation[]` (array → filtered to well-formed entries in order; singular object with at least one hook → `[{ id: 'default', ...hooks }]`; anything else → `[]`); add `DATABASE_IMAGE_FAMILIES` (R5 list, `as const`), `isDatabaseImage(imageRef: string): boolean` (strip registry/path/tag/digest, lower-case last segment; equal, `family-*` or `*-family`), and `judgeBackupCoverage(input: { accepts: boolean; participations: AppBackupParticipation[]; databaseServices: string[] }): ContractCoverage` implementing the data-model state table (targeted = distinct `databaseServices` named by some participation's **pre-hook** `service`); add `PLATFORM_LABEL_APP = 'sh.hola.app'`, `PLATFORM_LABEL_DEPLOYMENT = 'sh.hola.deployment'`, `PLATFORM_LABEL_NAME = 'sh.hola.name'`, `PLATFORM_LABEL_PREFIX = 'sh.hola.'`.
- [X] T004 [P] Extend `packages/server/src/__tests__/bundles/contracts.test.ts` for the vocabulary: the table now names four contracts with `container-logs@1` provisioned/app/implicit and a `container-logs` grant; every definition has `participation`; `providerGrantsFor(['container-logs@1'])` returns the grant; `grantsInclude([...], 'container-logs')`; `backupParticipations` on a singular object, an array, an array with a hookless entry, and junk; an `isDatabaseImage` table (`postgres:17-alpine` ✓, `bitnami/postgresql:16` ✓, `ghcr.io/immich-app/postgres:14-vectorchord0.3.0` ✓, `mysql/mysql-server:8` ✓, `timescale/timescaledb-ha:pg16` ✓, `mongodb/mongodb-community-server:7` ✓, `nginx:1.27` ✗, `redis:7` ✗, `postgrest/postgrest:v12` ✗, `ghcr.io/org/app@sha256:…` ✗); a `judgeBackupCoverage` table covering every row of the data-model state table including the postiz shape (accepts, one participation on `postiz-postgres`, databases `[postiz-postgres, temporal-postgres]` → `partial`, 1/2), post-hook-only participation counts nothing, two pre-hooks on one service count once.

**Checkpoint**: `bun run typecheck` green across packages; `contracts.test.ts` green.

---

## Phase 3: User Story 1 — An app with two databases is backed up consistently (Priority: P1) 🎯 MVP

**Goal**: Plural participations coerced from either manifest form; the broker and the pre-upgrade snapshot run them in order, fail-closed with started-only cleanup, and report per participation.

**Independent test**: `contract-broker.test.ts` with a two-participation stub manifest: exec order, cleanup coverage on failure, per-participation results; the singular fixture unchanged.

### Tests for User Story 1

- [X] T005 [P] [US1] Extend `packages/server/src/__tests__/bundles/manifest-backup.test.ts`: singular block → `[{ id: 'default', preHook, postHook }]`; plural block keeps order and ids; a plural entry with a missing/blank `id` is dropped; a duplicate `id` keeps the first and drops the second; an entry with no well-formed hook is dropped; an all-dropped plural block → `undefined`; a hook-shape violation inside a plural entry drops only that hook (existing behaviour, now per entry). Where the coercer logs, capture warnings with a spy logger (pattern from `contracts.test.ts` `makeSpyLogger`) if `coerceManifestBackup` gains a logger parameter (T007 decides; if it stays logger-free, assert drops only).
- [X] T006 [P] [US1] Extend `packages/server/src/__tests__/deployments/contract-broker.test.ts` (keep every existing test and the singular `PG_BACKUP` fixture untouched): a `PLURAL_BACKUP: AppBackupParticipation[]` fixture with `app-db` (service `postiz-postgres`) then `temporal-db` (service `temporal-postgres`); "runs both pre-hooks in declaration order and both post-hooks on finalize" asserting `execs` order and that `finalizeContractBackup().results` has two entries with `participationId` `app-db` and `temporal-db`; "a failing second pre-hook fails the job, runs the post-hooks of app-db and temporal-db, and never starts a third" (three participations; make `ExecSpy.failFor` match on service name as well as project); assert the job `error` contains `1 of 3 participation(s)` and `<deploymentId>/temporal-db`; "prepare response lists participations in execution order" (`participations` and `apps` distinct ids); "two apps run in ascending deployment id order" (two deployments, assert `execsFor('pre')` order); "singular manifest reports participation `default`" (finalize result `participationId === 'default'`, exec sequence identical to the pre-existing test); "finalize keeps going past a failing post-hook" (first post-hook fails: the second still runs, its result is `ok: true`, the failing one `ok: false` with `output`, and the response `ok === false`) — FR-008.
- [X] T007 [P] [US1] Extend `packages/server/src/__tests__/deployments/snapshot.test.ts`: with a two-participation outgoing release, `capturePreUpgradeSnapshot` runs both pre-hooks before the tar and both post-hooks after; when the second pre-hook fails it throws, runs the post-hooks of the two started participations and not a third; with the singular fixture behaviour is unchanged.

### Implementation for User Story 1

- [X] T008 [US1] Rewrite `coerceManifestBackup` in `packages/server/src/services/core/manifest-backup.ts` to return `AppBackupParticipation[] | undefined`: accept a plain object (singular → one participation `default`) or an array (each entry: `id` via `asString`, first wins as in `manifest-push.ts:71-78`, at least one hook survives) and drop everything else; add an optional `logger?: Logger` + context parameter and `warn` on each drop (`'Dropping backup participation'` with `{ appId, version, id?, reason }`); update the call site in `packages/server/src/services/core/catalog.ts` (~line 743) to pass `this.logger, { appId, version }`. Keep `AppBackupHook` coercion rules unchanged.
- [X] T009 [US1] Refactor the runner in `packages/server/src/services/core/deployment.ts`: replace `backupAcceptors(phase)` (~line 2123) with `backupParticipants(): Promise<Array<{ deploymentId: string; participationId: string; preHook?: AppBackupHook; postHook?: AppBackupHook }>>` — running deployments that accept `BACKUP_CONTRACT_REF`, participations via `backupParticipations(manifest.backup)`, ordered by ascending deployment id then declaration order, unreadable manifests skipped with the existing warning; add private `runPreHooksFailClosed(parts, log: (level, msg) => Promise<void>)` returning `{ ok: boolean; started: parts[]; failed?: { deploymentId; participationId; output? } }` that stops at the first failure, and `runPostHooks(parts, log)` returning per-participation results; make `runBackupHook` log `participationId`.
- [X] T010 [US1] Rewire the broker on top of T009 in `packages/server/src/services/core/deployment.ts`: `prepareContractBackup` returns `{ jobId?, apps (distinct ids in order), participations }` and enqueues with `payload.participations`; `runContractBackupPrepare` runs `runPreHooksFailClosed` over participations that have a `preHook`, and on failure runs `runPostHooks` over the **started** participations that have a `postHook` (forward order), then throws `backup preHook failed for 1 of N participation(s): <deploymentId>/<participationId>`; `finalizeContractBackup` runs `runPostHooks` over every participation with a `postHook` and returns `{ ok, results: [{ deploymentId, participationId, ok, output? }] }`. Update the JSDoc on both routes' comments in `packages/server/src/server.ts` (~lines 1550-1576) to mention participations.
- [X] T011 [US1] Rewire `capturePreUpgradeSnapshot` (`packages/server/src/services/core/deployment.ts` ~line 2018) to read `backupParticipations(await this.readReleaseBackupConfig(deploymentId, fromReleaseId))`, run `runPreHooksFailClosed` (throw `backup preHook failed: <participationId>: <output>` on failure after running `runPostHooks` for the started ones), and in `finally` run `runPostHooks` for every started participation, logging failures as today. `readReleaseBackupConfig` return type becomes `AppBackupDeclaration | undefined`.
- [X] T012 [US1] Run in the foreground: `bun --cwd packages/server test src/__tests__/bundles/manifest-backup.test.ts src/__tests__/deployments/contract-broker.test.ts src/__tests__/deployments/snapshot.test.ts src/__tests__/bundles/contracts.test.ts` and `bun run typecheck`; fix until green.

**Checkpoint**: US1 independently testable — two participations run in order, cleanup is started-only, results name participations, singular manifests unchanged.

---

## Phase 4: User Story 3 — A second provider of the same contract is refused (Priority: P2)

**Goal**: One provider per contract per host, enforced at create time; legacy pairs flagged in the rollup.

**Independent test**: `contract-provider-guard.test.ts`: second provider refused naming the first; allowed after removal; other contracts unaffected.

### Tests for User Story 3

- [X] T013 [P] [US3] Write `packages/server/src/__tests__/deployments/contract-provider-guard.test.ts` (fixture pattern from `contract-broker.test.ts`; a stub catalog whose `getVersionDetail` returns `provides` per app id): installing app A with `provides: ['backup@1']` and `grants: ['backup@1']` succeeds; installing app B with the same `provides`/`grants` rejects with `ConflictError`, `code === 'PROVIDER_EXISTS'`, `contract === 'backup@1'`, `existing.id` = A's id, message containing A's name and "uninstall it first", and creates no deployment directory and no job; after `deleteDeployment(A)`, B succeeds; B with `provides: ['container-logs@1']` beside A succeeds; a second `container-logs@1` provider beside B is refused the same way (FR-014); promoting A to a new release (the existing `promote` path) does not throw `PROVIDER_EXISTS` (AS 3.4); the rejection fires **before** the consent check (B without `grants` still gets `PROVIDER_EXISTS`, not `GRANT_CONSENT_REQUIRED`); the base/mock service (`MockDeploymentService` or the base class via the existing mock factory) is permissive.
- [X] T014 [P] [US3] Extend `packages/server/src/__tests__/bundles/contracts.test.ts` `buildContractRollup` cases: two entries providing `backup@1` → `providerConflict === true`; one provider → the field is absent.

### Implementation for User Story 3

- [X] T015 [US3] Add the seam in `packages/server/src/services/core/deployment.ts`: base-class `protected async assertProviderAllowed(provides: string[] | undefined): Promise<void>` no-op (beside `assertInstanceAllowed` ~line 582, same rationale comment); call it in `createFromDraft` immediately after `assertInstanceAllowed` (~line 752) and before `missingGrantConsents`; `RealDeploymentService` override (beside its `assertInstanceAllowed` override ~line 2987): for each ref in `provides` whose definition has `providerKind === 'app'`, scan `this.deployments.values()`, read each via `readDeploymentContracts`, and on the first other deployment whose `provides` includes the ref throw `new ConflictError(\`'${app}' provides ${ref}, which '${name}' (deployment ${id}) already provides. A contract has one provider per host; uninstall it first.\`, { code: 'PROVIDER_EXISTS', contract: ref, existing: { id, name } })` — check `ConflictError`'s constructor accepts a details object; if not, extend it the way `ValidationError` carries `code`.
- [X] T016 [US3] In `buildContractRollup` (`packages/server/src/services/core/contracts.ts` ~line 121) set `providerConflict: true` when `providers.length > 1` (absent otherwise).
- [X] T017 [US3] Run in the foreground: `bun --cwd packages/server test src/__tests__/deployments/contract-provider-guard.test.ts src/__tests__/bundles/contracts.test.ts src/__tests__/deployments/persistence.test.ts` and `bun run typecheck`; fix until green.

**Checkpoint**: US3 independently testable.

---

## Phase 5: User Story 2 — The dashboard tells the truth about partial coverage (Priority: P1)

**Goal**: Server-computed coverage on the detail and the rollup; the Backups page and app detail render `partial` with counts.

**Independent test**: `contract-rollup.test.ts` postiz-shaped fixture yields `partial 1/2`; `Backups.coverage.test.tsx` renders "Partially covered · 1 of 2" and excludes it from the covered count.

### Tests for User Story 2

- [X] T018 [P] [US2] Extend `packages/server/src/__tests__/deployments/contract-rollup.test.ts`: a deployment whose stub compose has `postiz-postgres: image: postgres:17-alpine`, `temporal-postgres: image: postgres:17-alpine`, `postiz: image: ghcr.io/gitroomhq/postiz-app:v1.0.0`, `accepts: ['backup@1']` and one participation on `postiz-postgres` → `GET detail .contracts.coverage['backup@1']` is `{ state: 'partial', targeted: 1, recognised: 2, participations: [{ id: 'default', service: 'postiz-postgres' }], databases: ['postiz-postgres','temporal-postgres'] }` and the rollup acceptor carries the same `coverage`; two participations covering both → `quiesced`; accepts, no participations, no databases → `as-is`; accepts, no participations, one database → `partial 0/1`; a database service behind a profile the deployment did not select is not counted; not accepting → no `coverage` for that ref; `hooks` still present for compatibility. (The broker test's `COMPOSE` constant shows how the stub compose is injected via the draft; use `composeOverride` on the finalized artifacts.)
- [X] T019 [P] [US2] Extend `packages/web/src/__tests__/utils/backup-coverage.test.ts`: `coverageRows` uses `participant.coverage.state` when present (`partial` row), falls back to `hooks` when absent; a row for an implicit rollup is never `uncovered`.
- [X] T020 [P] [US2] Extend `packages/web/src/__tests__/pages/Backups.coverage.test.tsx`: a postiz-shaped acceptor renders the badge text `Partially covered` and `1 of 2`, the header count excludes it (`1 of 2 installed apps covered` with one as-is app and the postiz app, plus `1 partially`), and the `partial` title names the unquiesced service; a rollup with `providerConflict: true` renders the "More than one app provides backups" warning.
- [X] T021 [P] [US2] Extend the deployment-detail tests (`packages/web/src/__tests__/pages/DeploymentDetail*.test.tsx`, the file that covers `AppBackupCoverage`): `contracts.coverage['backup@1'].state === 'partial'` renders "Partially covered" and "`temporal-postgres` has no pre-backup hook."; a detail without `coverage` but with `hooks` still renders "Quiesced"; a detail with `contracts.granted: ['container-logs@1']` renders a Grants fact reading "Read the logs of every container on this host", and no Grants fact when `granted` is absent (AS 4.2).

### Implementation for User Story 2

- [X] T022 [US2] In `packages/server/src/services/core/deployment.ts` `readDeploymentContracts` (~line 1758): when `accepts` includes `BACKUP_CONTRACT_REF`, read `deployments/<id>/releases/<currentReleaseId>/compose-override.yml` (path pattern at ~line 1497), parse with `yaml`, collect service names whose `image` is a string passing `isDatabaseImage` and whose `profiles` is absent/empty or intersects `deployment.selectedProfiles ?? []`, and set `coverage: { 'backup@1': judgeBackupCoverage({ accepts: true, participations: backupParticipations(manifest.backup), databaseServices }) }`; an unreadable/unparseable compose logs a warning and yields `databaseServices: []` (degrade, never throw). Keep emitting `hooks`.
- [X] T023 [US2] In `buildContractRollup` (`packages/server/src/services/core/contracts.ts`) copy `contracts.coverage?.[ref]` onto each acceptor's `coverage` (declared contracts only), keeping `hooks`.
- [X] T024 [US2] Update `packages/web/src/utils/backup-coverage.ts`: `Coverage` gains `partial`; `COVERAGE_META.partial` per `contracts/web.md` (warn colours); `coverageRows` derives `participant.coverage?.state ?? (participant.hooks ? 'quiesced' : 'as-is')`, carries `coverage` on the row, and for a rollup with `participation === 'implicit'` never emits `uncovered`; export a helper `unquiescedServices(coverage)` = `databases` minus participation services.
- [X] T025 [US2] Update `packages/web/src/components/BackupCoverage.tsx`: `CoverageBadge` shows `Partially covered · {targeted} of {recognised}` for `partial`; header count treats only `quiesced`/`as-is` as covered and appends `{n} partially` when any; `ProviderPanel` renders the provider-conflict warning when `rollup.providerConflict`; `AppBackupCoverage` takes `coverage` from `contracts.coverage?.['backup@1']` (fallback to `hooks`) and, for `partial`, lists `unquiescedServices` in the description.
- [X] T026 [US2] Update `packages/web/src/pages/DeploymentDetail.tsx` to pass `deployment.contracts` unchanged (type now includes `coverage`) and add a **Grants** fact to the detail's facts list (the detail shows no grants today): rendered only when `contracts.granted` is non-empty, listing each granted ref's grant `label` via `providerGrantsFor(contracts.granted)` (so `backup@1` reads "Read the data of every installed app" and `container-logs@1` reads "Read the logs of every container on this host"), falling back to the raw ref for a grant-less ref.
- [X] T027 [US2] Run in the foreground: `bun --cwd packages/server test src/__tests__/deployments/contract-rollup.test.ts` and `cd packages/web && npx vitest run src/__tests__/utils/backup-coverage.test.ts src/__tests__/pages` and `bun run typecheck`; fix until green.

**Checkpoint**: US2 independently testable — postiz-shaped fixture reads partial end to end.

---

## Phase 6: User Story 5 — Collected logs group by app without per-app configuration (Priority: P2)

**Goal**: `sh.hola.*` labels on every service of every deployment.

**Independent test**: `compose-defaults.test.ts` labels cases; a materialise test asserting labels in the runtime compose.

### Tests for User Story 5

- [X] T028 [P] [US5] Extend `packages/server/src/__tests__/routing/compose-defaults.test.ts`: `applyPlatformDefaults(yaml, cfg, { labels })` adds the three labels to every service; map-form labels merge; list-form (`- a=b`) stays a list with entries appended and a duplicate key replaced; a user `sh.hola.app=other` is overwritten while `com.example.x` survives; an all-disabled config with `labels` still rewrites; no `labels` runtime → unchanged behaviour.
- [X] T029 [P] [US5] Extend the materialise-path test that already asserts the runtime compose contents (`packages/server/src/__tests__/deployments/auth-provisioning.test.ts` has the `grantedContracts` persistence tests ~line 552; add a case there or in a new `materialize-labels.test.ts`): after the lifecycle job materialises, every service in `deployments/<id>/runtime/docker-compose.yml` carries `sh.hola.app === deployment.app`, `sh.hola.deployment === deployment.id`, `sh.hola.name === deployment.name`.

### Implementation for User Story 5

- [X] T030 [US5] In `packages/server/src/services/core/compose-defaults.ts`: add `labels?: Record<string, string>` to `PlatformDefaultsRuntime`; `applyPlatformDefaults` skips the no-op early return when `runtime.labels` is non-empty; `applyToService` merges labels preserving list/map form (helper `mergeLabels(existing: unknown, labels)`), overwriting keys that start with `PLATFORM_LABEL_PREFIX` and adding the rest.
- [X] T031 [US5] In `packages/server/src/services/core/deployment.ts` `materializeCompose` (~line 1592) pass `labels: { [PLATFORM_LABEL_APP]: deployment.app, [PLATFORM_LABEL_DEPLOYMENT]: deployment.id, [PLATFORM_LABEL_NAME]: deployment.name }` in the `applyPlatformDefaults` runtime.
- [X] T032 [US5] Run in the foreground: `bun --cwd packages/server test src/__tests__/routing/compose-defaults.test.ts src/__tests__/deployments/auth-provisioning.test.ts` (and the new materialise test if created) plus `bun run typecheck`; fix until green.

**Checkpoint**: US5 independently testable.

---

## Phase 7: User Story 4 — A trusted collector is granted container logs on consent (Priority: P2)

**Goal**: `container-logs@1` grant consented in the wizard/CLI, redacting proxy sidecar + `DOCKER_HOST` injected only on consent, validator pins, revocation with the deployment, brokered-only tokens.

**Independent test**: `compose-mounts.test.ts` injection shape; materialise with/without the grant; `docker-proxy.test.ts` allowlist/redaction; validator pins; wizard consent row.

### Tests for User Story 4

- [X] T033 [P] [US4] Extend `packages/server/src/__tests__/routing/compose-mounts.test.ts` for `injectContainerLogsSource(composeYaml, { image, socketPath, labels })`: adds `hola-docker-proxy` with the exact shape in `contracts/compose.md` (image, `command`, ro socket volume, `restart`, `security_opt`, `logging`, labels, no `networks`, no `ports`); sets `DOCKER_HOST=tcp://hola-docker-proxy:2375` on every other service in map form (and keeps list-form env as a list); overwrites a user `DOCKER_HOST`; idempotent on a second call; unchanged when there are no services.
- [X] T034 [P] [US4] Write `packages/server/src/__tests__/lib/docker-proxy.test.ts`: unit tests for `decide(method, path)` (allow list from `data-model.md`, `/v1.45/` prefix accepted, `archive`/`exec`/`images`/`top`/`stats`/POST/PUT/DELETE → deny) and `redactInspect(body)` (keeps `Id`, `Name`, `Created`, `State`, `Image`, `Config.Tty`, `Config.Labels`, `Config.Image`, `Config.Hostname`; drops `Config.Env`, `Config.Cmd`, `Config.Entrypoint`, `HostConfig`, `Mounts`, `NetworkSettings`); an integration case that starts a fake Docker API on a temp unix socket (`Bun.serve({ unix })`) serving canned responses and a chunked `/containers/x/logs` stream, starts the proxy handler on an ephemeral TCP port via `startDockerProxy({ socketPath, port: 0 })`, and asserts: list passes through byte-identical; inspect is redacted; logs stream bytes identical; `archive` and `POST exec` → 403 with the JSON message; `/_ping` → 200.
- [X] T035 [P] [US4] Extend `packages/server/src/__tests__/validation/compose-validate.test.ts`: bind sources `/var/run/docker.sock`, `/var/lib/docker/containers`, `/var/lib/docker`, `/var/run` each produce `VOLUME_NOT_UNDER_APP_DATA` (string and long-syntax forms); a service named `hola-docker-proxy` produces `RESERVED_SERVICE_NAME` (error).
- [X] T036 [P] [US4] Extend `packages/server/src/__tests__/auth/contract-tokens.test.ts`: `contractCapability('container-logs@1')` yields a capability that matches no route in the auth middleware table (assert against the `capability` list in `packages/server/src/middleware/auth.ts` ~line 137) — and the materialise test (T037) covers brokered-only minting.
- [X] T037 [P] [US4] Add materialise cases (same file as T029): a provider with `provides: ['container-logs@1']` and `grantedContracts: ['container-logs@1']` → runtime compose has `hola-docker-proxy` with image resolved from `HOLA_SERVER_IMAGE` when set, else `ghcr.io/try-hola/server:${HOLA_VERSION}`; socket from `HOLA_DOCKER_SOCKET` else `/var/run/docker.sock`; `DOCKER_HOST` on the app services; **no** `HOLA_CONTRACT_TOKEN` in `.env`/environment; the same provider without the grant → none of it; a `backup@1` provider still receives the token env; create without `grants` for a `container-logs@1` provider → `GRANT_CONSENT_REQUIRED` naming it; after `deleteDeployment` of a granted provider the contract token store holds no entry for it and the runtime dir is gone (FR-024, AS 4.5).
- [X] T038 [P] [US4] Extend `packages/web/src/__tests__/pages/InstallWizard.grants.test.tsx`: a draft with `provides: ['container-logs@1']` renders the consent row with the R9 label text and blocks Next until checked; both grants render for a manifest providing both; a `409` with `code: 'PROVIDER_EXISTS'` on create shows the server message.
- [X] T039 [P] [US4] Extend `packages/cli/src/__tests__/install.test.ts`: `--grant container-logs@1` is passed through in `grants`; a 409 `PROVIDER_EXISTS` response prints the server message and exits non-zero.

### Implementation for User Story 4

- [X] T040 [P] [US4] Create `packages/server/src/lib/docker-proxy.ts` (pure, no server imports): `decide(method: string, path: string): { allow: true; kind: 'passthrough' | 'inspect' | 'stream' } | { allow: false }` with the allow list and optional `/v\d+\.\d+` prefix; `redactInspect(body: unknown): unknown` with the field allowlist; `startDockerProxy(opts: { socketPath: string; port: number; hostname?: string }): Promise<{ port: number; stop(): Promise<void> }>` using `Bun.serve` and `fetch(new URL(path, 'http://docker'), { unix: socketPath, method, headers })` to forward, returning the upstream `Response` as-is for passthrough/stream (body streamed) and a rebuilt JSON response for inspect, `403 { message: 'not permitted by the container-logs grant' }` otherwise; log one line per denied request to stderr.
- [X] T041 [P] [US4] Create `packages/server/src/docker-proxy.ts` entrypoint: reads `DOCKER_SOCKET` (default `/var/run/docker.sock`) and `PORT` (default `2375`), calls `startDockerProxy`, prints the listening line, handles `SIGTERM`. Add a `docker-proxy` script to `packages/server/package.json` (`bun src/docker-proxy.ts`) and confirm `bun run build`/`lint` include the new files without complaint.
- [X] T042 [P] [US4] In `packages/shared/src/compose-validate.ts` add `RESERVED_SERVICE_NAMES = ['hola-docker-proxy']` and emit `RESERVED_SERVICE_NAME` (error, path `services.<name>`) in the per-service loop (~line 378). Do not touch `validateVolumes`.
- [X] T043 [US4] In `packages/server/src/services/core/compose-mounts.ts` add `CONTAINER_LOGS_PROXY_SERVICE = 'hola-docker-proxy'`, `CONTAINER_LOGS_DOCKER_HOST = 'tcp://hola-docker-proxy:2375'` and `injectContainerLogsSource(composeYaml, opts: { image: string; socketPath: string; labels: Record<string, string>; logging?: unknown })` per `contracts/compose.md` (sidecar service; `DOCKER_HOST` on every other service via `toEnvMap`; idempotent; no networks/ports on the sidecar). Depends on T030's label helper only for the labels object shape (pass-through).
- [X] T044 [US4] In `packages/server/src/services/core/deployment.ts`: after the apps-data branch in `materializeCompose` (~line 1618) add `if (grantsInclude(granted, 'container-logs')) content = injectContainerLogsSource(content, { image: process.env.HOLA_SERVER_IMAGE?.trim() || \`ghcr.io/try-hola/server:${process.env.HOLA_VERSION?.trim() || 'latest'}\`, socketPath: process.env.HOLA_DOCKER_SOCKET?.trim() || '/var/run/docker.sock', labels, logging: <the platform logging block from composeDefaultsConfig> })` (read `granted` once and reuse for both grants); narrow `mintContractEnv` (~line 1737) to `contracts.filter(ref => parseContractRef(ref)?.shape === 'brokered')` and return `{}` when that is empty. Document both env overrides in `packages/compose/docker-compose.yml` comments beside `HOLA_VERSION` (pass `HOLA_SERVER_IMAGE`/`HOLA_DOCKER_SOCKET` through when set).
- [X] T045 [US4] In `packages/web/src/pages/InstallWizard.tsx` surface a `409 PROVIDER_EXISTS` create error with the server message (and a link to `/deployments/<existing.id>` when present) in the existing error area; no change to the consent block (it iterates `providerGrantsFor`).
- [X] T046 [US4] Run in the foreground: `bun --cwd packages/server test src/__tests__/routing/compose-mounts.test.ts src/__tests__/lib/docker-proxy.test.ts src/__tests__/validation/compose-validate.test.ts src/__tests__/auth/contract-tokens.test.ts src/__tests__/deployments/auth-provisioning.test.ts`, `cd packages/web && npx vitest run src/__tests__/pages/InstallWizard.grants.test.tsx`, `cd packages/cli && npx vitest run src/__tests__/install.test.ts`, and `bun run typecheck`; fix until green.

**Checkpoint**: US4 independently testable.

---

## Phase 8: User Story 6 — The rollup tells log-collection subjects apart from uncovered apps (Priority: P3)

**Goal**: Implicit participation in coercion and the rollup.

**Independent test**: `contracts.test.ts` implicit cases; rollup route case.

### Tests for User Story 6

- [X] T047 [P] [US6] Extend `packages/server/src/__tests__/bundles/contracts.test.ts`: `coerceAccepts(['container-logs@1', 'backup@1'])` drops the implicit ref with a warning whose message names implicit participation and keeps `backup@1`; `buildContractRollup` for `container-logs@1` with a provider and three other entries → `acceptors` = the three (no `hooks`, no `coverage`), `unaffiliated` = `[]`, `participation === 'implicit'`; `backup@1` buckets unchanged; every rollup item carries `participation`.
- [X] T048 [P] [US6] Extend `packages/server/src/__tests__/deployments/contract-rollup.test.ts`: `GET /api/contracts` (service `getContracts`) lists every non-provider install as an acceptor of `container-logs@1` with `unaffiliated` empty.

### Implementation for User Story 6

- [X] T049 [US6] In `packages/server/src/services/core/contracts.ts`: `coerceRefs` drops `role === 'accepts'` refs whose definition has `participation === 'implicit'` with `logger.warn('Dropping \`accepts\` for a contract whose participation is implicit', { ...ctx, ref })`; `buildContractRollup` emits `participation` and, for implicit contracts, puts every non-provider entry in `acceptors` and leaves `unaffiliated` empty.
- [X] T050 [US6] Run in the foreground: `bun --cwd packages/server test src/__tests__/bundles/contracts.test.ts src/__tests__/deployments/contract-rollup.test.ts` and `bun run typecheck`; fix until green.

**Checkpoint**: All six stories independently green.

---

## Phase 9: Polish, docs, follow-ups, gates

- [X] T051 [P] Amend `docs/adr/0004-capability-contracts.md`: status line → `Accepted (August 2026; amended 2026-09-04 by spec 004)`; add **§9 Acceptor participation is a list** (the ruling, `default`, `auth` single by nature, ordering/failure/cleanup policy, per-participation reporting), **§10 One provider per contract per host** (enforced at create, `PROVIDER_EXISTS`, legacy pairs flagged, the channel-rehearsal limit and why it is accepted), **§11 Participation mode** (`declared`/`implicit`, rollup semantics, implicit `accepts` dropped), **§12 `container-logs@1`** (first app-provided provisioned contract; the log-source argument from research.md R7: ro socket bind, log-dir mount, prefix proxies rejected; the redacting proxy from the server image; the inspect field allowlist; revocation), **§13 Platform labels** (`sh.hola.app`, `sh.hola.deployment`, `sh.hola.name`). Update the §8 paragraph about `container-logs` to point at §12.
- [X] T052 [P] Amend `docs/adr/0002-cross-app-integration.md`: under §3 (after the `apps-data` paragraph) and in "Status of follow-on work", a dated note that `container-logs` (#245) was considered as a third `consumes` primitive and is instead the contract `container-logs@1` under ADR 0004 §12, so the design is not re-derived.
- [X] T053 [P] Update `docs/OPERATIONS.md` "App backups and coverage" (~line 300): describe the four coverage states including *partially covered* and what fixes it (a participation per database), the one-provider rule and the `PROVIDER_EXISTS` message, and add a short "Container logs" paragraph (consent, what the collector can and cannot see, the labels).
- [X] T054 [P] Update `docs/ARCHITECTURE.md` (deploy lifecycle / runtime data section ~line 123): platform labels on every service, provider grants (`apps-data` mount, `container-logs` proxy sidecar + `DOCKER_HOST`) injected post-validation at materialise time.
- [X] T055 [P] Update `CLAUDE.md` architecture notes: extend the ADR 0004 mention (or add a bullet) with acceptor participation as a list, one provider per contract, `participation: declared | implicit`, `container-logs@1` via the redacting proxy sidecar, and the `sh.hola.*` labels. Keep the `<!-- SPECKIT -->` block pointing at `specs/004-contract-cardinality/plan.md`.
- [X] T056 [P] File a `try-hola/apps` issue (`gh issue create --repo try-hola/apps`) titled "Manifest schema + validator: plural `backup` participations and per-database hook warning" describing the plural form from `contracts/manifest.md`, the singular form staying valid, and the validator warning becoming per recognised database service using the same image-family list; record the number here: **apps issue A: #152**.
- [X] T057 [P] File a `try-hola/apps` issue titled "postiz: add a `temporal-db` backup participation for `temporal-postgres`" referencing try-hola/hola#426 and issue A; record the number here: **apps issue B: #153**.
- [X] T058 [P] Comment on `try-hola/apps#30` (`gh issue comment 30 --repo try-hola/apps`) with the contract pointer: `provides: ["container-logs@1"]`, the consent step, `DOCKER_HOST=tcp://hola-docker-proxy:2375`, the redacted inspect field list, and the `sh.hola.*` labels; record the comment URL here: **apps#30 comment: https://github.com/try-hola/apps/issues/30#issuecomment-5546506470**.
- [X] T059 Remove any dead code left by the runner refactor (`backupAcceptors`, single-hook helpers), make sure no inline TODOs were added, and run `bun run lint` (then `bun run typecheck` again after any auto-fix).
- [X] T060 Run the full gate in the foreground from the repo root: `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build`; compare failures against the Baseline below; fix until green. Record final test counts (server, web, cli) under "Test evidence" below.

---

## Dependencies

- Phase 2 (T002–T004) blocks every story.
- US1 (Phase 3) is independent after Phase 2. US3 (Phase 4) is independent after Phase 2. US2 (Phase 5) depends on US1's `backupParticipations` reading (Phase 2) and on nothing else in US1; T023 touches `buildContractRollup` alongside T016 (US3) and T049 (US6) — serialise those three edits or land them in one pass.
- US5 (Phase 6) is independent after Phase 2. US4 (Phase 7) uses the label helper shape from US5 (T030) for the sidecar and the coverage-free rollup; T044 and T031 both edit `materializeCompose` — sequential.
- US6 (Phase 8) is independent after Phase 2 (shares `contracts.ts` with T016/T023).
- Phase 9 after all stories; T051–T058 parallel; T059–T060 last. Exception: the constitution asks for the ADR to precede implementation of a cross-app capability, so T051 and T052 (ADR amendments) MAY be written first, right after Phase 2, and refined at the end; nothing depends on them.

## Parallel execution examples

- After Phase 2: T005, T006, T007 (US1 tests) ∥ T013, T014 (US3 tests) ∥ T018–T021 (US2 tests) ∥ T028–T029 (US5 tests) ∥ T033–T039 (US4 tests) ∥ T047–T048 (US6 tests).
- Implementation: T008 ∥ T040 ∥ T041 ∥ T042 (different files); T030 before T031/T043/T044; T015 before T017.
- Phase 9: T051–T058 all parallel.

## Implementation strategy

1. **MVP** = Phase 2 + US1: the live defect's mechanics (plural participations run correctly and report per participation).
2. Then US3 (guard) and US2 (coverage + UI) — together they close #426 as the prompt frames it (the dashboard stops lying).
3. Then US5 → US4 → US6 — the container-logs half, closing #245.
4. Docs, follow-ups, gates.

## Baseline

Run on the unchanged branch (2026-09-04), foreground:

- `bun run test` (server + web): server `780 pass, 0 fail` (2218 expect calls, 87 files); web `276 passed` (49 files). No pre-existing failures.
- `cd packages/cli && npx vitest run` (not part of `bun run test` but exercised by this feature): `241 passed` (22 files).

No pre-existing failures to account for; any failure introduced during this feature is this feature's own.

## Test evidence

Final gate run (2026-09-04, foreground, from repo root):

- `bun run typecheck` — all packages pass (`@hola/shared`, `@hola/sdk`, `@hola/web`, `@hola/server`, `@hola/cli`; `@hola/compose` has no types).
- `bun run lint` — all packages pass, 0 issues, no auto-fixes needed (typecheck re-run after confirmed still clean).
- `bun run test`:
  - server (`bun:test`): **887 pass, 0 fail** (2487 expect() calls, 89 files) — up from the 780-pass baseline (T001) by the new/extended suites in this feature (contracts, manifest-backup, contract-broker, contract-provider-guard [new], contract-rollup, snapshot, compose-mounts, compose-defaults, compose-validate, docker-proxy [new], contract-tokens, auth-provisioning).
  - web (vitest): **290 pass, 0 fail** (49 files) — up from the 276-pass baseline. One run of the full suite showed a single flaky failure in `InstallWizard.channels.test.tsx` under concurrent load (timing-sensitive `waitFor`); it passed standalone and on two subsequent full-suite re-runs with no code changes in between — pre-existing test-infra flakiness, not a regression from this feature (that test's content is untouched by this feature).
- `cd packages/cli && npx vitest run` (exercised by this feature though not part of `bun run test`): **243 pass, 0 fail** (22 files) — up from the 241-pass baseline.
- `bun run build` — all packages build clean (server, cli, web, sdk types-only, compose nothing-to-build).

No pre-existing failures from the Baseline reappeared; every new/extended test added by this feature is green.

## Follow-up issues filed

- apps issue A (schema + validator): #152 — https://github.com/try-hola/apps/issues/152
- apps issue B (postiz temporal-db): #153 — https://github.com/try-hola/apps/issues/153
- apps#30 comment: https://github.com/try-hola/apps/issues/30#issuecomment-5546506470

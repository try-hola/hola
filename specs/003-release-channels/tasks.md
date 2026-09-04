# Tasks: Release Channels

**Input**: Design documents from `specs/003-release-channels/` (issue #428)

**Prerequisites**: plan.md, spec.md, research.md (R1–R15 + test strategy), data-model.md, contracts/{api,cli,web}.md, quickstart.md

**Tests**: Requested. Spec SC-006 requires automated coverage for catalog parsing, version resolution, update offering, the instance guard, the CLI install path and the dashboard surfaces. Test tasks precede implementation within each story and MUST fail before the implementation task lands.

**Organization**: Grouped by user story (spec priorities). Foundational shared types/helpers come first because every story reads them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 from spec.md
- Paths are repository-relative. Server tests: `bun --cwd packages/server test <file>`; CLI/web tests: `cd packages/{cli,web} && npx vitest run <file>`; run tests in the foreground.

## Hard invariants (from CLAUDE.md / constitution — bind every task)

- Bun workspaces; no new dependencies.
- Remote catalog only; `MockCatalogService` stays empty; tests inject stubs.
- No per-deploy work at create time; a channel change is a metadata write, never a job.
- Real/Mock pairs: new logic lives in `Real*` overrides and shared helpers; base classes stay permissive.
- `manifest.json` is untouched; channel is a catalog-index attribute.
- Deferred work becomes a GitHub issue, never an inline TODO.
- Gates before PR: `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build`.

---

## Phase 1: Setup

- [X] T001 Record the baseline: run `bun run test` in the foreground from the repo root on the unchanged branch and note any pre-existing failures in `specs/003-release-channels/tasks.md` under "Baseline" (below) so later runs are compared against it.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Shared vocabulary and wire types every story depends on.

- [X] T002 [P] Add shared channel helpers to `packages/shared/src/index.ts` next to `compareVersions` (~line 143): `export const STABLE_CHANNEL = 'stable'`, `CHANNEL_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/`, `isValidChannelName(s: unknown): s is string`, `isEligibleOnChannel(versionChannel: string, channel: string): boolean` (equal or `stable`), `newestEligibleVersion<T extends { version: string; channel?: string }>(entries: T[], channel = STABLE_CHANNEL): T | undefined` (filter by eligibility, treat missing `channel` as `stable`, max by `compareVersions`), and `export type InstanceReason = 'channel' | 'operator-override'`.
- [X] T003 [P] Write `packages/server/src/__tests__/shared/channels.test.ts` covering: valid/invalid names (uppercase, empty, 33 chars, leading digit, non-string), eligibility truth table, `newestEligibleVersion` on `[1.2.0 stable, 1.3.0-rc.1 rc, 1.3.0-rc.2 rc]` for `stable` → `1.2.0`, `rc` → `1.3.0-rc.2`, then with `1.3.0 stable` added → `1.3.0` on both; empty/no-eligible → `undefined`; entries without `channel` count as stable.
- [X] T004 Extend wire types in `packages/shared/src/index.ts` per `data-model.md`. All new wire fields are **optional** in the type (so existing typed fixtures keep compiling, SC-004) while the server always emits them and clients read absent as `stable`: `CatalogApp.channels?: string[]` (+ doc comment that `version` is newest stable); `CatalogAppVersion.channel?: string`; `GetCatalogAppVersionDetailResponse.channel?: string`; `CreateDraftRequest.channel?: string`; `Draft.channel?: string`; `DeploymentListItem.channel?: string` + `latestVersionChannel?: string`; `DeploymentDetail.channel?: string` + `latestVersionChannel?: string` + `instanceReason?: InstanceReason`; `GetDeploymentUpdateCheckResponse.channel?: string` + `latestVersionChannel?: string`; `CreateDeploymentFromDraftResponse.channel?: string`; `PatchDeploymentRequest.channel?: string`; `PatchDeploymentResponse.warnings?: string[]`; `EnhancedDeploymentDetail.channel?: string` + `instanceReason?: InstanceReason` (top-level beside `subdomain`, with comments mirroring the `subdomain` precedent). Run `bun run typecheck`; it should stay green because every field is optional.
- [X] T005 Add `channel?: string` to `FinalizedManifest` in `packages/server/src/services/core/draft.ts` (~line 89, beside `multiInstance`) with a comment explaining it is copied from the draft so `createFromDraft` needs no catalog lookup.

**Checkpoint**: `bun run typecheck` green across packages; `channels.test.ts` green.

---

## Phase 3: User Story 1 — Stable operators are unaffected by pre-release entries (Priority: P1) 🎯 MVP

**Goal**: A pre-release entry in the catalog never becomes the default anywhere; newest-version resolution is pre-release-aware.

**Independent test**: Serve a two-channel catalog via `data:` URL; `listApps`/`getApp`/`getVersions`/`getVersionDetail('latest')` all resolve `1.2.0`; a stable deployment's update offer ignores `1.3.0-rc.1`.

### Tests for User Story 1

- [X] T006 [P] [US1] Write `packages/server/src/__tests__/catalog/catalog-channels.test.ts` (template: `bundles/catalog-remote.test.ts` `data:` URL + `catalogConfig`): catalog with `1.2.0` (no channel), `1.3.0-rc.1` (`rc`), `1.3.0-rc.2` (`channel: "RC"` malformed), `1.1.0` listed twice. Assert: `listApps` item `version === '1.2.0'`, `channels` equals `['stable','rc']`; `getApp().versions` excludes the malformed and duplicate entries; `getVersions()` items carry `channel` (`stable` for the untagged); `getVersionDetail(app,'latest')` resolves `1.2.0` (stub the bundle pull with `Object.assign(svc, { pullValidateBuild: async (a: { version: string }) => ({ version: a.version, defaultEnv: [], defaults: { ports: [], volumes: [] } }) })` so `getVersionDetail` returns without ORAS); an app whose only entries are non-numeric strings resolves by `compareVersions` string fallback, not list position; exactly one `warn` per malformed/duplicate entry, asserted with `spyOn((svc as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger, 'warn')` from `bun:test` before the first call.
- [X] T007 [P] [US1] Extend `packages/server/src/__tests__/deployments/update-info.test.ts`: `makeCatalog` accepts `Array<string | { version; channel }>` and emits `channel` per item; add a test "a stable deployment at 1.1.0 is offered 1.2.0, never 1.3.0-rc.1" asserting `latestVersion === '1.2.0'`, `updateAvailable === true`, `latestVersionChannel === 'stable'`, and a test "records without a stored channel are treated as stable" (write a `metadata.json` without `channel`, reload, assert list item `channel === 'stable'`).

### Implementation for User Story 1

- [X] T008 [US1] In `packages/server/src/services/core/catalog.ts`: add `channel?: unknown` to `RemoteCatalog.apps[].versions[]` and `channel: string` to `CatalogVersionEntry`; add `coerceChannel(value): string | undefined` (absent → `stable`, valid → value, else `undefined`); add a private `wellFormedVersions(app, source): CatalogVersionEntry[]` that drops malformed-channel and duplicate-version entries with one `this.logger.warn('Catalog version entry ignored', { source, appId, version, channel, reason })` each; delete `pickLatestVersion` (lines ~155-176) and use `newestEligibleVersion(entries, STABLE_CHANNEL)` from `@hola/shared` in `mapApp` (`version`) and add `channels` (distinct, `stable` first then sorted); route `getApp`, `getVersions` (include `channel`) and `getVersionDetail` through `wellFormedVersions`.
- [X] T009 [US1] In `packages/server/src/services/core/deployment.ts` `enrichUpdateInfo` (~2212-2248): key the cache by `${source}::${app}::${channel}` where `channel = this.deployments.get(id)?.channel ?? 'stable'`; compute `newest = newestEligibleVersion(versions, channel)`; set `item.latestVersion = newest.version` and `item.latestVersionChannel = newest.channel ?? 'stable'`; in `toListItem` (~259) and the detail mapper set `channel: d.channel ?? 'stable'`; in `buildUpdateCheck` (~2258) pass `channel` and `latestVersionChannel` through to the response. Ensure `MockDeploymentService`/base mappers emit `channel: 'stable'`.
- [X] T010 [US1] Run `bun --cwd packages/server test src/__tests__/catalog src/__tests__/bundles src/__tests__/deployments/update-info.test.ts` in the foreground; fix regressions from the `pickLatestVersion` removal (any test relying on list-order fallback is updated to the `compareVersions` order and the change noted in `docs/adr/0005-release-channels.md` Consequences in T045).

**Checkpoint**: US1 tests green; existing catalog/update tests green.

---

## Phase 4: User Story 2 — Install a pre-release beside the stable copy (Priority: P1)

**Goal**: `hola install remo --channel rc --as remo-beta` (and the wizard equivalent) creates a channel copy of a single-instance app without the override, persists `channel` + `instanceReason`, and both surfaces show it.

**Independent test**: With a stable copy installed, create an rc draft → finalize → `createFromDraft` succeeds, record has `channel: 'rc'`, `instanceReason: 'channel'`; a second rc copy is a 409; no rc version → `NO_VERSION_ON_CHANNEL`; pinned ineligible → `VERSION_NOT_ON_CHANNEL`.

### Tests for User Story 2

- [X] T011 [P] [US2] Write `packages/server/src/__tests__/deployments/channels.test.ts` (template: `update-info.test.ts` `makeSystem`; use a duck-typed channel-aware `makeCatalog` whose `getVersionDetail(appId, version, source, channel)` implements the resolution rules from `data-model.md` with the same error codes — the real `RealCatalogService` resolution is covered by T006): `createDraft({ appId, channel: 'rc' })` resolves `1.3.0-rc.1` and `Draft.channel === 'rc'`; `createDraft({ appId, version: '1.3.0-rc.1' })` (no channel) → `Draft.channel === 'rc'`; `createDraft({ appId, channel: 'beta' })` → rejects with code `NO_VERSION_ON_CHANNEL` and message listing `stable, rc`; `createDraft({ appId, version: '1.3.0-rc.1', channel: 'stable' })` → `VERSION_NOT_ON_CHANNEL`; `createDraft({ appId, channel: 'Bad Name' })` → `INVALID_CHANNEL`; finalized manifest carries `channel`.
- [X] T012 [P] [US2] Extend `packages/server/src/__tests__/deployments/persistence.test.ts` (after the #246 block at ~304-388): "a channel copy of a single-instance app is permitted without the override" (stable copy + rc draft → second `createFromDraft` with a distinct name succeeds; detail `channel === 'rc'`, `instanceReason === 'channel'`; first copy has no `instanceReason`); "a second copy on the same channel is rejected" (409 message contains `channel 'rc'` and `--channel`); "override supplied but not needed records reason channel" (`allowMultiple: true` + different channel → `instanceReason === 'channel'`); "override needed records operator-override"; "a multiInstance app records no reason"; "persisted channel and instanceReason survive a restart" (read raw `metadata.json`, reload service, assert); "a channel copy still needs a distinct subdomain" (default name → existing host-conflict rejection).
- [X] T013 [P] [US2] Extend `packages/cli/src/__tests__/install.test.ts` (template ~206-236): `--channel rc` reaches `sdk.drafts.create` as `channel: 'rc'`; `--as remo-beta` maps to `name: 'remo-beta'`; both `--name` and `--as` → `--name` wins and a note line is printed; output contains `Following channel: rc` when the create response `channel` is `rc`; not printed for `stable` when no version was pinned; printed when a version was pinned and the response channel differs from `stable`; `--json` output includes `channel`.
- [X] T014 [P] [US2] Extend `packages/web/src/__tests__/pages/Deployments.test.tsx` and `DeploymentDetail.test.tsx`: list renders an `rc` pill for `channel: 'rc'` and none for `stable`; detail facts show `Channel: rc` and `Instance: rc copy of remo` for `instanceReason: 'channel'`, `additional copy (operator override)` for `operator-override`.

### Implementation for User Story 2

- [X] T015 [US2] In `packages/server/src/services/core/catalog.ts` `getVersionDetail(appId, version, source = 'hola', channel = STABLE_CHANNEL)`: validate `channel` (`ValidationError` code `INVALID_CHANNEL`); `latest`/empty → `newestEligibleVersion(entries, channel)` or throw `BundleUnavailableError` code `NO_VERSION_ON_CHANNEL` with message `No version of '<appId>' is available on channel '<channel>'. Channels with versions: <list>.`; concrete → find entry, `VERSION_NOT_FOUND` as today, then if `!isEligibleOnChannel(entry.channel, channel)` throw `ValidationError` code `VERSION_NOT_ON_CHANNEL` with message `Version <v> of '<appId>' is on channel '<vc>', not eligible on channel '<channel>'.`; include `channel: entry.channel` in the returned detail (thread through `pullValidateBuild`/`buildDetailFromBundle` or spread it onto the result). Update the `CatalogService` interface, `MockCatalogService` and `getVersionDetailByRef` (returns `channel: 'stable'`).
- [X] T016 [US2] In `packages/server/src/services/core/draft.ts`: accept `request.channel` in `createDraft` (validate with `isValidChannelName` → `ValidationError` `INVALID_CHANNEL`); pass it to `getDraftDefaults(appId, version, source, channel)` → `getVersionDetail(..., channel)`; return `resolvedChannel: versionDetail.channel`; persist `Draft.channel = request.channel ?? defaults.resolvedChannel ?? 'stable'` (~line 472/486); carry `channel` into the finalized manifest (~line 1144 alongside `version`/`source`); install-by-ref drafts get `channel: 'stable'`.
- [X] T017 [US2] In `packages/server/src/services/core/deployment.ts`: change `assertInstanceAllowed(appId, multiInstance?, allowMultiple?, channel = 'stable'): InstanceReason | undefined` in the base (returns `undefined`) and the Real override (~2751) per `data-model.md` "Instance reason" with the new 409 message from `contracts/api.md`; in `createFromDraft` (~680) compute `const channel = artifacts?.manifest.channel ?? 'stable'`, `const instanceReason = this.assertInstanceAllowed(app, multiInstance, request.allowMultiple, channel)`, and persist `channel` and `...(instanceReason ? { instanceReason } : {})` on the record; include `channel` in the `CreateDeploymentFromDraftResponse`; expose `instanceReason` on the detail mapper.
- [X] T018 [US2] In `packages/server/src/server.ts`: no route change for create; verify `POST /api/drafts` passes `channel` through (`~662`) and `GET /api/drafts/:id` returns it; add `channel` query support to `GET /api/catalog/apps/:id/versions/:version` (~477) forwarding to `getVersionDetail`.
- [X] T019 [US2] CLI: in `packages/cli/src/index.ts` add `.option('--channel', 'Release channel to follow (default: stable, or the pinned version\'s channel)')` and `.option('--as', 'Alias of --name')` plus the two examples from `contracts/cli.md`; in `packages/cli/src/commands/install/install.ts` add `channel?`/`as?` to `InstallOptions`, resolve `name = opts.name ?? opts.as ?? (isRef ? undefined : appId)` (print `Note: --name overrides --as` when both), send `channel: opts.channel` on `sdk.drafts.create`, and after `finalizeAndDeploy` print `Following channel: <c>` whenever the create response's `channel` (default `stable`) is not `stable` — this covers both an explicit `--channel` and a channel implied by a pinned version; return `channel` in the JSON result (extend `DeployResult` in `packages/cli/src/lib/deploy-flow.ts` to carry `channel` from the create response).
- [X] T020 [US2] Web list/detail: in `packages/web/src/pages/Deployments.tsx` (~379) render a `<span>` pill with `deployment.channel` before the version when non-stable; in `packages/web/src/pages/DeploymentDetail.tsx` facts (~418) add `Channel` (always) and `Instance` (when `instanceReason`) rows per `contracts/web.md`.
- [X] T021 [US2] Web wizard: in `packages/web/src/hooks/useDraftApi.ts` `useCreateDraft` accept and forward `channel?`; in `packages/web/src/pages/InstallWizard.tsx` read `searchParams.get('channel')`, pass it to `createDraftHook.createDraft({ appId, source, channel })` (~293), show `Following channel: <c>` in the summary when non-stable, and replace the "additional instance" warning with the channel info note when a channel is set; render `NO_VERSION_ON_CHANNEL`/`VERSION_NOT_ON_CHANNEL` server messages inline via the existing draft error path.
- [X] T022 [US2] Run in the foreground: `bun --cwd packages/server test src/__tests__/deployments/channels.test.ts src/__tests__/deployments/persistence.test.ts`, `cd packages/cli && npx vitest run src/__tests__/install.test.ts`, `cd packages/web && npx vitest run src/__tests__/pages/Deployments.test.tsx src/__tests__/pages/DeploymentDetail.test.tsx`; fix until green.

**Checkpoint**: US1 + US2 deliver the headline flow end to end (server + CLI + list/detail badges).

---

## Phase 5: User Story 3 — A channel deployment is offered the right upgrades (Priority: P2)

**Goal**: Offers are filtered by the deployment's channel (own + stable), explicit cross-channel upgrades are refused with a hint, and the channel stays sticky across upgrades.

**Independent test**: rc deployment at `1.3.0-rc.1` is offered `1.3.0-rc.2`, then `1.3.0`; after promoting to `1.3.0` it still reports `channel: 'rc'`; stable deployment refuses `--app-version 1.3.0-rc.1`.

### Tests for User Story 3

- [X] T023 [P] [US3] Extend `packages/server/src/__tests__/deployments/update-info.test.ts`: rc deployment offered `1.3.0-rc.2` (`latestVersionChannel: 'rc'`), then `1.3.0` once published (`latestVersionChannel: 'stable'`); stable deployment with only `1.3.0-rc.2` newer → `updateAvailable === false`, `latestVersion === '1.2.0'` (its own newest eligible); update-check response carries `channel` and `latestVersionChannel`.
- [X] T024 [P] [US3] Extend `packages/server/src/__tests__/deployments/promote-endpoint.test.ts`: `POST /promote` with `version: '1.3.0-rc.1'` on a stable deployment → 400 `VERSION_NOT_ON_CHANNEL` whose message contains `PATCH /api/deployments/<id>`; with no `version` on an rc deployment → target is the rc-eligible newest; an rc deployment promoted to `1.3.0` (stable) keeps `channel === 'rc'`; the draft the route creates is made with the deployment's channel (assert on the drafts stub call); FR-014: an rc→stable promote whose target manifest declares `upgrade: { minFromVersion: '1.3.0-rc.2', preUpgradeBackup: 'required' }` is blocked by the skip-guard from `1.3.0-rc.1` exactly as a stable→stable promote would be, and from `1.3.0-rc.2` triggers the pre-upgrade snapshot path (assert the existing snapshot hook/stub is invoked).

### Implementation for User Story 3

- [X] T025 [US3] In `packages/server/src/services/core/deployment.ts` add `async resolveUpgradeTarget(deploymentId: string, requested?: string): Promise<{ version?: string; channel: string }>` on the interface (`version` is `undefined` when there is nothing to promote to — the route keeps owning the `NO_TARGET_VERSION` 400; base: returns `{ version: requested ?? detail.latestVersion, channel: detail.channel ?? 'stable' }`; Real: when `requested` is given, look it up via `catalogService.getVersions(app, source)`, and if present but not eligible on the deployment channel throw `ValidationError` code `VERSION_NOT_ON_CHANNEL` with the hint message from `contracts/api.md`; unknown versions pass through so the existing `VERSION_NOT_FOUND` path still reports them).
- [X] T026 [US3] In `packages/server/src/server.ts` promote handler (~1200): replace `body.version ?? detail.latestVersion` with `const { version: targetVersion, channel } = await services.deployments.resolveUpgradeTarget(deploymentId, body.version)` and keep the existing `NO_TARGET_VERSION` 400 when `targetVersion` is `undefined` and pass `channel` into `services.drafts.createDraft({ appId, version: targetVersion, source, channel })`. Confirm `promote()` never touches `deployment.channel` (sticky).
- [X] T027 [P] [US3] Web: in `packages/web/src/pages/Deployments.tsx` update pill and `packages/web/src/pages/DeploymentDetail.tsx` `Latest` fact + upgrade dialog (~980-1070) append ` (<latestVersionChannel>)` when non-stable; extend `packages/web/src/__tests__/pages/Deployments.test.tsx` and `DeploymentDetail.test.tsx` with one assertion each.
- [X] T028 [P] [US3] CLI: confirm `packages/cli/src/commands/deployments/actions.ts` `runUpgrade` prints the server's `VERSION_NOT_ON_CHANNEL` message verbatim through `reportDeployError` (add a case to `packages/cli/src/__tests__/deployment-actions.test.ts` asserting the message and exit code 1).
- [X] T029 [US3] Run in the foreground: `bun --cwd packages/server test src/__tests__/deployments/update-info.test.ts src/__tests__/deployments/promote-endpoint.test.ts`, the two web page tests and the CLI actions test; fix until green.

**Checkpoint**: Channel deployments track their channel over time; cross-channel upgrades are refused with an actionable message.

---

## Phase 6: User Story 4 — Change the channel a deployment follows (Priority: P3)

**Goal**: `PATCH /api/deployments/:id { channel }` changes the followed channel without a job; the dashboard exposes it.

**Independent test**: PATCH stable → rc returns `ok` (+ warning when another copy follows rc), record updated, running version unchanged, next list shows rc offers; PATCH with a bad name → 400.

### Tests for User Story 4

- [X] T030 [P] [US4] Extend `packages/server/src/__tests__/deployments/channels.test.ts`: PATCH `{ channel: 'rc' }` persists `channel`, leaves `version`/`currentReleaseId` untouched, creates no job (jobs stub call count unchanged), returns `warnings` containing the app id when another single-instance copy already follows `rc`, no warnings otherwise; PATCH `{ channel: 'Bad Name' }` → `ValidationError` `INVALID_CHANNEL`; PATCH combining `channel` with an env change applies both; `instanceReason` is unchanged after a channel change.
- [X] T031 [P] [US4] Extend `packages/web/src/__tests__/pages/DeploymentDetail.test.tsx`: a Channel select renders the app's channels, selecting `rc` calls `api.deployments.update(id, { channel: 'rc' })`, invalidates the detail/list/update-check queries (assert refetch), and shows returned `warnings` as a transient notice.

### Implementation for User Story 4

- [X] T032 [US4] In `packages/server/src/services/core/deployment.ts` both `updateDeployment` implementations (base ~1032, Real ~1763): if `request.channel !== undefined` validate (`INVALID_CHANNEL`), set `deployment.channel`, compute `warnings` (another deployment of the same app, with manifest `multiInstance` not set — read from the active finalized manifest when available, else assume single-instance — already follows the new channel), persist, and return `{ ok: true, ...(warnings.length ? { warnings } : {}) }`; the Real override's early "nothing to do" branch must treat a channel change as work and must not require an active release for a channel-only PATCH.
- [X] T033 [US4] Web: in `packages/web/src/pages/DeploymentDetail.tsx` configuration area add a Channel `<select>` fed by `api.catalog.appById(deployment.app).channels` (fallback `[deployment.channel]`), calling `updateConfiguration({ channel })` from `packages/web/src/hooks/useDeploymentDetailApi.ts` (extend its `onSuccess` invalidation to the deployments list and update-check keys in `packages/web/src/state/queryKeys.ts`), and surface `warnings` via the existing `TransientNotice`.
- [X] T034 [US4] Run in the foreground: `bun --cwd packages/server test src/__tests__/deployments/channels.test.ts` and `cd packages/web && npx vitest run src/__tests__/pages/DeploymentDetail.test.tsx`; fix until green.

---

## Phase 7: User Story 5 — See what channels the catalog offers (Priority: P3)

**Goal**: Channels are discoverable: `channels[]` on the app summary, hints on the catalog card, an "Install on `<channel>`" affordance, a channel choice in the wizard, and a CLI suffix.

**Independent test**: Catalog page with `channels: ['stable','rc']` shows the hint and (when installed on stable only) the rc install link; the wizard shows the select only for >1 channel and recreates the draft on change; `hola catalog` prints `(channels: rc)`.

### Tests for User Story 5

- [X] T035 [P] [US5] Extend `packages/web/src/__tests__/pages/Catalog.test.tsx`: `rc available` hint for `channels: ['stable','rc']`; "Install on rc" link `href` ends with `?channel=rc` when the app's only deployment is `stable`; link absent when a deployment already follows `rc`; app with `channels: ['rc']` shows no version and its primary install link carries `?channel=rc`.
- [X] T036 [P] [US5] Write `packages/web/src/__tests__/pages/InstallWizard.channels.test.tsx` (template: `InstallWizard.profiles.test.tsx`): select absent for one channel; present for two, defaulting to `stable`; changing it calls `api.drafts.remove(oldId)` then creates a draft with `channel: 'rc'`; `?channel=rc` reaches the initial create; summary shows `Following channel: rc`.
- [X] T037 [P] [US5] Extend `packages/cli/src/__tests__/catalog.test.ts`: row suffix `(channels: rc)` for an app with `channels: ['stable','rc']`, none for `['stable']`; write `packages/cli/src/__tests__/deployments-list.test.ts` asserting the ` [rc]` suffix in `runDeploymentsList` output for a non-stable row.

### Implementation for User Story 5

- [X] T038 [P] [US5] Web catalog: in `packages/web/src/pages/Catalog.tsx` (~325-350) render the channel hint from `app.channels`, build `installOnChannelTo(c)` links for each non-stable channel not followed by any deployment of that app (extend `installedByApp` to a map of app → `{ id, channels: Set }` from `DeploymentListItem.channel`), and route no-stable apps' primary install to `?channel=<first>`.
- [X] T039 [P] [US5] Web wizard: in `packages/web/src/pages/InstallWizard.tsx` fetch the app summary (`api.catalog.appById(appId)` via the existing catalog hook) to get `channels`; render the Channel select above the instance-name field (~1555) only when `channels.length > 1`; on change: `await api.drafts.remove(currentDraftId)`, reset env/profile state, clear `creatingDraftRef`, and create a new draft with the chosen channel via the same effect path; default per `contracts/web.md`.
- [X] T040 [P] [US5] CLI: in `packages/cli/src/commands/catalog/catalog.ts` append `  (channels: <non-stable, comma-joined>)` when present; in `packages/cli/src/commands/deployments/deployments.ts` append ` [<channel>]` to the name column for non-stable rows.
- [X] T041 [US5] Run in the foreground: `cd packages/web && npx vitest run src/__tests__/pages/Catalog.test.tsx src/__tests__/pages/InstallWizard.channels.test.tsx` and `cd packages/cli && npx vitest run src/__tests__/catalog.test.ts src/__tests__/deployments-list.test.ts`; fix until green.

---

## Phase 8: Polish & cross-cutting

- [X] T042 [P] Update `packages/shared/src/docs/api-explorer.ts` schema strings (~1002-1045): `GetCatalogAppResponse` (+`channels`), `GetCatalogAppVersionsResponse` (+`channel`), `GetCatalogAppVersionDetailResponse` (+`channel`), `CreateDraftRequest` (+`channel?`); add a one-line note on `channel` to the deployments PATCH description if one exists.
- [X] T043 [P] Update `packages/sdk/src/index.ts` only if a method signature needs it (`catalog.versionDetail(appId, version, source?, channel?)` query param); otherwise confirm pass-through types compile and note "no change" here.
- [X] T044 [P] File the follow-up issue with `gh issue create --title "Clone-with-data rehearsal: hola install <app> --channel <c> --from <deployment>" --label enhancement --label area:server` whose body carries, verbatim from #428, the "What this alone does not cover — and the clone that would" section (inventory table, the five design considerations, "Not blue/green") and links `specs/003-release-channels/spec.md`; record the issue number here: **Follow-up issue: #429** (https://github.com/try-hola/hola/issues/429).
- [X] T045 [P] Write `docs/adr/0005-release-channels.md` in the ADR 0004 format (`- **Status:** Proposed (September 2026)`, `- **Context:**`, `## Context`, `## Decision` with `### 1. Channel is a catalog-index attribute`, `### 2. Eligibility: own channel or stable`, `### 3. Channel enters at the draft`, `### 4. Single-instance guard is per app and channel, with a recorded reason`, `### 5. Newest-version resolution uses compareVersions`, `### Rejected alternatives` (operator image override — the three arguments from #428; manifest-level channel; closed channel enum; channel on createFromDraft; forking the bundle as a second catalog app), `## Consequences` (incl. the non-semver ordering change, the try-hola/apps prerequisites list, relation to PRD §12.2 catalog governance, the clone follow-up issue number from T044). Cite `file.ts:line` anchors as ADR 0003/0004 do.
- [X] T046 [P] Docs: add "### Release channels" under `## Upgrade` in `docs/OPERATIONS.md` (~line 314) covering install on a channel, what a channel copy tests (boot/route/auth, not data migration), changing channel, and the follow-up clone issue; update the `hola install` paragraph in `packages/cli/README.md` (~line 49) with `--channel`/`--as` and the implied-channel rule; add a bullet to `CLAUDE.md` "Architecture notes that matter" describing channels in ≤4 lines (catalog-index attribute, eligibility rule, guard per app+channel, ADR 0005).
- [X] T047 Run the full gate in the foreground from the repo root: `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build`; compare failures against the Baseline; fix anything introduced by this feature.
- [X] T048 Walk `specs/003-release-channels/quickstart.md` §2 table mentally against the final code paths (or against a dev server if one is available) and correct any message text in the docs/ADR that drifted from the implementation.

---

## Baseline

Date: 2026-09-03. Command: `bun run test` (repo root, unchanged `003-release-channels` branch
before any implementation).

- Server (`bun --cwd packages/server test`, run via workspace `test` script): **708 pass, 0
  fail**, 2063 `expect()` calls, 708 tests across 84 files, 18.37s.
- Web (`cd packages/web && bun x vitest run`): **48 test files passed (48), 251 tests passed
  (251)**, 51.51s.
- No pre-existing failures. Any failure after implementation is attributable to this feature.

## Final gate (T047)

Date: 2026-09-04. `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build` — all green:
- typecheck (both runs, before/after lint): all 6 packages pass.
- lint: all 6 packages pass, no auto-fixes needed.
- test: server **765 pass, 0 fail** (2183 expect() calls, 765 tests/87 files, 18.28s — +57 tests
  vs. baseline); web **273 pass, 0 fail** (49 test files, 53.27s — +22 tests vs. baseline).
- build: all packages build clean (server/cli bundle, web vite build; the >500kB web chunk-size
  advisory is pre-existing, not an error).

No baseline failures reappeared; nothing introduced by this feature failed.

## Dependencies & execution order

- **Phase 2** (T002–T005) blocks everything; T002/T003 parallel, T004 after T002, T005 parallel with T004.
- **US1** (T006–T010) after Phase 2. T006/T007 parallel; T008 → T009 → T010.
- **US2** (T011–T022) after US1 (needs `wellFormedVersions`/`newestEligibleVersion` in the catalog). T011–T014 parallel; T015 → T016 → T017 → T018; T019/T020/T021 parallel after T017; T022 last.
- **US3** (T023–T029) after US2 (needs `channel` on records). T023/T024 parallel; T025 → T026; T027/T028 parallel; T029 last.
- **US4** (T030–T034) after US2; independent of US3. T030/T031 parallel; T032 → T033 → T034.
- **US5** (T035–T041) after US1 (needs `channels[]`) and T021 (wizard channel plumbing). T035–T037 parallel; T038–T040 parallel; T041 last.
- **Polish** (T042–T048) after all stories; T042–T046 parallel; T047 → T048.

## Parallel example: User Story 2

```
# tests first, in parallel
T011 channels.test.ts | T012 persistence.test.ts | T013 cli install.test.ts | T014 web page tests
# server chain
T015 catalog.getVersionDetail → T016 draft channel → T017 guard + record → T018 routes
# clients, in parallel
T019 CLI flags | T020 web badges | T021 web wizard plumbing
# verify
T022
```

## Implementation strategy

- **MVP** = Phase 2 + US1 + US2: the safety property plus the headline install flow.
- Then US3 (offers + upgrade guard), US4 (channel change), US5 (discoverability), Polish.
- Each story ends with a foreground targeted test run; the full suite runs once at T047.
- Deferred discoveries become GitHub issues (as T044 does), never inline TODOs.

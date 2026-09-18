# Tasks: Beta Channel Support for Catalog Apps (Operator Model)

**Input**: Design documents from `specs/005-beta-channel-ux/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R12 + test strategy), data-model.md, contracts/{api,web,cli}.md, quickstart.md

**Tests**: Requested. Spec SC-001…SC-008 require automated coverage for enrolment gating, Join/Leave and the honest leaving state, the structured conflict and its wizard/CLI rendering, the catalog card actions, `versionChannel`/`multiInstance` on the wire, the settings field, and the CLI commands. Test tasks precede implementation within each story and MUST fail before the implementation task lands (extend existing suites in place; do not fork them).

**Organization**: Foundational (types, settings, derived facts, shared UI, SDK error) → US6 settings card → US1 enrolment gating → US5 catalog card + list → US2 Join/Leave → US3 separate copy + siblings → US4 conflict → US7 CLI → docs, follow-ups, gates.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US7 from spec.md
- Paths are repository-relative. Server tests: `bun --cwd packages/server test <file>`; web/CLI tests: `cd packages/{web,cli} && npx vitest run <file>`; run tests in the **foreground**.

## Hard invariants (from CLAUDE.md / constitution — bind every task)

- Bun workspaces; **no new dependencies**.
- Remote catalog only; `MockCatalogService` stays empty; tests inject stubs.
- No catalog call at create time; `multiInstance` is copied from the finalized manifest already in hand (Constitution III). Join/Leave are the existing metadata PATCH — no job.
- Real/Mock pairs: `MockConfigService` mirrors the new field/default/merge and stays permissive; `MockDeploymentService` base stays permissive.
- Guard decision table and recorded reasons (`channel`, `operator-override`) unchanged (ADR 0005 §4). Channel names stay open strings; `stable` is the floor. No `beta` enum.
- Conflict messages contain none of `--allow-multiple`, `--channel`, "install another" (SC-003); the discriminator is `details.code`, top-level `code` stays `CONFLICT` (PROVIDER_EXISTS convention).
- Enrolment fails closed on the web (pending/error → not enrolled). Turning it off never changes a copy's channel.
- Deferred work becomes a GitHub issue, never an inline TODO.
- Gates before PR: `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build` (typecheck twice; re-run after any lint auto-fix).

---

## Phase 1: Setup

- [X] T001 Record the baseline in the **Baseline** section below: run `bun run test` and `cd packages/cli && npx vitest run` in the foreground on the unchanged branch and note pass/fail counts per package.

---

## Phase 2: Foundational (blocking prerequisites)

- [X] T002 [P] Shared wire types in `packages/shared/src/index.ts`: `GetSettingsResponse.channels?: { showPrerelease?: boolean }` (~:1729); `versionChannel?: string` on `DeploymentListItem` (~:1352), `DeploymentDetail` (~:1393) and `GetDeploymentUpdateCheckResponse` (~:1443); `multiInstance?: boolean` on `DeploymentListItem`, `DeploymentDetail` and `EnhancedDeploymentDetail` (~:1984); `GetDeploymentsRequest.prerelease?: boolean` (~:1385). Doc comments per data-model.md.
- [X] T003 [P] Server settings test (new) `packages/server/src/__tests__/config/system-settings.test.ts` against `RealConfigService` over a temp storage root (pattern: existing config tests / `MockStorageService`): default `channels.showPrerelease === false`; `updateSystemSettings({ channels: { showPrerelease: true } })` round-trips through `getSystemSettings`; a PATCH of another field keeps `channels`; a PATCH of `channels` deep-merges; `showPrerelease: 'yes'` rejects with a `ValidationError` (status 400, message containing "must be a boolean"); `MockConfigService` default is `false` and mirrors the merge.
- [X] T004 Server settings implementation in `packages/server/src/services/core/config.ts`: `SystemSettings.channels?` (:13), defaults at `:54` (Real) and `:323` (Mock), deep-merge clause for `channels` in both `updateSystemSettings` (:164-175, :355-364), boolean validation in `validateSystemSettings` (:240-291, precedent `:296`), and `updateSystemSettings` throws `ValidationError` (`middleware/error-mapping.ts:32`) instead of a plain `Error` (:180). Parity-only edits: `services/core/database-config.ts:14` type and `:128-139` merge, `repositories.ts:114` default.
- [X] T005 Settings routes in `packages/server/src/server.ts:1644-1691`: add `channels` to the GET projection (:1651-1656), the GET error fallback (:1661-1666) and the PATCH projection (:1679-1684); confirm the route's 400 comment (:1687) is now true. Add a route-level test `packages/server/src/__tests__/config/settings-routes.test.ts` (new; harness pattern from `__tests__/system/monitoring.test.ts`) asserting GET returns `channels.showPrerelease: false` by default, PATCH `{ channels: { showPrerelease: true } }` returns it and GET reflects it, and PATCH `{ channels: { showPrerelease: 'yes' } }` returns 400 with a message containing "must be a boolean".
- [X] T006 [P] Web enrolment hook (new) `packages/web/src/hooks/usePrereleaseEnrolment.ts`: `usePrereleaseEnrolment(): boolean` over `useSettingsApi()` (`hooks/useSettingsApi.ts:17`), `data?.channels?.showPrerelease === true`, `false` while loading or on error (R2). Export from `hooks/index` if one exists.
- [X] T007 [P] `versionChannel` server tests in `packages/server/src/__tests__/deployments/update-info.test.ts` (helper `makeCatalog(versions)` accepts `{ version, channel }`): list item, detail and update-check carry `versionChannel` equal to the running version's listed channel (stable copy running a stable build → `'stable'`; beta copy running `1.3.0-beta.1` → `'beta'`); absent when the running version is not listed; absent when the catalog throws; `latestVersion`/`latestVersionChannel`/`updateAvailable` unchanged for the existing cases.
- [X] T008 `versionChannel` implementation in `packages/server/src/services/core/deployment.ts`: base `enrichUpdateInfo` item type gains `versionChannel?` (:1171); Real override (:2634-2678) memoizes the full `getVersions` entries per `${source}::${app}` and derives newest-eligible + the running version's channel (R3); both `buildUpdateCheck` (:1106, :2687) copy `versionChannel`.
- [X] T009 [P] `multiInstance` persistence tests in `packages/server/src/__tests__/deployments/persistence.test.ts` (helpers `makeCatalog({ multiInstance })`, `makeSystem`, `finalizedDraft`): a multi-instance manifest yields `multiInstance: true` on the create response, list item and detail, and survives a service restart (re-load from storage); a single-instance manifest yields no field; a record without the field reads as absent.
- [X] T010 `multiInstance` implementation in `packages/server/src/services/core/deployment.ts`: persist on the record literal (:857-862) from `artifacts?.manifest.multiInstance === true` (already read at :789); project in `toListItem` (:316) and `toDetailResponse` (:336).
- [X] T011 [P] Shared UI (new) `packages/web/src/components/ui/ChannelPill.tsx`: `ChannelPill({ channel, kind: 'follows' | 'build' | 'published' })` with the neutral classes from `pages/Deployments.tsx:381-387` and titles per contracts/web.md; export `pillFor({ channel, versionChannel })` per data-model.md. Unit-test `pillFor` in `packages/web/src/__tests__/components/ChannelPill.test.tsx` (new): build wins over follows; stable/stable → null; unknown build + beta track → follows.
- [X] T012 [P] Shared UI (new) `packages/web/src/components/ui/ConfirmDialog.tsx`: `{ open, title, body, confirmLabel, busy?, error?, danger?, onConfirm, onCancel }` extracted from the inline upgrade dialog in `pages/DeploymentDetail.tsx:1075-1181` (overlay, `role="dialog"`, `aria-labelledby`, backdrop click closes). Migrate the upgrade dialog to it in the same task; `DeploymentDetail.test.tsx` upgrade-dialog assertions must stay green unchanged.
- [X] T013 [P] SDK in `packages/sdk/src/index.ts`: `export class HolaApiError extends Error { status; code?; details?; requestId? }`; `parseJson` (:234-241) parses `{ error: { code, message, details, requestId } }` bodies into it (message = server message) and falls back to the legacy `HTTP <status> <statusText>: <text>` message otherwise (still a `HolaApiError`); add `settings = { get, update }` beside `system` (R6). The SDK package has no test runner (scripts: build/typecheck/lint only), so `HolaApiError` parsing is covered in `packages/cli/src/__tests__/install.test.ts` (T032) plus a small `packages/cli/src/__tests__/sdk-errors.test.ts` (new) that calls `parseJson`-backed SDK methods against a stubbed `fetchImpl` returning a JSON error body and a plain-text body.

**Checkpoint**: `bun run typecheck` green across packages; T003, T007, T009, T011 suites green.

---

## Phase 3: User Story 6 — Settings shows the enrolment and its consequences (Priority: P2)

**Goal**: the "Pre-release apps" card: toggle, explainer, and the always-visible count line.

**Independent test**: render the exported card with the settings API stubbed off and two non-stable deployments → count line present; flip → PATCH `{ channels: { showPrerelease: true } }`; line persists.

### Tests for User Story 6

- [X] T014 [P] [US6] New `packages/web/src/__tests__/pages/Settings.prerelease.test.tsx` (pattern: `Settings.catalogSources.test.tsx` rendering an exported card; stub `global.fetch` for `/api/settings` and `/api/deployments`): renders heading "Pre-release apps", switch labelled "Show pre-release channels (beta, rc)" reflecting `false`/`true`, the explainer, "2 installed apps currently follow a pre-release channel" with two non-stable rows in both toggle states, no line with zero; toggling calls PATCH with `{ channels: { showPrerelease: true } }`.

### Implementation for User Story 6

- [X] T015 [US6] Exported `PrereleaseCard` in `packages/web/src/pages/Settings.tsx` (pattern: exported `CatalogSourcesCard` :141; switch visual :698-714; card shell classes as siblings at :583): reads `useSettingsApi()` and the deployments list (`limit` large enough or a dedicated count) for the line; `updateSettings({ channels: { showPrerelease } })`; render it in the page after the System environment card.

**Checkpoint**: US6 independently testable.

---

## Phase 4: User Story 1 — An operator who never asked for betas never sees them (Priority: P1) 🎯 MVP

**Goal**: with enrolment off, no channel chrome on catalog, wizard (unless `?channel=`) or detail; existing non-stable copies keep their pill/offers. Includes the catalog card rework (links removed regardless of enrolment) and the wizard radio group.

**Independent test**: with `/api/settings` returning `showPrerelease: false` and an app publishing `stable` + `beta`, Catalog shows one Install action and no pill/"available" text; the wizard opened from the card has no Channel radio; opened with `?channel=beta` it has the radio with `beta` selected and the note; Deployments/Detail still show the pill for a copy following `beta`.

### Tests for User Story 1

- [X] T016 [P] [US1] `packages/web/src/__tests__/pages/Catalog.test.tsx`: add `/api/settings` to `mockApi` (:22-32) with a per-test `showPrerelease`; rewrite the `#428` block (:141-186): no "rc available" text and no "Install on rc" link in either enrolment state; pill `rc` present only when enrolled; no-stable-version primary routing kept (:173-181); "+ Another" absent for a single-instance installed app and present when the installed item reports `multiInstance: true`; "Installed ✓" and "Manage" present.
- [X] T017 [P] [US1] `packages/web/src/__tests__/pages/InstallWizard.channels.test.tsx`: add a settings stub to the `api-hybrid` mock (or `global.fetch` for `/api/settings` if the wizard's hook fetches directly) with a toggle; radio group absent when not enrolled and no `?channel=`; present (role `radiogroup`, options "Stable (recommended)" and "rc — pre-release") when enrolled with two channels; present with `rc` checked when opened with `?channel=rc` while not enrolled; selecting a radio triggers the draft recreate on the new channel (existing `switchChannel` assertions); the note renders for an implied non-stable channel (draft resolved `channel: 'rc'` with no explicit choice) and names the channel and empty data.
- [X] T018 [P] [US1] `packages/web/src/__tests__/pages/Deployments.test.tsx` and `DeploymentDetail.test.tsx`: with settings off, a copy following `beta` still renders its pill (list) and its Channel block with Leave (detail) — assert alongside the US2/US5 rewrites (same files; coordinate with T022 (list) and T025/T027 (detail) — write the not-enrolled cases here, keep them green through the later rewrites).

### Implementation for User Story 1

- [X] T019 [US1] Catalog card in `packages/web/src/pages/Catalog.tsx`: installed map (:191-201) records `multiInstance` (any copy); delete `installToWithChannel`/`installOnChannels`/per-channel links (:340-341, :359-360, :438-449) and the "<c> available" text (:390-393); action row gets `flex-wrap` (:406) and links `whitespace-nowrap flex-none`; installed branch renders `Installed ✓` + `Manage` + `+ Another` (`installAnotherTo`, :353) only when `multiInstance`; when `usePrereleaseEnrolment()` and `nonStableChannels.length > 0`, render `<ChannelPill channel={nonStableChannels.join(', ')} kind="published" />` beside the version; `primaryInstallTo` (:364-366) unchanged.
- [X] T020 [US1] Wizard channel choice in `packages/web/src/pages/InstallWizard.tsx`: replace the `<select>` (:1635-1651) with `RadioGroup` (`components/ui/fields/RadioGroup.tsx`) near the top of the summary step, options per contracts/web.md, `onChange → switchChannel`, disabled while `channelSwitching`, keep `channelSwitchError`; gate on `(usePrereleaseEnrolment() && availableChannels.length > 1) || searchParams.has('channel')`; unify the non-stable note (:1687-1700) and the "Following channel" line (:1705-1709) on `followedChannel !== STABLE_CHANNEL` with the FR-017 wording.

**Checkpoint**: US1 independently testable — SC-001 holds; `#428` catalog/wizard assertions rewritten and green.

---

## Phase 5: User Story 5 — The catalog card and deployments list stop shouting about channels (Priority: P2)

**Goal**: list pill via `pillFor`, Pre-release chip → server-side `prerelease=true` filter before pagination.

**Independent test**: list rows with `{ channel: 'stable', versionChannel: 'beta' }` show `beta` with the build tooltip; `{ channel: 'beta' }` without `versionChannel` shows `beta` with the follows tooltip; stable/stable shows nothing; the chip sends `prerelease=true`; server test proves the filter and `total`.

### Tests for User Story 5

- [X] T021 [P] [US5] `packages/server/src/__tests__/deployments/channels.test.ts`: `listDeployments({ prerelease: true })` with three copies (follows `rc`; follows `stable` running a listed `rc` build; stable/stable) returns the first two with `total: 2`; combined with `status` narrows further; `limit: 1, page: 2` returns the second (filter precedes pagination); without `prerelease` all three return.
- [X] T022 [P] [US5] `packages/web/src/__tests__/pages/Deployments.test.tsx` pill block (:152-207): the three `pillFor` cases above via `title` text; the "Pre-release" chip appears when any row is non-stable (settings off) and when enrolled (rows all stable); clicking it calls the list API with `prerelease: true` and resets the page; toggling off drops the param.

### Implementation for User Story 5

- [X] T023 [US5] Server filter in `packages/server/src/services/core/deployment.ts`: split `filterAndPaginateDeployments` (:356-381) into filter → (optional enrich + prerelease keep) → paginate; `listDeployments` (:1024-1030) takes the prerelease branch when `request.prerelease` (enrich all filtered items, keep `channel !== 'stable' || (versionChannel && versionChannel !== 'stable')`, then paginate; default path unchanged). Route `packages/server/src/server.ts:1020-1034` reads `searchParams.get('prerelease') === 'true'`.
- [X] T024 [US5] List page in `packages/web/src/pages/Deployments.tsx`: replace the inline pill (:379-388) with `pillFor` → `ChannelPill`; add `const [prerelease, setPrerelease] = useState(false)` folded into the query (:76-77) as `prerelease: prerelease || undefined`; "Pre-release" chip in the filter row (:290-310) shown when `usePrereleaseEnrolment()` or any visible row is non-stable, styled like the status chips but independently toggled, resets `page`. Update the deployments API hook/query key so the param is sent and cached distinctly.

**Checkpoint**: US5 independently testable.

---

## Phase 6: User Story 2 — An enrolled operator joins and leaves a channel on the copy they run (Priority: P1)

**Goal**: the Channel block on Overview with Join/Leave behind `ConfirmDialog`, the honest leaving state, and the header channel suffix; Details facts and the Configuration card removed.

**Independent test**: detail of a stable copy with catalog channels `['stable','beta']` and settings on → block shows "Follows: stable", "Running 1.2.0, a stable build", **Join beta**; confirm → `update(id, { channel: 'beta' })` and query invalidation; a beta copy running `1.3.0-beta.1` → **Leave beta** dialog contains "Stays on 1.3.0-beta.1 until a stable release at or above it is published."; header button reads "Upgrade to 1.3.0-beta.1 (beta)".

### Tests for User Story 2

- [X] T025 [P] [US2] `packages/web/src/__tests__/pages/DeploymentDetail.test.tsx` release-channels block (:421-570) rewrite: Channel block texts for (stable/stable), (beta track, stable build), (beta track, beta build), (stable track, beta build), unknown build (version alone); Join present only when enrolled and the channel is published and not followed; Leave present regardless of enrolment when following non-stable; Join confirm body text; Leave confirm body with and without the stays-on sentence; confirming calls `deploymentsApi.update(id, { channel })` (replaces :529-543) and invalidates (keeps :545); warning surfaces via `TransientNotice` (:559-568); the old Instance string (:478) and the Configuration-tab "Release channel" card are gone; header button and confirm label carry `(beta)` when `latestVersionChannel` is non-stable (:508 + new).

### Implementation for User Story 2

- [X] T026 [US2] Channel block in `packages/web/src/pages/DeploymentDetail.tsx`: new Overview card (contracts/web.md) using `deployment.channel`, `deployment.version`, `deployment.versionChannel`, `catalogApp?.channels`, `usePrereleaseEnrolment()`; Join per published non-stable channel not followed (enrolled), Leave when followed non-stable; both through `ConfirmDialog` → `handleChannelChange` (:433-444, keep the warning path); leaving-note condition per data-model.md; remove the `Channel` (:472) and `Instance` (:479-492) facts and the Configuration-tab card (:891-927) plus now-unused state; header button (:1265-1275) and confirm label (:1174) append `(${latestVersionChannel})` when non-stable.

**Checkpoint**: US2 independently testable — SC-002 holds.

---

## Phase 7: User Story 3 — An enrolled operator rehearses a pre-release in a separate copy (Priority: P2)

**Goal**: the secondary separate-copy link and the sibling sentence with the override-only note.

**Independent test**: detail of a stable copy, enrolled, app publishes `beta` → link "Try beta in a separate copy →" to `/catalog/<app>/install?channel=beta`; absent when not enrolled; with `siblings: [{ name: 'gitea-beta', channel: 'beta' }]` → "gitea-beta (beta) is also installed"; with `instanceReason: 'operator-override'` → muted "installed with operator override"; never "permitted by channel".

### Tests for User Story 3

- [X] T027 [P] [US3] `packages/web/src/__tests__/pages/DeploymentDetail.test.tsx`: the four assertions above, plus: two siblings → two sentences; `instanceReason: 'channel'` → no note.
- [X] T028 [P] [US3] `packages/web/src/__tests__/pages/InstallWizard.channels.test.tsx`: opened via `?channel=beta` from the link (not enrolled or enrolled): radio shows `beta` checked and the note says the copy follows `beta` and starts with empty data.

### Implementation for User Story 3

- [X] T029 [US3] In the Channel block (`packages/web/src/pages/DeploymentDetail.tsx`, T026's card): sibling sentences per FR-012 from `deployment.siblings` + `deployment.instanceReason`; secondary link(s) per published non-stable channel not followed when enrolled.

**Checkpoint**: US3 independently testable.

---

## Phase 8: User Story 4 — The wizard turns "already installed" into a choice (Priority: P2)

**Goal**: structured `ALREADY_INSTALLED` conflict from the server; wizard panel with three actions; CLI hint from details.

**Independent test**: server test asserts the 409 details shape for both branches and the `existing` selection; wizard test stubs `create` rejecting with `{ code: 'CONFLICT', details: { code: 'ALREADY_INSTALLED', … } }` and asserts the actions; CLI test asserts the hint text from a `HolaApiError`.

### Tests for User Story 4

- [X] T030 [P] [US4] `packages/server/src/__tests__/deployments/persistence.test.ts` `#428` guard block (:401-470): rewrite the same-channel rejection (:422-430) to assert `err.code === 'CONFLICT'`, `err.details.code === 'ALREADY_INSTALLED'`, `existing` `{ id, name, channel: 'rc' }`, `channelPublished: true`, and that the message contains none of `--allow-multiple`, `--channel`, `install another`; add the unpublished-channel branch (`channelPublished: false`, message names the channel and "no versions published"); add the selection rule: with copies on `stable` (older) and `rc` (newer), a request on `rc` names the rc copy, a request on an unpublished channel names the older stable copy; `operator-override` (:432-446) and multiInstance (:459) cases unchanged.
- [X] T031 [P] [US4] `packages/web/src/__tests__/pages/InstallWizard.channels.test.tsx` (409 stub shape from `InstallWizard.grants.test.tsx:170-190`): panel sentence "gitea is already installed and follows stable."; Switch action present when requested `beta` ≠ existing `stable`, clicking calls `deployments.update('dep-1', { channel: 'beta' })`, removes the draft (best-effort) and navigates to `/deployments/dep-1`; failure keeps the panel with an error; "Open gitea" link; "Install a separate beta copy" present when `channelPublished: true` and re-finalizes with `allowMultiple: true`; absent when `channelPublished: false`; when channels are equal, no Switch and the third action reads "Install another copy (operator override)".
- [X] T032 [P] [US4] `packages/cli/src/__tests__/install.test.ts`: `sdk.deployments.create` rejects with a `HolaApiError` (`status: 409, code: 'CONFLICT', details: { code: 'ALREADY_INSTALLED', existing: { id: 'dep-1', name: 'gitea', channel: 'stable' }, channelPublished: true }`) → stderr has `Failed: <message>` and a hint naming `hola channel dep-1`, `--channel`, `--allow-multiple --name gitea-2`, exit code 1; with `channelPublished: false` the `--channel` clause is absent; the existing bare-`Error` case (:296-310) still passes.

### Implementation for User Story 4

- [X] T033 [US4] Guard in `packages/server/src/services/core/deployment.ts:3252-3279`: compute `existing` per R5 (same-channel copy else min `metadata.createdAt`), throw `ConflictError(message, { code: 'ALREADY_INSTALLED', existing: { id, name, channel }, channelPublished: channelPublished === true })` with the two surface-neutral messages from contracts/api.md; decision table untouched.
- [X] T034 [US4] Wizard conflict panel in `packages/web/src/pages/InstallWizard.tsx`: lift `allowMultiple` to state seeded from `?another=1` (:262, used at :508); add the `ALREADY_INSTALLED` branch beside the `PROVIDER_EXISTS` one (:1820-1840) with the three actions per contracts/web.md (`api.deployments.update`, best-effort `draftsApi.remove`, `navigate`; `setAllowMultiple(true)` then `finalizeDraft()`); local error state for a failed Switch.
- [X] T035 [US4] CLI hint in `packages/cli/src/lib/deploy-flow.ts:113-132`: replace the `/single-instance/i` sniff with `err instanceof HolaApiError && details.code === 'ALREADY_INSTALLED'` → print the hint per contracts/cli.md (`--channel` clause only when `channelPublished`); keep the other hints.
- [X] T036 [US4] Error-code reference in `packages/shared/src/docs/api-explorer.ts`: new exported `API_ERROR_CODES` per contracts/api.md; add `prerelease` to the deployments-list endpoint parameters and `channels` to the settings endpoint docs (:900-937); widen the `CreateDeploymentRequest` schema string (:1157) to mention `allowMultiple`. If `pages/ApiExplorer.tsx` (or equivalent) renders `API_ENDPOINTS`, render the table beneath it.

**Checkpoint**: US4 independently testable — SC-003 holds.

---

## Phase 9: User Story 7 — The CLI can show and change the channel a copy follows (Priority: P3)

**Goal**: `hola channel <id> [channel]` and `hola settings prerelease [on|off]`.

**Independent test**: unit tests with an injected stub SDK for show, set (+ warnings), the stays-on note, `--json`; prerelease show/on/off/usage error.

### Tests for User Story 7

- [X] T037 [P] [US7] New `packages/cli/src/__tests__/channel.test.ts` (pattern `deployments-list.test.ts`): show prints `Follows: stable` and `Running: 1.2.0 (stable build)`; unknown build prints `Running: 1.2.0`; set calls `sdk.deployments.update('dep-1', { channel: 'beta' })` and prints `Now follows: beta`; a `warnings` entry prints `Warning: …`; set to `stable` when the re-read detail has `versionChannel: 'beta'` prints the stays-on sentence; `--json` prints JSON; a `HolaApiError` (400 INVALID_CHANNEL) prints `Failed: <message>` and sets exit code 1.
- [X] T038 [P] [US7] New `packages/cli/src/__tests__/settings-prerelease.test.ts`: no value → `sdk.settings.get` → `Show pre-release channels: off`; `on`/`off` → `sdk.settings.update({ channels: { showPrerelease: true|false } })` and echo; `maybe` → usage line and exit code 1.

### Implementation for User Story 7

- [X] T039 [P] [US7] New `packages/cli/src/commands/deployments/channel.ts`: `runChannel(deploymentId, channel, opts, injected?)` on the `runConfig` template (`commands/deployments/config.ts:41`), per contracts/cli.md; `maybeNotifyUpdate` on success.
- [X] T040 [P] [US7] New `packages/cli/src/commands/settings/prerelease.ts`: `runSettingsPrerelease(value, opts, injected?)` per contracts/cli.md.
- [X] T041 [US7] Register both in `packages/cli/src/index.ts` (`channel <deploymentId> [channel]` with `--json`; `settings prerelease [value]` with `--json`), lazy-imported like the others; keep `hola deployments` `[channel]` suffix (`deployments.ts:34-38`).

**Checkpoint**: US7 independently testable — SC-007 holds.

---

## Phase 10: Polish, docs, follow-ups, gates

- [X] T042 [P] Amend `docs/adr/0005-release-channels.md`: insert `### 7. Operator model` after §6 (before "Rejected alternatives", ~:176) recording the three layers, `channels.showPrerelease` (default off, gates discovery only, never changes a copy's channel), `versionChannel` as a separate fact, Join/Leave semantics and the honest leaving state, the separate-copy action, `ALREADY_INSTALLED` (details shape, `existing` selection rule, surface-neutral messages), and the shared-read/fail-closed rule; add `ALREADY_INSTALLED` (409, `details.code`) to the "New error codes" bullet in Consequences (~:212-214); status line notes the amendment date.
- [X] T043 [P] Rewrite `docs/OPERATIONS.md` `### Release channels` (~:403-460) as `### Trying pre-release versions of apps`: enable in Settings (or `hola settings prerelease on`), what the catalog pill means, Join/Leave from the deployment Overview and what leaving means, the separate-copy path and the guard, `hola channel`, the conflict message and the CLI hint; remove the quoted Instance string (~:429-431) and the "Configuration → Channel" pointer (~:459).
- [X] T044 [P] `CLAUDE.md` release-channels bullet (:98-105): one sentence on enrolment (`settings.channels.showPrerelease`, discovery-only) and the Join/Leave model with `versionChannel`; keep the `<!-- SPECKIT -->` block pointing at `specs/005-beta-channel-ux/plan.md`.
- [X] T045 [P] File `gh issue create` "Apps launcher: pre-release pill on tiles for copies following a non-stable channel" (reference spec 005, `ChannelPill`); record: **issue A: #444**.
- [X] T046 [P] File `gh issue create` "Notify when a followed pre-release channel publishes a new version" (reference spec 005, `versionChannel`, update offers); record: **issue B: #445**.
- [X] T047 [P] File `gh issue create` "Consolidate the remaining hand-rolled dialogs (DeploymentDetail remove, Deployments remove) onto ConfirmDialog" (reference T012); record: **issue C: #446**.
- [X] T048 [P] File `gh issue create` "SystemSettings is defined twice and the DB-backed config service is unreachable from /api/settings" (config.ts vs database-config.ts/repositories.ts; settings-upsert.test.ts tests the unused path); record: **issue D: #447**.
- [X] T049 Sweep: no inline TODOs added; no dead code left (old select/facts/card state in DeploymentDetail, `installOnChannels` in Catalog, the regex sniff in deploy-flow); `bun run lint` then `bun run typecheck` again after any auto-fix.
- [X] T050 Run the full gate in the foreground from the repo root: `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build`, plus `cd packages/cli && npx vitest run`; compare against the Baseline; fix until green. Record final counts under **Test evidence**.

---

## Dependencies

- Phase 2 blocks every story. Within Phase 2: T002 first (types); T003→T004→T005; T007→T008; T009→T010; T006, T011, T012, T013 parallel with the rest.
- US6 (Phase 3) needs T004/T005/T006. US1 (Phase 4) needs T006, T010 (multiInstance on list items), T011. US5 (Phase 5) needs T008 (versionChannel), T011. US2 (Phase 6) needs T006, T008, T012. US3 (Phase 7) extends US2's card (T026 before T029). US4 (Phase 8) needs T013 (SDK error) for T032/T035 and T010 for nothing — server side independent after Phase 2. US7 (Phase 9) needs T013.
- File-overlap serialisation: `DeploymentDetail.tsx` is edited by T012 → T026 → T029 (sequential); `InstallWizard.tsx` by T020 → T034 (sequential); `Catalog.tsx` by T019 only; `deployment.ts` by T008, T010, T023, T033 (sequential, different regions — land in that order); `DeploymentDetail.test.tsx` by T018/T025/T027 (one owner at a time); `InstallWizard.channels.test.tsx` by T017/T028/T031 (one owner at a time).
- Phase 10 after all stories; T042–T048 parallel; T049–T050 last.

## Parallel execution examples

- Phase 2: T002 ∥ T006 ∥ T011 ∥ T012 ∥ T013; then T003 ∥ T007 ∥ T009 (tests) → T004/T005, T008, T010.
- Stories: US6 (T014→T015) ∥ US5 server (T021→T023) ∥ US4 server (T030→T033) ∥ US7 (T037/T038 → T039/T040 → T041) can proceed concurrently with US1/US2 web work as long as the file-overlap rule above is respected.
- Phase 10: T042–T048 all parallel.

## Implementation strategy

1. **MVP** = Phase 2 + US6 + US1: enrolment exists, defaults off, and the dashboard stops showing beta chrome nobody asked for.
2. Then US5 (list/catalog polish) and US2 (Join/Leave) — the primary path.
3. Then US3 (side-by-side) and US4 (conflict) — the escape hatches, done properly.
4. Then US7 (CLI), docs, follow-ups, gates.

## Baseline

Recorded 2026-09-08 on `005-beta-channel-ux` before any implementation changes:

- `bun run test` (server): 920 pass / 0 fail, 2560 expect() calls, 89 files.
- `bun run test` (web, vitest): 291 pass / 0 fail, 49 files.
- `cd packages/cli && npx vitest run`: 243 pass / 0 fail, 22 files.
- No pre-existing failures in any package.

## Test evidence

Recorded 2026-09-08 on `005-beta-channel-ux` after all tasks (T006–T050) landed. Full gate run
in the foreground from the repo root, in order:

1. `bun run typecheck` (1st pass) — PASS: `@hola/compose` (no types), `@hola/shared`,
   `@hola/sdk`, `@hola/web`, `@hola/server`, `@hola/cli` all exit 0.
2. `bun run lint` — PASS: `@hola/compose` (no lint), `@hola/shared`, `@hola/sdk`, `@hola/cli`,
   `@hola/server` all exit 0 with no errors/warnings. `@hola/web` exits 0 with **1 warning**
   (not an error, does not fail the gate): `react-refresh/only-export-components` on
   `ChannelPill.tsx` — expected, since T011 deliberately co-locates the `pillFor` helper with
   the `ChannelPill` component in the same file per the task spec.
3. `bun run typecheck` (2nd pass, post-lint) — PASS: all packages exit 0 (lint made no
   auto-fix changes, so this pass is identical to the first).
4. `bun run test`:
   - server (`bun:test`): **949 pass / 0 fail**, 2648 expect() calls, 91 files (baseline: 920
     pass, 89 files → **+29 tests, +2 files**). After the review pass and the two post-review
     additions (multiInstance backfill, settings redaction): **951 pass / 0 fail**.
   - web (`vitest`): **348 pass / 0 fail**, 52 files (baseline: 291 pass, 49 files →
     **+57 tests, +3 files**).
5. `bun run build` — PASS: `@hola/sdk`, `@hola/compose`, `@hola/server`, `@hola/cli`,
   `@hola/web` all exit 0. (`@hola/shared` has no build script.) The web build emits a
   pre-existing chunk-size-warning (>500kB minified bundle) unrelated to spec 005 — not a
   failure.
6. `cd packages/cli && npx vitest run` — PASS: **261 pass / 0 fail**, 25 files (baseline: 243
   pass, 22 files → **+18 tests, +3 files**).

No pre-existing failures were chased (none existed per the Baseline). One lint issue was found
and fixed during T049/T050 (4× `@typescript-eslint/no-explicit-any` in
`persistence.test.ts`'s new ALREADY_INSTALLED tests, introduced by the US4 subagent) — retyped
the caught errors as `ConflictError` with the codebase's established
`(err.details as {...})` cast pattern (matching `contract-provider-guard.test.ts` and
`draft-validation.test.ts`); re-verified 37/37 in that file and the full gate sequence above
after the fix.

## Review pass (Step 7)

- 15 findings, 12 fixed in place (incl. a CLI 401-hint regression from the SDK message change and a hardcoded Stable radio option for stable-less apps); 3 deferred.
- Deferred #8 (pre-feature records lose "+ Another") addressed after review: `backfillMultiInstance` in `RealDeploymentService` + persistence test (see research.md R4).
- Out-of-scope discovery addressed: `GET/PATCH /api/settings` returned `notifications.smtpPassword`; responses now drop it (`redactNotifications` in `server.ts`) with a route test, since every dashboard page reads settings for enrolment.

## Follow-up issues filed

- issue A (launcher pill): #444
- issue B (channel-publish notification): #445
- issue C (ConfirmDialog consolidation): #446
- issue D (duplicated SystemSettings / unreachable DB config): #447

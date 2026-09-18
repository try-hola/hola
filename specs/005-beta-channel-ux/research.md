# Research: Beta Channel Support for Catalog Apps (Operator Model)

**Feature**: `005-beta-channel-ux` · **Date**: 2026-09-08 · **Sources**: plan prompt "Beta channel support for catalog apps: mental model + change plan"; Notion Spec Prompts row (Sequence 2)

All anchors verified against `main` at `0fe0216` (0.11.0-rc.2) by a read-only sweep on 2026-09-08. Line numbers below refer to that commit.

## R1. Where the enrolment setting lives and how it reaches the wire

**Decision**: `SystemSettings.channels?: { showPrerelease?: boolean }` in `packages/server/src/services/core/config.ts:13`, with the same field added to the byte-identical copy in `database-config.ts:14` (typecheck parity only; the DB-backed config service is not reachable from `/api/settings`). Defaults gain `channels: { showPrerelease: false }` at all three default sites (`config.ts:54`, `config.ts:323` Mock, `repositories.ts:114`). `updateSystemSettings` (`config.ts:159-195`, mirrored in the Mock at `:354-368`) gains a fourth deep-merge clause `...(updates.channels && { channels: { ...current.channels, ...updates.channels } })` so a later second field cannot clobber the first. The GET projection (`server.ts:1651-1656`), the PATCH projection (`:1679-1684`) and the GET error fallback (`:1661-1666`) all add `channels`. Shared `GetSettingsResponse` (`shared/src/index.ts:1729`) gains `channels?: { showPrerelease?: boolean }`; `PatchSettingsRequest` stays `Partial<GetSettingsResponse>`.

**Validation**: `validateSystemSettings` (`config.ts:240-291`) gains `if (settings.channels?.showPrerelease !== undefined && typeof settings.channels.showPrerelease !== 'boolean') errors.push('Show pre-release channels must be a boolean')`, following the `validateBackupSettings` precedent at `:296`. `updateSystemSettings` currently throws a plain `Error('Validation failed: …')` (`:180`), which `mapErrorToResponse` renders as **500 INTERNAL_ERROR** with the message swallowed — contradicting the route comment at `server.ts:1687`. It is changed to throw the typed `ValidationError` (`error-mapping.ts:32`) so every settings validation failure becomes the 400 the route already claims. `MockConfigService.validateSystemSettings` stays permissive (`[]`); the Mock mirrors the field, default and merge clause. The rejection test targets `RealConfigService` over a temporary storage root.

**Rationale**: FR-001 asks for the same validation path as other fields; that path was silently broken, and fixing it is a one-line class swap that makes the spec's edge case ("rejected with the validation error the settings endpoint uses for other fields") true rather than aspirational. Keeping the Mock permissive preserves Constitution IV (hermetic tests) while still mirroring the field.

**Alternatives**: a separate `/api/settings/channels` endpoint (rejected: one more projection to keep in sync, no gain); validating in the route (rejected: the service owns validation today).

## R2. How dashboard pages learn the enrolment (one shared read, fail closed)

**Decision**: a new hook `packages/web/src/hooks/usePrereleaseEnrolment.ts` exporting `usePrereleaseEnrolment(): boolean`, implemented over `useSettingsApi()` (`hooks/useSettingsApi.ts:17-87`), returning `data?.channels?.showPrerelease === true`. While the read is pending, or when `data` is `null` after an error, it returns `false`. `useSettingsApi` already caches in `globalCache` under `'settings-system'` (30 s TTL) and sets `data: null` on error, so mounting the hook on Catalog, InstallWizard, Deployments and DeploymentDetail costs at most one fetch per TTL window and fails closed for free. `updateSettings` deletes the cache key, so a toggle on Settings is visible on the next navigation without a reload.

**Rationale**: the clarification asked for one shared read cached for the page session and a fail-closed default; the existing hook already provides both. A provider in `App.tsx` was rejected because nothing else in the app is a provider (`App.tsx:20-22` mounts only Theme and Auth), and every page test would then need the provider in its render tree.

**Alternatives**: a React context (rejected above); reading settings inside each page's own data hook (rejected: four copies of the same fetch).

## R3. Running-build channel (`versionChannel`) derived in `enrichUpdateInfo`

**Decision**: the Real `enrichUpdateInfo` (`deployment.ts:2634-2678`) changes its memo from `Map<'${source}::${app}::${channel}', newest | undefined>` to `Map<'${source}::${app}', VersionEntry[] | undefined>` holding the full `catalogService.getVersions(app, source).items` (each `{ version, createdAt, channel }`). From that list it derives, per item, (a) `newestEligibleVersion(entries, channel)` exactly as today for `latestVersion`/`latestVersionChannel`/`updateAvailable`, and (b) `entries.find(v => v.version === item.version)?.channel` as `versionChannel`. `versionChannel` is omitted when the version is not listed or the catalog call failed. The base signature (`:1171`) gains `versionChannel?: string`; `DeploymentListItem`, `DeploymentDetail` and `GetDeploymentUpdateCheckResponse` gain `versionChannel?: string`; both `buildUpdateCheck` (`:1106`, `:2687`) copy it. `getVersions` is served from the catalog's in-memory cache, so retaining the list is free; the channel dimension was never needed for the running-version lookup.

**Rationale**: FR-005 and the spec's assumption ("derived on read from the same per-channel version list the update-offer enrichment already fetches"). ADR 0005 §1 guarantees a version string appears at most once per app, so the lookup is unambiguous.

**Alternatives**: persisting the running version's channel at promote time (rejected: the deployment channel is sticky and the promote draft carries the *followed* channel, not the version's own — persisting would need a second catalog read at create time, against Constitution III); a separate catalog call per deployment (rejected: same data, more calls).

## R4. `multiInstance` persisted on the record

**Decision**: `EnhancedDeploymentDetail` gains `multiInstance?: boolean`; `createFromDraft` (`deployment.ts:789` already reads `artifacts?.manifest.multiInstance` for the guard) writes it on the record literal beside `channel` (`:857-862`) when the manifest says `true`; `toListItem` (`:316`) and `toDetailResponse` (`:336`) project it. Absent means single-instance; no migration.

**Rationale**: FR-013; the value is already in hand at create time and the finalized manifest is the source the guard itself uses, so the card's "+ Another" and the guard can never disagree.

**Pre-feature records (added after review)**: a record written before this feature has no flag, and the catalog card no longer offers the per-channel links that used to cover multi-instance apps, so a genuinely multi-instance app installed earlier would silently lose "+ Another". `RealDeploymentService.backfillMultiInstance` (called at the top of `enrichUpdateInfo`, i.e. on list/detail/update-check reads) derives the flag once from the active release manifest — the same source `createFromDraft` copies it from — and persists the answer (`true` or an explicit `false`) so the disk read happens at most once per record; an unreadable manifest leaves the field absent and is retried on the next read. Bounded by page size. No catalog call.

## R5. `ALREADY_INSTALLED` conflict shape and message text

**Decision**: `RealDeploymentService.assertInstanceAllowed` (`deployment.ts:3252-3279`) throws `new ConflictError(message, { code: 'ALREADY_INSTALLED', existing: { id, name, channel }, channelPublished })` following the `PROVIDER_EXISTS` convention (`:3291-3312`): the top-level `error.code` stays `CONFLICT` and the discriminator lives in `details.code`, which is what the wizard (`InstallWizard.tsx:1831`) and the SDK error already read. `existing` is the copy whose `channel ?? 'stable'` equals the requested channel when one exists, else the live copy with the smallest `metadata.createdAt` (Map insertion order is rehydration order, not age). `channelPublished` is `channelPublished === true`. Messages become surface-neutral:

- unpublished channel: `'<app>' is already installed as '<name>'. Channel '<c>' has no versions published for this app, so it does not count as a separate channel.`
- same channel: `'<app>' is already installed as '<name>' and follows '<c>'. This app is single-instance.`

Neither contains `--allow-multiple`, `--channel` or "install another" (SC-003). `persistence.test.ts:422-430` (asserts `/channel 'rc'.*--channel/s`) is rewritten to assert the details shape instead. The guard's decision table and the recorded reasons are untouched (ADR 0005 §4).

**Rationale**: FR-018 plus clarification Q1. Reusing `ConflictError.details` (`error-mapping.ts:167-177`) needs no new class; keeping the top-level code `CONFLICT` keeps every existing consumer (`code === 'CONFLICT'` checks) working.

**Alternatives**: top-level `code = 'ALREADY_INSTALLED'` (rejected: diverges from `PROVIDER_EXISTS`, and the wizard reads `details.code`); a separate error class (rejected: nothing to add).

## R6. SDK surfaces structured errors; CLI reads `details`

**Decision**: `packages/sdk/src/index.ts` gains `export class HolaApiError extends Error { status: number; code?: string; details?: unknown; requestId?: string }`. `parseJson` (`:234-241`) parses a JSON body of shape `{ error: { code, message, details, requestId } }` when present and throws `HolaApiError` with `message = error.message` and the parsed fields; when the body is not that shape it falls back to the current text, and `message` keeps the `HTTP <status> <statusText>: <text>` form for compatibility. The SDK also gains `settings = { get: () => this.get<GetSettingsResponse>(API.settings.base), update: (d: PatchSettingsRequest) => this.patch<PatchSettingsResponse>(API.settings.base, d) }`. `reportDeployError` (`cli/src/lib/deploy-flow.ts:113-132`) replaces the `/single-instance/i` regex with `err instanceof HolaApiError && (err.details as { code?: string })?.code === 'ALREADY_INSTALLED'`, printing the server message plus a hint built from `details`: `Hint: '<name>' (<id>) already follows <channel>. Use 'hola channel <id> <other>' to switch it, '--channel <name>' for a separate copy on another published channel, or '--allow-multiple --name <name>-2' to force a second copy.` The `--channel` clause is included only when `channelPublished` is true. The existing CLI conflict test (`install.test.ts:296-310`) stays valid (bare `Error` still prints and exits non-zero); a new case covers the typed error.

**Rationale**: FR-024 requires the hint to come from `details`; the SDK stringifies the body today. A typed error is the smallest change that gives the CLI (and any SDK user) the code and details without breaking `message`-based callers.

**Alternatives**: regex on the message (rejected: the spec's whole point is to stop coupling surfaces to prose); a CLI-local JSON parse of the message text (rejected: brittle, and the SDK is the right layer).

## R7. "Pre-release" list filter is server-side and pre-pagination

**Decision**: `GetDeploymentsRequest` (`shared/src/index.ts:1385`) gains `prerelease?: boolean`; the route (`server.ts:1020-1034`) reads `searchParams.get('prerelease') === 'true'`. In `listDeployments` (`deployment.ts:1024-1030`), when `prerelease` is set the service filters by status/`q` first, then **enriches every remaining item** (`enrichUpdateInfo`, catalog-cache reads keyed per `source::app`, host-scale N) and keeps rows where `channel !== 'stable'` or (`versionChannel` present and `!== 'stable'`), then paginates. `filterAndPaginateDeployments` is split so the prerelease branch can enrich between filtering and slicing; the default path is unchanged (enrich after pagination). The web chip is an independent `useState<boolean>` in `Deployments.tsx`, sent as `prerelease: true` in the query, ANDed with the status filter, resetting `page` like the status chips; it is not persisted (the status filter is not either).

**Rationale**: FR-021 and clarification Q2 — the status filter is applied by the server with server pagination (`deployment.ts:356-381`), so a client-side chip would under-fill pages. Enriching before pagination is bounded by the number of deployments on one host and reads the catalog cache only.

**Alternatives**: client-side filtering (rejected: pagination artefacts); followed-channel-only server filter (rejected: misses the "leaving beta" rows the spec names explicitly).

## R8. Shared `ChannelPill`, `ConfirmDialog`, and the Channel block

**Decision**:
- `packages/web/src/components/ui/ChannelPill.tsx`: `({ channel, kind }: { channel: string; kind: 'follows' | 'build' })`, neutral classes lifted from `Deployments.tsx:381-387`, `title` = `Follows the <c> channel` or `Running a <c> build`. A helper `pillFor({ channel, versionChannel })` returns `{ channel, kind } | null` per FR-010 (build channel when known and non-stable → `build`; else followed non-stable → `follows`; else null). Used by Deployments (replacing the inline literal), Catalog (new, enrolled only) and DeploymentDetail (new, in the Channel block).
- `packages/web/src/components/ui/ConfirmDialog.tsx`: extracted from the inline upgrade dialog (`DeploymentDetail.tsx:1075-1181`): overlay + `role="dialog"` + title/body/children + Cancel/confirm buttons with `busy`/`error` props. The upgrade dialog is migrated to it in the same change; the remove dialog and the Deployments dialog are left as-is (out of scope; noted as a follow-up in tasks, not an issue — pure refactor).
- **Channel block** (`DeploymentDetail.tsx`, Overview tab): a card between the header and the Details facts showing `Follows: <channel>`, the running-build line (`Running <version>, a <versionChannel> build` / `Running <version>` when unknown), sibling sentence(s) per FR-012, Join buttons (one per published non-stable channel not followed, enrolled only), Leave button (followed non-stable), and the separate-copy link (enrolled, per published non-stable channel not followed). The Details `Channel` and `Instance` facts (`:472-492`) and the Configuration-tab card (`:891-927`) are removed. Join/Leave call `updateConfiguration({ channel })` (`:433-444`) and surface `warnings[0]` through the existing `TransientNotice`.
- The leaving note condition: `versionChannel` known and `!isEligibleOnChannel(versionChannel, 'stable')`, i.e. `versionChannel !== 'stable'`; when unknown, the generic sentence per the edge case.
- Header button (`:1265-1275`) and confirm label (`:1174`) append `(<latestVersionChannel>)` when non-stable, matching the dialog title (`:1093-1099`).

**Rationale**: FR-006 to FR-012, FR-022. One pill and one dialog keep the three surfaces consistent; extracting the dialog avoids a fourth hand-rolled overlay.

## R9. Catalog card and install wizard

**Decision**:
- **Catalog** (`Catalog.tsx`): the installed map (`:191-201`) additionally records `multiInstance` (true if any copy reports it). Remove `installToWithChannel`/`installOnChannels` links (`:438-449`) and the "<c> available" text (`:390-393`). Action row (`:406`) gains `flex-wrap`; each link gets `whitespace-nowrap flex-none`. Installed branch: `Installed ✓` + `Manage` + `+ Another` only when `multiInstance`. When `usePrereleaseEnrolment()` and `nonStableChannels.length > 0`, render `<ChannelPill channel={nonStableChannels.join(', ')} kind="follows" />` beside the version with title "Also published on <channels>" (a third `kind: 'published'` on the pill). `primaryInstallTo` (`:364-366`) unchanged.
- **Wizard** (`InstallWizard.tsx`): `allowMultiple` becomes state seeded from `?another=1` (`:262`) so the conflict panel can set it and re-finalize. Channel select (`:1635-1651`) becomes a `RadioGroup` (`components/ui/fields/RadioGroup.tsx`) rendered when `(enrolled && availableChannels.length > 1) || searchParams.has('channel')`, options `Stable (recommended)` and `<c> — pre-release`, `onChange → switchChannel`. The non-stable note (`:1687-1700`) gates on `followedChannel !== STABLE_CHANNEL` and is reworded per FR-017. The finalize error box (`:1817-1845`) gains an `ALREADY_INSTALLED` branch rendering the sentence and the three actions: **Switch** (`api.deployments.update(existing.id, { channel: followedChannel })`, then `draftsApi.remove(draftId)` best-effort, then `navigate('/deployments/<id>')`; shown only when `existing.channel !== followedChannel`; on failure sets a local error under the panel), **Open** (`Link`), **Install a separate <c> copy** / **Install another copy (operator override)** (`setAllowMultiple(true)` then `finalizeDraft()`; shown only when `details.channelPublished`).

**Rationale**: FR-014 to FR-019.

## R10. CLI `hola channel` and `hola settings prerelease`

**Decision**: `packages/cli/src/commands/deployments/channel.ts` exporting `runChannel(deploymentId, channel | undefined, opts, injected?)` on the `runConfig` template (`config.ts:41`): with no channel → `sdk.deployments.byId(id)` and print `Follows: <channel>` and `Running: <version> (<versionChannel> build)` / `Running: <version>`; `--json` prints the detail. With a channel → `sdk.deployments.update(id, { channel })`, print `Now follows: <channel>`, print each `warnings[]` entry, then re-read the detail and, when `versionChannel` is known and not eligible on the new channel, print `Stays on <version> until a stable release at or above it is published.` Registered in `index.ts` as `channel <deploymentId> [channel]`. `packages/cli/src/commands/settings/prerelease.ts` exporting `runSettingsPrerelease(value | undefined, opts, injected?)`: no value → `sdk.settings.get()` and print `Show pre-release channels: on|off`; `on|off` → `sdk.settings.update({ channels: { showPrerelease } })` and echo; any other value → usage error, exit 1. Registered as `settings prerelease [value]`. `hola deployments` keeps the `[channel]` suffix (`deployments.ts:34-38`).

**Rationale**: FR-023 to FR-025; `sade` supports the multi-word command shape (`app data push` precedent, `index.ts:298`).

## R11. Error-code reference and docs

**Decision**: `packages/shared/src/docs/api-explorer.ts` gains an exported `API_ERROR_CODES: Array<{ code: string; status: number; endpoints: string[]; description: string; details?: string }>` listing `VALIDATION_ERROR`/`INVALID_CHANNEL` (400), `NOT_FOUND`/`NO_VERSION_ON_CHANNEL` (404), `CONFLICT` (409) with its `details.code` discriminators `PROVIDER_EXISTS` and `ALREADY_INSTALLED` (each with its details shape), `VERSION_NOT_ON_CHANNEL`, `DRAFT_VALIDATION_FAILED` (422). The web API explorer page renders it as a table if it renders `API_ENDPOINTS`; otherwise the export is the reference (checked during implementation). ADR 0005 gains `### 7. Operator model` between §6 (`:175`) and "Rejected alternatives" (`:176`), and the Consequences "New error codes" bullet (`:212-214`) names `ALREADY_INSTALLED`. `docs/OPERATIONS.md` `### Release channels` (`:403-460`) is rewritten as `### Trying pre-release versions of apps` (enable, join, leave and what it means, separate copy, CLI), removing the quoted Instance string (`:429-431`) and the "Configuration → Channel" pointer (`:459`). `CLAUDE.md:98-105` gains one sentence.

## R12. Follow-up issues (filed during implementation, numbers recorded in tasks.md)

- Apps launcher tiles: pre-release pill for copies following a non-stable channel.
- Notification when a followed channel publishes a new version.
- Consolidate the remaining hand-rolled dialogs (`DeploymentDetail` remove, `Deployments` remove) onto `ConfirmDialog`.
- `SystemSettings` duplicated in `database-config.ts`/`repositories.ts` with an unreachable DB-backed config service (pre-existing; out of scope).

## Test strategy

| Layer | File | Covers |
|---|---|---|
| server | `__tests__/config/system-settings.test.ts` (new) | default off, round-trip, deep-merge of `channels`, non-boolean → `ValidationError`, Mock mirrors default |
| server | `__tests__/deployments/update-info.test.ts` | `versionChannel` set when listed / absent when not / absent on catalog error, on list, detail and update-check |
| server | `__tests__/deployments/persistence.test.ts` | `multiInstance` persisted + projected; `ALREADY_INSTALLED` details (both branches), `existing` selection with two copies, message free of flag names |
| server | `__tests__/deployments/channels.test.ts` | `prerelease=true` list filter (followed non-stable, running non-stable, neither) before pagination |
| server | `__tests__/api/…` or route test | GET/PATCH `/api/settings` projects `channels`; PATCH non-boolean → 400 |
| web | `Settings.prerelease.test.tsx` (new) | toggle reflects/patches, count line, explainer |
| web | `Catalog.test.tsx` | no per-channel link / "available" text; pill only enrolled; `+ Another` only multi-instance; no-stable routing kept |
| web | `InstallWizard.channels.test.tsx` | radio gated on enrolment / `?channel=`; note on implied channel; `ALREADY_INSTALLED` panel: three actions, Switch PATCH + navigate, separate copy absent when unpublished, override wording when same channel |
| web | `DeploymentDetail.test.tsx` | Channel block; Join → PATCH + confirm copy; Leave honest state; running line; sibling sentence; header button suffix; no Configuration card |
| web | `Deployments.test.tsx` | pill from `versionChannel` vs followed; Pre-release chip sends `prerelease=true` |
| cli | `channel.test.ts`, `settings-prerelease.test.ts`, `install.test.ts` | show/set/leaving note; on/off/show; `ALREADY_INSTALLED` hint from details |
| sdk | `sdk` test (if a suite exists; else covered by CLI tests) | `HolaApiError` fields from a JSON error body |

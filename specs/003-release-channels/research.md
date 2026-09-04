# Research: Release Channels

**Feature**: `003-release-channels` · **Date**: 2026-09-03 · **Source**: issue #428

All anchors verified against `main` at `c77b160` on 2026-09-03.

## R1. Where a version's channel lives

**Decision**: `channel?: string` on the catalog.json `versions[]` entry only. It is an
index-level attribute (like `refs.oci`, `digest`), not a manifest attribute.

**Rationale**: The issue frames the channel as "what the store offers", and every other
version-entry field the server reads from `catalog.json` is listing metadata
(`catalog.ts:134-160`). Bundle `manifest.json` describes one version's contents and
already has a coercer per block; a channel is a statement about the *listing*, and a
bundle can be re-listed on another channel (rc → stable) without republishing.

**Alternatives considered**:
- Manifest field: rejected — would require republishing a bundle to graduate it, and the
  constitution's "metadata from the manifest" rule is about *app* metadata, which this is not.
- Deriving the channel from a pre-release suffix in the version string: rejected — the
  catalog must be able to list `1.3.0-beta.2` on `beta` and `2.0.0` on `rc` explicitly;
  inference makes the publishing side implicit and unreviewable.

## R2. Channel name validation and the malformed case

**Decision**: `^[a-z][a-z0-9-]{0,31}$`. Absent → `stable`. Any other value (wrong type,
uppercase, empty, too long) → the entry is dropped from every channel and one `warn` log
line names `{ source, appId, version, channel }`.

**Rationale**: Spec FR-002. The rule matches the house style of narrow coercers
(`coerceManifestEnvVar` `catalog.ts:52-133`, `manifest-upgrade.ts:25-48`) that return
`undefined` for junk instead of throwing, so one bad entry cannot take an app or a source
down. Dropping (not defaulting) prevents a typo from publishing a pre-release as stable.

**Alternatives**: closed enum (`stable|rc|beta`) — rejected, spec assumption says the
catalog decides which channels exist.

## R3. Replacing `pickLatestVersion`

**Decision**: Delete the numeric-only parser at `catalog.ts:155-176` and resolve "newest"
everywhere with the shared `compareVersions` (`shared/src/index.ts:143-172`), through a new
shared helper `newestEligibleVersion(entries, channel)`.

**Rationale**: `pickLatestVersion`'s `/^\d+(\.\d+)*$/` guard rejects `1.3.0-rc.1`, so a single
rc entry flips the *whole app* to "last array element wins" — including the browse-grid
version. `compareVersions` already ranks `1.2.0 > 1.2.0-rc.1`, never throws, and is what
`enrichUpdateInfo` (`deployment.ts:2237-2240`) already uses, so the two "newest"
implementations that disagree today collapse into one.

**Behaviour change accepted**: an app whose version strings are non-numeric (e.g. `main`)
was previously resolved by list position; it is now resolved by `compareVersions`' string
fallback. No catalog app does this today; the change is noted in the ADR.

## R4. Where channel selection enters the install flow

**Decision**: On the **draft**: `CreateDraftRequest.channel?`. The draft resolves
`latest` on that channel, persists the resolved `channel` (explicit ?? the pinned
version's channel ?? `stable`), and `FinalizedManifest.channel` carries it to
`createFromDraft`, which copies it onto the deployment. `CreateDeploymentFromDraftRequest`
gains **no** channel field.

**Rationale**: The version is resolved at draft creation (`draft.ts:952`
`getVersionDetail(appId, version || 'latest', source)`), so the channel has to be known
there for `latest` to mean "newest eligible". Carrying it in the finalized manifest follows
the `multiInstance`/`source`/`upgrade` precedent (`draft.ts:55-111`): one resolution, one
source of truth, no second path where the deployment channel could disagree with the
version actually installed.

**Consequence for the web wizard**: it creates the draft on mount (`InstallWizard.tsx:293`)
before any UI choice. So the wizard reads `?channel=` from the URL for the draft it
creates, and an in-wizard channel change **recreates the draft** (delete + create), which
is correct anyway: a different channel means a different version, hence different
defaults/env.

**Alternatives**: channel on `createFromDraft` — rejected (two places to resolve; the
draft would already have pinned the wrong version).

## R5. Eligibility rule and "latest" on a channel

**Decision**: `eligible(versionChannel, deploymentChannel) = versionChannel === deploymentChannel || versionChannel === 'stable'`.
`latest` on channel C = newest eligible by `compareVersions`.

**Rationale**: Spec FR-003 / clarification. This is the Snap "risk level falls back to
stable" behaviour without introducing a channel ordering. An rc deployment is offered the
graduated stable release; a stable deployment never sees a pre-release.

## R6. Mismatch errors and where they are raised

**Decision**:
- `NO_VERSION_ON_CHANNEL` — `BundleUnavailableError` (same class as `VERSION_NOT_FOUND`,
  `catalog.ts:443`), raised in `getVersionDetail` when `latest` finds nothing eligible.
  Message lists the channels that do have versions.
- `VERSION_NOT_ON_CHANNEL` — `ValidationError` (400), raised in `getVersionDetail` when a
  pinned version exists but is not eligible on the requested channel. Message names the
  version, the requested channel and the version's channel.
- `INVALID_CHANNEL` — `ValidationError` (400) for a malformed channel in any request
  (draft create, deployment PATCH).
- Upgrade: `RealDeploymentService.resolveUpgradeTarget(id, requested?)` returns the target
  (default: the channel-filtered `latestVersion`) or throws `VERSION_NOT_ON_CHANNEL` with
  the extra hint "change the deployment's channel first (PATCH `channel` / dashboard)".
  The promote route (`server.ts:1200`) calls it instead of `body.version ?? detail.latestVersion`
  and passes `channel` into `createDraft` as a second line of defence.

**Rationale**: `getVersionDetail` is the one place that has the version list *and* the
requested version, and every install path (CLI, wizard, promote, install-by-ref excluded)
funnels through it via `getDraftDefaults`. Raising there gives FR-009 for free on every
client. The upgrade hint needs deployment context, hence the service method.

## R7. Instance guard per app-and-channel with a recorded reason

**Decision**: `assertInstanceAllowed(appId, multiInstance, allowMultiple, channel)` returns
`InstanceReason | undefined`:

```
multiInstance            → undefined (no guard)
no existing copy         → undefined
no copy on this channel  → 'channel'
allowMultiple            → 'operator-override'
else                     → ConflictError (message now also names --channel)
```

Persisted as `EnhancedDeploymentDetail.instanceReason?` and exposed on `DeploymentDetail`.

**Rationale**: Spec FR-015/016 and clarification Q1 (channel precedence). Keeping the
decision inside the existing guard (`deployment.ts:2751-2760`) keeps the base-class no-op
(`deployment.ts:538-548`) permissive for the mock, and the return value is the only new
surface. The channel comparison reads `d.channel ?? 'stable'` so pre-feature records count
as stable copies.

## R8. Deployment record shape and persistence

**Decision**: `channel: string` (always written for new records) and
`instanceReason?: 'channel' | 'operator-override'` on `EnhancedDeploymentDetail`, top-level
beside `subdomain`/`selectedProfiles`, not in `metadata`. Read path: `channel ?? 'stable'`.
No migration.

**Rationale**: Persistence is `deployments/<id>/metadata.json` with optional-at-read
fields (`deployment.ts:2944-2956`, rehydration `2685-2740`, `subdomain` precedent). Both
fields are install-time facts about *this* install, the same class as `subdomain` and
`grantedContracts`, which are top-level; `metadata` holds provenance/auth artifacts.

## R9. Update offering and wire fields

**Decision**: `enrichUpdateInfo` keys its cache by `${source}::${app}::${channel}`, filters
`getVersions` items by eligibility, and sets `latestVersion` + `latestVersionChannel`. The
list item and detail gain `channel` (always) and `latestVersionChannel?`. The update-check
response gains the same two. `buildUpdateCheck` is unchanged apart from passing through.

**Rationale**: Spec FR-011 and clarification Q4. `enrichUpdateInfo` (`deployment.ts:2212-2248`)
is the single place the cheap signal is computed, and it already consumes `getVersions`,
which now carries `channel` per entry — so no new endpoint. The web upgrade dialog and CLI
can render `1.3.0-rc.2 (rc)` from the row.

## R10. Changing a deployment's channel

**Decision**: `PatchDeploymentRequest.channel?` handled in both `updateDeployment`
implementations (base `deployment.ts:1032`, real `1763`): validate name → set → persist →
`{ ok: true, warnings? }`. No job, no manifest rewrite. The real override's early "nothing to
do" branch must treat a channel change as work (it currently only checks env/overrides).
A warning is returned when the new channel makes two single-instance copies share a channel.

**Rationale**: Spec FR-013 / US4. The PATCH route (`server.ts:1130-1140`) passes the body
straight through, so only the type and service change. The `warnings` field is additive.

## R11. Catalog list: channels per app

**Decision**: `CatalogApp.channels: string[]` (sorted, `stable` first when present, then
alphabetical), computed in `mapApp` from well-formed entries. `CatalogApp.version` stays
"newest **stable**"; absent when the app has no stable version.

**Rationale**: FR-006 and clarification Q3. The catalog page and the wizard need "does this
app have anything beyond stable" without N drill-down calls; `channels` answers it and
also tells the Catalog card whether to show "install on `<channel>`" (it has the
deployments list and, after this feature, each deployment's channel).

## R12. CLI surface

**Decision**:
- `hola install`: `--channel <name>`, `--as <name>` (alias of `--name`; if both given,
  `--name` wins and a note is printed). Channel is sent on `drafts.create`. On success print
  `Following channel: <c>` when `c !== 'stable'`, or when the channel was implied by a pinned
  version.
- `hola deployments`: append ` [<channel>]` after the name for non-stable rows.
- `hola catalog`: append `  (channels: rc)` for apps with non-stable channels.
- `hola upgrade`: no new flag. The server's default target is already channel-filtered;
  `VERSION_NOT_ON_CHANNEL` surfaces through the existing `reportDeployError`.
- No CLI command lists an app's versions today, so FR-021's second clause has no
  in-scope surface (noted in the spec's plan, not built).

**Rationale**: Sade reserves `--version` (`cli/src/index.ts:145-147`), so `--channel` is
the only new flag. `--as` is what the issue proposes; making it an alias avoids two name
semantics.

## R13. Web surface

**Decision** (smallest set satisfying FR-022..025):
- `Catalog.tsx`: channel hint on the card when `channels` has a non-stable entry; for an
  installed single-instance app, an "Install on `<channel>`" link →
  `installTo?channel=<c>` for each non-stable channel no copy follows (uses
  `DeploymentListItem.channel`).
- `InstallWizard.tsx`: reads `?channel=`; passes `channel` to `createDraft`; renders a
  channel `<select>` (only when the app has >1 channel with versions) that recreates the
  draft on change; shows "Following channel" in the summary.
- `Deployments.tsx`: channel pill next to the version for non-stable rows; the update
  pill shows `latestVersion` and appends the target's channel when non-stable.
- `DeploymentDetail.tsx`: facts `Channel` and (when set) `Instance` (`rc copy of remo` /
  `operator override`); upgrade dialog shows the target's channel; a channel select in the
  configuration area calling `api.deployments.update({ channel })`, invalidating the
  deployment queries.

**Rationale**: All anchors exist (`Catalog.tsx:325-350`, `InstallWizard.tsx:254-261, 293,
1565-1592`, `Deployments.tsx:379-387`, `DeploymentDetail.tsx:418-435`,
`useDeploymentDetailApi.ts:35-43`). The wizard already owns draft lifecycle, so recreating
on channel change is local.

## R14. Documentation set

**Decision**: `docs/adr/0005-release-channels.md` (format of ADR 0004: Status/Context
bullets, `## Context`, `## Decision` with numbered `###`, `### Rejected alternatives`,
`## Consequences`), a "Release channels" subsection under `docs/OPERATIONS.md` `## Upgrade`
(line 314), the `hola install` paragraph in `packages/cli/README.md:49`, a bullet in
`CLAUDE.md` "Architecture notes that matter", and the `api-explorer.ts` schema strings for
`GetCatalogAppResponse`, `GetCatalogAppVersionsResponse`, `CreateDraftRequest`.

## R15. Follow-up issue

**Decision**: The implementer files one GitHub issue, "Clone-with-data rehearsal:
`hola install <app> --channel rc --from <deployment>`", carrying the five design
considerations from #428 verbatim and linking this spec. Its number is recorded in
`tasks.md`.

## Test strategy (from the templates)

| Area | Template | New/extended file |
|---|---|---|
| catalog.json `channel` parsing, `channels[]`, newest-stable, malformed drop | `__tests__/bundles/catalog-remote.test.ts` (data: URL) | same file + `catalog/catalog-channels.test.ts` |
| shared helpers (`isValidChannelName`, `isEligibleOnChannel`, `newestEligibleVersion`) | `__tests__/shared/upgrade-path.test.ts` | `__tests__/shared/channels.test.ts` |
| draft channel resolution, `NO_VERSION_ON_CHANNEL`, `VERSION_NOT_ON_CHANNEL` | `__tests__/deployments/update-info.test.ts` `makeCatalog` | `deployments/channels.test.ts` |
| guard per app+channel, instance reason, persisted `channel` survives restart | `__tests__/deployments/persistence.test.ts:304-388` | same file |
| update offering filtered by channel, `latestVersionChannel`, sticky channel | `update-info.test.ts` | same file |
| PATCH channel, warnings, invalid name | `persistence.test.ts` | `deployments/channels.test.ts` |
| promote target resolution / cross-channel rejection | `__tests__/deployments/promote-endpoint.test.ts` | same file |
| CLI `--channel`/`--as`, output lines | `packages/cli/src/__tests__/install.test.ts:206-236` | same file |
| Web: catalog card link, wizard select + draft recreate, list badge, detail facts + select | `__tests__/pages/*.test.tsx` | existing page test files |

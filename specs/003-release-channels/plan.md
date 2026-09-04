# Implementation Plan: Release Channels

**Branch**: `003-release-channels` | **Date**: 2026-09-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-release-channels/spec.md` (GitHub issue #428)

## Summary

Let the catalog list more than one version of an app, each tagged with a **channel**
(`stable` by default, e.g. `rc`), and let every deployment record the channel it follows.
The channel decides which versions a deployment is offered on upgrade (its own channel plus
`stable`), the single-instance guard becomes per app **and** channel so `remo-beta` on `rc`
can sit beside `remo` on `stable` without the blunt allow-multiple override, and the reason
a second copy exists is persisted and shown. The stale numeric-only "newest version" picker
is replaced by the shared pre-release-aware comparator so a single `-rc` entry can no
longer flip an app's default. Channel enters the flow at **draft creation** and rides the
finalized manifest onto the deployment; the CLI gains `--channel`/`--as`, the dashboard gains
a channel choice in the wizard, badges on the list/detail, and a channel edit. ADR 0005
records the model. Catalog-repo publishing prerequisites and the `--from` clone flow are
out of scope (the latter is filed as a follow-up issue by this feature).

## Technical Context

**Language/Version**: TypeScript (Bun workspaces); server on Bun, web on Vite/React 19,
CLI on `sade`.

**Primary Dependencies**: `@hola/shared` (`compareVersions`, wire types), `@hola/sdk`
(pass-through client), no new packages.

**Storage**: Deployment records are JSON files at `deployments/<id>/metadata.json`
(`RealStorageService`); drafts/finalized manifests are JSON under the draft dir. New fields
are optional-at-read; **no migration** (precedent: `subdomain`, #246).

**Testing**: server `bun:test` under `packages/server/src/__tests__/<area>/`, CLI and web
`vitest` under `packages/{cli,web}/src/__tests__/`. Catalog data is always a test-injected
stub (duck-typed catalog or a `data:` URL catalog.json).

**Target Platform**: Linux server (Docker host) + browser SPA + CLI binary.

**Project Type**: Monorepo web service + SPA + CLI; this feature touches `shared`, `server`,
`cli`, `web`, `sdk` (types only), `docs`.

**Performance Goals**: No new network calls on hot paths. `enrichUpdateInfo` keeps one
`getVersions` call per `(source, app, channel)` per list request. Catalog list adds an
O(versions) pass per app.

**Constraints**:
- Channel is a catalog-**index** attribute; `manifest.json` is untouched (spec Scope).
- `stable`-only catalogs and pre-feature deployment records must behave identically
  (spec SC-004).
- `version` on the browse grid = newest **stable**; `latest` on channel C = newest eligible.
- Guard/reason logic stays inside the existing `assertInstanceAllowed` seam so the mock base
  class remains permissive (Constitution IV).
- No per-deploy work moves to create time (Constitution III) — a channel change is a
  metadata write, never a job.

**Scale/Scope**: ~10 server files, ~6 shared type sites, 3 CLI files, 5 web files, 1 ADR,
3 docs; ~12 new/extended test files. See "Project Structure".

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Traefik-only ingress | ✅ n/a | No routing/compose change. Second copies still go through `onBeforeCreate` subdomain validation. |
| II. Remote catalog as single source of truth | ✅ | Channel comes from the remote `catalog.json` `versions[]` entry. No bundled catalog, no fake fallback. Per-app metadata still comes from the bundle manifest; a channel is listing metadata, not app metadata (R1). `MockCatalogService` stays empty. |
| III. Async deploy lifecycle | ✅ | `createFromDraft` only records `channel`/`instanceReason` and enqueues as today. Channel PATCH is a metadata write with no job. |
| IV. Real/Mock service pairs | ✅ | No new service. New logic lives in `RealCatalogService`, `RealDeploymentService` overrides and the shared helper module; base-class no-ops keep the mock permissive. |
| V. Generic cross-app primitives | ✅ n/a | Not a cross-app capability; no `consumes`/`provides` change. ADR 0005 is written because the issue asks for one, not because V requires it. |
| VI. Auth platform-agnostic, default-on | ✅ n/a | Provisioning path unchanged; a channel copy provisions its own auth like any second instance. |
| VII. Quality gates | ✅ | `bun run typecheck && bun run lint && bun run test && bun run build`; re-run typecheck after lint fixes. |

**Post-design re-check (Phase 1)**: unchanged — no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-release-channels/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R15 + test strategy
├── data-model.md        # Phase 1: entities, fields, validation, transitions
├── quickstart.md        # Phase 1: end-to-end validation scenarios
├── contracts/
│   ├── api.md           # HTTP wire changes (catalog, drafts, deployments)
│   ├── cli.md           # `hola install/deployments/catalog/upgrade` changes
│   └── web.md           # Dashboard surfaces and behaviours
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared/src/
└── index.ts                     # + STABLE_CHANNEL, isValidChannelName, isEligibleOnChannel,
                                 #   newestEligibleVersion; + channel fields on CatalogApp,
                                 #   CatalogAppVersion, GetCatalogAppVersionDetailResponse,
                                 #   CreateDraftRequest, Draft, DeploymentListItem,
                                 #   DeploymentDetail, GetDeploymentUpdateCheckResponse,
                                 #   PatchDeploymentRequest/Response, EnhancedDeploymentDetail
packages/shared/src/docs/
└── api-explorer.ts              # schema strings for the changed responses/requests

packages/server/src/services/core/
├── catalog.ts                   # channel on RemoteCatalog/CatalogVersionEntry; coerceChannel;
│                                #   remove pickLatestVersion; mapApp channels/version;
│                                #   getVersions channel; getVersionDetail(…, channel)
├── draft.ts                     # CreateDraftRequest.channel → Draft.channel → FinalizedManifest.channel
├── deployment.ts                # channel/instanceReason on create; assertInstanceAllowed(+channel)
│                                #   returns reason; enrichUpdateInfo channel filter +
│                                #   latestVersionChannel; resolveUpgradeTarget; updateDeployment channel
└── (no new service)
packages/server/src/server.ts    # promote handler uses resolveUpgradeTarget + passes channel

packages/server/src/__tests__/
├── shared/channels.test.ts                  # NEW: helper semantics
├── catalog/catalog-channels.test.ts         # NEW: parsing, channels[], newest-stable, malformed
├── bundles/catalog-remote.test.ts           # extend: channel passthrough on getVersions
├── deployments/channels.test.ts             # NEW: draft resolution, errors, PATCH channel
├── deployments/persistence.test.ts          # extend: guard per app+channel, instanceReason, restart
├── deployments/update-info.test.ts          # extend: channel-filtered offers, sticky channel
└── deployments/promote-endpoint.test.ts     # extend: cross-channel rejection, default target

packages/sdk/src/index.ts        # types only (CreateDraftRequest/PatchDeploymentRequest pass-through)

packages/cli/src/
├── index.ts                     # install: --channel, --as
├── commands/install/install.ts  # channel → drafts.create; "Following channel" output
├── commands/deployments/deployments.ts   # [channel] suffix
├── commands/catalog/catalog.ts  # (channels: …) suffix
└── __tests__/install.test.ts, deployments.test.ts, catalog.test.ts

packages/web/src/
├── pages/Catalog.tsx            # channel hint; "Install on <channel>" link
├── pages/InstallWizard.tsx      # ?channel, channel select → recreate draft, summary line
├── pages/Deployments.tsx        # channel pill; update pill channel
├── pages/DeploymentDetail.tsx   # Channel/Instance facts; upgrade dialog channel; channel select
├── hooks/useCreateDraft*.ts / useDraftFinalization.ts  # pass channel (whichever hook creates the draft)
└── __tests__/pages/{Catalog,InstallWizard.*,Deployments,DeploymentDetail}.test.tsx

docs/adr/0005-release-channels.md            # NEW
docs/OPERATIONS.md                           # "Release channels" under ## Upgrade
packages/cli/README.md                       # install paragraph
CLAUDE.md                                    # architecture-notes bullet
```

**Structure Decision**: No new modules or services. Every change lands on an existing seam
identified in `research.md`; the only new files are tests and the ADR.

## Design overview

1. **Shared helpers** (`@hola/shared`): `STABLE_CHANNEL = 'stable'`,
   `isValidChannelName(s)`, `isEligibleOnChannel(versionChannel, channel)`,
   `newestEligibleVersion<T extends {version; channel?}>(entries, channel)` using
   `compareVersions`. Used by server (catalog + deployment), and available to CLI/web.
2. **Catalog** (`RealCatalogService`): parse `channel` via `coerceChannel` (absent → `stable`,
   malformed → drop + warn). `mapApp` sets `version` = newest stable, `channels` = sorted
   set. `getVersions` returns `channel` per item (dropped entries excluded). `getApp.versions`
   likewise excludes dropped entries. `getVersionDetail(appId, version, source, channel = 'stable')`:
   `latest` → newest eligible or `NO_VERSION_ON_CHANNEL`; pinned → must be eligible or
   `VERSION_NOT_ON_CHANNEL`; response carries the resolved version's `channel`.
3. **Draft**: `createDraft({ …, channel })` validates the name (`INVALID_CHANNEL`), passes it
   to `getDraftDefaults` → `getVersionDetail`, persists `Draft.channel` = explicit ?? detail
   channel ?? `stable`, and `FinalizedManifest.channel` carries it.
4. **Deployment create**: `channel = manifest.channel ?? 'stable'`;
   `instanceReason = assertInstanceAllowed(app, multiInstance, allowMultiple, channel)`;
   both persisted. The response (`CreateDeploymentFromDraftResponse`) gains `channel` so the
   CLI can print "Following channel".
5. **Offers**: `enrichUpdateInfo` filters by eligibility per deployment channel and sets
   `latestVersionChannel`; list/detail/update-check carry `channel` + `latestVersionChannel`.
6. **Upgrade**: `resolveUpgradeTarget(id, requested?)` (service) → promote route.
7. **Channel change**: `PATCH /api/deployments/:id { channel }` → validate, set, persist,
   `warnings?`.
8. **Clients**: CLI flags/output; web wizard/select/badges/edit per `contracts/web.md`.
9. **Docs**: ADR 0005, OPERATIONS, CLI README, CLAUDE.md, api-explorer strings.
10. **Follow-up**: file the `--from` clone issue; record the number in tasks.md.

## Risks and mitigations

- **`pickLatestVersion` removal changes non-semver ordering** — accepted (R3); covered by a
  test asserting `compareVersions` ordering with a pre-release entry present.
- **Wizard draft recreation on channel change** — the wizard already deletes abandoned
  drafts on unmount; reuse that path and guard against the double-create race with the
  existing `creatingDraftRef`.
- **Stub catalogs in existing tests** are duck-typed; adding an optional 4th parameter to
  `getVersionDetail` and an optional `channel` on `getVersions` items is backward
  compatible. Any stub that must assert channel behaviour is extended explicitly.
- **SSE `deployment_update` payloads**: ensure the list-item mapper includes `channel` so
  the web badge updates live; covered by a list mapping test.

## Complexity Tracking

No constitution violations; nothing to justify.

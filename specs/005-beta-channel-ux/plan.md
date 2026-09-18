# Implementation Plan: Beta Channel Support for Catalog Apps (Operator Model)

**Branch**: `005-beta-channel-ux` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-beta-channel-ux/spec.md` (prompt of record: local plan file "Beta channel support for catalog apps: mental model + change plan"; Notion Spec Prompts row, Sequence 2)

## Summary

Build the operator model on top of ADR 0005's channel mechanism in three layers. **Enrolment**: a
host-level `channels.showPrerelease` system setting (default off) read by every dashboard page
through one fail-closed hook; it gates discovery only. **Track**: the deployment Overview gains a
Channel block that shows the followed channel and the running build's channel (a new derived
`versionChannel` from the version list `enrichUpdateInfo` already fetches) with Join/Leave actions
behind a shared `ConfirmDialog`, replacing the Details facts and the Configuration-tab card.
**Side-by-side**: a secondary "Try <c> in a separate copy" link. The catalog card loses its
per-channel install links and offers "+ Another" only for multi-instance apps (a new persisted
`multiInstance` flag); the wizard's channel select becomes a gated radio group and its 409 panel
renders a structured `ALREADY_INSTALLED` conflict (details on the existing `ConflictError`, messages
surface-neutral). The SDK gains a typed `HolaApiError` and a `settings` namespace; the CLI gains
`hola channel` and `hola settings prerelease` and renders the conflict hint from details. The
deployments list gets a shared `ChannelPill` and a server-side `prerelease` filter applied before
pagination. ADR 0005 §7, OPERATIONS.md and CLAUDE.md record the model.

## Technical Context

**Language/Version**: TypeScript (Bun workspaces); server on Bun, web on Vite/React 19 (TanStack
Query + a module `globalCache`), CLI on `sade`, SDK fetch-based.

**Primary Dependencies**: `@hola/shared` (`STABLE_CHANNEL`, `isEligibleOnChannel`,
`newestEligibleVersion`, wire types), existing `RadioGroup`, `TransientNotice`, `StatusBadge`
styling. No new packages.

**Storage**: one new optional field on the deployment record (`multiInstance`) written at create;
one new optional group in the system-settings document (`channels`). No migration; absent values have
defined meanings (single-instance; not enrolled).

**Testing**: server `bun:test` under `packages/server/src/__tests__/`; web and CLI `vitest`.
Server tests use the Real services over temp storage with duck-typed catalog stubs
(`update-info.test.ts` / `persistence.test.ts` / `channels.test.ts` helpers). Web tests stub
`global.fetch` (Catalog) or `utils/api-hybrid` (wizard, detail, list); a `/api/settings` stub is
added where enrolment matters.

**Target Platform**: Linux Docker host (server), browser SPA, CLI binary.

**Project Type**: Monorepo web service + SPA + CLI + SDK; touches `shared`, `server`, `web`, `sdk`,
`cli`, `docs`.

**Performance Goals**: `enrichUpdateInfo` keeps one catalog-cache read per `source::app` per list
call (unchanged count, larger memo value). The `prerelease` list filter enriches all host
deployments before pagination — bounded by host scale (tens), catalog cache only. Settings read on
four pages shares one 30 s cache entry.

**Constraints**:
- Guard decision table and recorded reasons unchanged (ADR 0005 §4); channel names stay open
  strings; `stable` is the floor.
- No per-app logic; no catalog call at create time (Constitution III) — `multiInstance` comes from
  the finalized manifest already in hand.
- Mock services stay permissive but mirror new fields (Constitution IV).
- Conflict messages contain none of `--allow-multiple`, `--channel`, "install another" (SC-003).
- Enrolment fails closed on the web (pending/error → not enrolled).

**Scale/Scope**: shared ~3 files (+ error-code table), server ~6 source files, sdk 1, cli ~4
(+2 new commands), web ~7 pages/hooks + 3 new components/hooks, docs 3 + CLAUDE.md, ~12 test files
(3 new). See "Project Structure".

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Traefik-only ingress | ✅ n/a | No compose, routing or port changes. |
| II. Remote catalog as single source of truth | ✅ | `versionChannel` and the published-channel set come from the catalog version list via existing service calls; `MockCatalogService` stays empty; tests inject stubs. |
| III. Async deploy lifecycle | ✅ | Create path only persists a value it already read; Join/Leave are the existing metadata PATCH (no job). No new create-time catalog call. |
| IV. Real/Mock service pairs | ✅ | No new service. `MockConfigService` mirrors the new settings field/default/merge and stays permissive on validation; the deployment Mock base stays permissive (`assertInstanceAllowed` no-op). |
| V. Generic cross-app primitives | ✅ n/a | No cross-app primitive; contracts untouched. |
| VI. Auth platform-agnostic, default-on | ✅ n/a | Provisioner untouched; settings routes keep their existing auth. |
| VII. Quality gates | ✅ | `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build`. |

**Post-design re-check (Phase 1)**: unchanged. One pre-existing defect is corrected in passing
(settings validation threw a plain `Error` → 500; now `ValidationError` → 400), documented in R1;
no constitution deviation.

## Project Structure

### Documentation (this feature)

```text
specs/005-beta-channel-ux/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R12 + test strategy
├── data-model.md        # Phase 1: settings group, record fields, derived fields, conflict, filter
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── api.md           # HTTP wire changes + error-code reference
│   ├── web.md           # Dashboard surfaces and copy
│   └── cli.md           # SDK error/settings, hola channel, hola settings prerelease, install hint
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared/src/
├── index.ts                     # GetSettingsResponse.channels; DeploymentListItem/DeploymentDetail/
│                                #   GetDeploymentUpdateCheckResponse.versionChannel, .multiInstance;
│                                #   EnhancedDeploymentDetail.multiInstance; GetDeploymentsRequest.prerelease
└── docs/api-explorer.ts         # + API_ERROR_CODES (new export); settings/list endpoint docs

packages/server/src/
├── services/core/config.ts      # SystemSettings.channels; defaults (Real+Mock); merge clause; boolean
│                                #   validation; ValidationError on failure
├── services/core/database-config.ts, repositories.ts   # type/default parity only
├── services/core/deployment.ts  # enrichUpdateInfo memo → full entries, versionChannel; multiInstance
│                                #   persisted + projected; assertInstanceAllowed → ALREADY_INSTALLED
│                                #   details, neutral messages, oldest-copy rule; prerelease list filter
├── server.ts                    # settings projections (+fallback) carry channels; GET /api/deployments
│                                #   reads ?prerelease
└── __tests__/
    ├── config/system-settings.test.ts        (new)
    ├── deployments/update-info.test.ts       (+ versionChannel)
    ├── deployments/persistence.test.ts       (+ multiInstance, ALREADY_INSTALLED; rewrite --channel assert)
    └── deployments/channels.test.ts          (+ prerelease filter)

packages/sdk/src/index.ts        # HolaApiError; parseJson parses {error}; settings namespace

packages/cli/src/
├── index.ts                     # register `channel <deploymentId> [channel]`, `settings prerelease [value]`
├── commands/deployments/channel.ts      (new)
├── commands/settings/prerelease.ts      (new)
├── lib/deploy-flow.ts           # reportDeployError: ALREADY_INSTALLED hint from details
└── __tests__/channel.test.ts, settings-prerelease.test.ts (new), install.test.ts (+ typed conflict)

packages/web/src/
├── hooks/usePrereleaseEnrolment.ts      (new)
├── components/ui/ChannelPill.tsx        (new, + pillFor)
├── components/ui/ConfirmDialog.tsx      (new; upgrade dialog migrated)
├── pages/Settings.tsx           # + exported PrereleaseCard
├── pages/Catalog.tsx            # card rework
├── pages/InstallWizard.tsx      # radio group, note, allowMultiple state, ALREADY_INSTALLED panel
├── pages/DeploymentDetail.tsx   # Channel block, Join/Leave, siblings, header suffix; facts/card removed
├── pages/Deployments.tsx        # ChannelPill, Pre-release chip → prerelease=true
└── __tests__/pages/Settings.prerelease.test.tsx (new), Catalog.test.tsx, InstallWizard.channels.test.tsx,
    DeploymentDetail.test.tsx, Deployments.test.tsx

docs/adr/0005-release-channels.md   # § 7 Operator model; Consequences error-code bullet
docs/OPERATIONS.md                  # "Trying pre-release versions of apps" (rewrites "Release channels")
CLAUDE.md                           # release-channels bullet + speckit pointer
```

**Structure Decision**: existing monorepo layout; no new packages or directories beyond
`packages/cli/src/commands/settings/`.

## Design overview

1. **Settings** (R1): type + defaults + merge + validation + route projections; `ValidationError`
   on failure. Test against `RealConfigService`.
2. **Enrolment on the web** (R2): `usePrereleaseEnrolment()` over `useSettingsApi`; `PrereleaseCard`
   on Settings with the count line from the deployments list.
3. **Derived facts** (R3, R4): `versionChannel` from the retained version list; `multiInstance`
   persisted and projected.
4. **Conflict** (R5, R6): `ALREADY_INSTALLED` details on `ConflictError`; SDK `HolaApiError`;
   CLI hint from details; rewrite the persistence test assertion.
5. **List filter** (R7): `prerelease` query, enrich-before-paginate branch; chip on the list.
6. **Shared UI** (R8): `ChannelPill` + `pillFor`; `ConfirmDialog` extracted and reused; Channel block
   on the detail page; header/confirm channel suffix.
7. **Catalog + wizard** (R9): card rework; radio group; note; `allowMultiple` state; conflict panel.
8. **CLI** (R10): `hola channel`, `hola settings prerelease`, SDK `settings` namespace.
9. **Docs + follow-ups** (R11, R12): error-code table, ADR §7, OPERATIONS rewrite, CLAUDE.md
   sentence; issues filed with numbers recorded in tasks.md.

## Risks and mitigations

- **Existing page tests render as "not enrolled"** once gating lands, breaking the `#428` assertions
  that expect channel chrome — every affected suite gains a settings stub (fetch route or
  `api-hybrid` mock) and the enrolled/not-enrolled cases are asserted explicitly.
- **Settings validation 500 → 400 change** affects any caller relying on the old status; none exists
  in this repo (the route comment already promised 400).
- **`enrichUpdateInfo` memo shape change** could regress `latestVersion` — the existing
  `update-info.test.ts` cases pin the newest-eligible behaviour; new cases pin `versionChannel`.
- **Pre-pagination enrichment** on very large hosts — bounded by catalog-cache reads keyed per app;
  only active when the chip is on.
- **`HolaApiError` changes `message`** for JSON error bodies (server message instead of
  `HTTP 409 …: {json}`) — CLI tests that regex on message text are checked; the legacy form is kept
  for non-JSON bodies.
- **Wizard `allowMultiple` moves from URL to state** — the URL seed is preserved so the catalog's
  `?another=1` link keeps working.

## Complexity Tracking

No constitution violations; nothing to justify.

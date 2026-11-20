# Implementation Plan: Opt-in Private Tailscale Ingress for Any App

**Branch**: `010-tailscale-ingress` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-tailscale-ingress/spec.md` (39 FRs, 9 SCs, 5 clarifications, 5 planning amendments)

## Summary

An operator can give one installed app its own private address on their Tailscale network. Hola adds a small platform-owned container (the "companion", service `hola-tailscale`) to that deployment. The companion joins the tailnet as a tagged device, serves one named Tailscale Service, and forwards to exactly one backend of that app over a private network that contains nothing else. The app's normal Traefik route is untouched. Deployments that have not opted in render as before.

Three facts from the code and the Tailscale sweep fix the shape (evidence in [research.md](./research.md)):

1. **The companion must be injected last.** Every post-validation helper in `materializeCompose` fans out to all services except one hard-coded name. Injected after them, the companion gets no contract token, no Docker proxy address, no staging mount and no `hola` membership, without a skip list to maintain (R6).
2. **Hola drives `tailscaled` by exec; it does not use the image's entrypoint.** That is what lets the credential stay out of the container's environment and be deleted once the device has joined, and it sidesteps undocumented declarative behaviour (R1, R3).
3. **Changes ride the existing restart job, with a before-up and an after-up hook.** Compose never removes a service dropped from the file, so disable needs an explicit removal step before `up`; sign-in and Service configuration need a running container, so they happen after (R7).

Tailscale-side behaviour that could not be confirmed from documentation is listed as ten validation tasks against a real tailnet (research.md, V1 to V10). They gate "complete", not "merged": the code is built and tested against a stubbed companion and real Docker networking, and `validation.md` records what has and has not been run.

## Technical Context

**Language/Version**: TypeScript on Bun (server, shared, sdk, cli), React + Vite (web).

**Primary Dependencies**: no new npm dependencies. One new container image at runtime, `tailscale/tailscale`, pinned by tag and digest, pulled only for opted-in deployments.

**Storage**: `tailscaleIngress` on the existing per-deployment JSON record; a transient 0600 credential file under `deployments/<id>/tailscale/`; one Docker named volume per opted-in deployment for the tailnet identity. No database change.

**Testing**: `bun run test` (server `bun test`, web and cli `vitest`). One new real-Docker integration file under `packages/server/src/__tests__/integration/`, added to the explicit list in `test:integration`. Real-tailnet checks are manual and recorded.

**Target Platform**: self-hosted Linux host running the Hola compose stack, with outbound internet.

**Project Type**: monorepo web service, `packages/{server,web,shared,sdk,cli}`. `packages/compose` is not changed.

**Performance Goals**: a status read costs one `compose exec` at most every 30 seconds per deployment. Detail and list reads cost nothing extra.

**Constraints**: the validator is not weakened; no credential at rest after joining; no host ports, privileges or host networking; a deploy never waits more than 60 seconds on the companion.

**Scale/Scope**: one private ingress per deployment; tens of deployments per host.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Traefik-Only Ingress | **Violated, by design** | The feature is a second ingress path. See Complexity Tracking. The amendment (v2.0.0) and ADR 0007 ship in this PR. The parts of Principle I that are about enforcement stay whole: no host ports, pinned images, validator not bypassed. |
| II. Remote Catalog as Single Source of Truth | Pass | No catalog or manifest change. The companion is not an app. |
| III. Async Deploy Lifecycle | Pass | Sign-in, Service configuration and removal all run in `runLifecycleJob`. The endpoint only validates and persists. The one inline path (disable on a stopped app) runs under `runExclusive`, like uninstall. |
| IV. Real/Mock Service Pairs | Pass | `TailscaleIngressService` has Real and Mock implementations registered in `simple-factory.ts`. New `DockerService` methods are added to both implementations. |
| V. Generic Cross-App Primitives | Pass | Nothing is app-specific. Omnigraph appears only in documentation and one example. It is not a cross-app capability (no app gains access to another), but an ADR is written anyway because it changes Principle I. |
| VI. Auth Is Platform-Agnostic and Default-On | Pass with a stated limit | The private path does not pass the forward-auth gate. FR-036 makes that an explicit acknowledgement instead of a silent bypass. `ProvisionerService` is untouched. |
| VII. Quality Gates Before Merge | Pass | typecheck, lint, test, build; plus the real-Docker integration test locally. |

Re-check after design: unchanged. No new violation was introduced by the data model or contracts.

## Design

### Server

| Piece | File | What |
|---|---|---|
| Types and validation | `packages/shared/src/tailscale-ingress.ts` (new), exported from the package index | `TailscaleIngressSetting`, `…Status`, `…Guidance`, request/response types; `validateTailscaleIngressInput` (pure); `buildTailscaleGuidance` (pure); `nodeNameFor`. `API.deployments.tailscaleIngress`. |
| Reserved names | `packages/shared/src/compose-validate.ts` | `hola-tailscale` joins `RESERVED_SERVICE_NAMES`; the two network names are refused at top level. |
| Image pin | `packages/server/src/services/core/platform-images.ts` (new) | `tailscaleImage()`: the digest-pinned default, or a validated `HOLA_TAILSCALE_IMAGE`. |
| Injection | `packages/server/src/services/core/compose-tailscale.ts` (new) | `injectTailscaleIngress(content, opts)`: pure YAML transform producing exactly [contracts/compose.md](./contracts/compose.md). Throws a typed error when the backend is missing or has a `network_mode`. |
| Companion driver | `packages/server/src/services/core/tailscale-ingress.ts` (new) | `TailscaleIngressService` interface with `observe`, `signIn`, `applyServe`, `withdraw`, `signOut`; `RealTailscaleIngressService` (exec through `DockerService`), `MockTailscaleIngressService` (scripted states, records calls). Parses `status --json`; maps to states per research R10. |
| Docker | `packages/server/src/services/core/docker.ts` | `composeExec` gains `{ input?, quiet?, timeoutMs? }`; new `composeRemoveService`, `removeVolume`, `removeNetwork`. Real and Mock. |
| Deployment service | `packages/server/src/services/core/deployment.ts` | `getTailscaleIngress`, `setTailscaleIngress`, `disableTailscaleIngress`; the injection call as the last step before the runtime compose is written; before-up and after-up hooks in `runLifecycleJob` for restart, start, deploy and rollback; cleanup in `performDelete`; `tailscaleIngress` summary in `toDetailResponse`. |
| Routes | `packages/server/src/server.ts` | `GET/PUT/DELETE /api/deployments/:id/tailscale-ingress`, placed before the generic `/:id` match. |
| API docs | `packages/shared/src/docs/api-explorer.ts` | The three routes and their `details.code` values. |

**Missing backend after an upgrade or rollback (FR-028).** `injectTailscaleIngress` is not allowed to fail the deploy of the app for this. `materializeCompose` catches the typed "backend missing/unsupported" error, renders **without** the companion, and records the reason on the in-memory status so `observe` reports `error` naming the missing service. The app deploys; nothing is forwarded anywhere.

**Hooks in `runLifecycleJob`.** Both are wrapped so that a failure in them is logged and reflected in status but never fails the job (FR-027), with one exception: the before-up removal of the companion container, if it fails, fails the job, because continuing would leave a companion running that the operator asked to remove.

**Uninstall.** `performDelete` calls `withdraw` and `signOut` (best effort, bounded at 20 seconds total, skipped under `force`) before `teardownContainers`, then `removeVolume` after it. `composeDown` already removes the two networks because the runtime compose declares them. The removal report is returned as a warning.

### SDK, CLI, web

- **SDK**: `put` helper; `deployments.tailscaleIngress.{get,set,disable}`.
- **CLI**: `packages/cli/src/commands/deployments/tailscale.ts` with show, enable, login and disable, following `channel.ts` (injected SDK for tests) and `config.ts` (job watching). Credential from a file or stdin only.
- **Web**: `put` in `sdk-adapter`; `useTailscaleIngressApi` hook and query key; a "Private Tailscale ingress" card on the deployment Overview tab showing state, address and action; an enable/edit dialog (service name, tag, backend select from `defaults.services`, port, mode, credential field of type password, forward-auth acknowledgement when required, restart warning); a disable confirm; a collapsible setup guide rendering `guidance` with copy buttons.

### Documentation and governance

- `docs/adr/0007-private-tailscale-ingress.md`.
- `.specify/memory/constitution.md` v2.0.0: Principle I renamed and restated; Sync Impact Report updated.
- `docs/TAILSCALE_INGRESS.md` (operator guide, FR-037), linked from `docs/OPERATIONS.md` and `CLAUDE.md`.
- `CLAUDE.md`: an Architecture note.
- `specs/010-tailscale-ingress/validation.md`: V1 to V10 with status.

## Project Structure

### Documentation (this feature)

```text
specs/010-tailscale-ingress/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── validation.md
├── contracts/
│   ├── api.md
│   └── compose.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/
├── tailscale-ingress.ts                      # new: types, validation, guidance
├── compose-validate.ts                       # reserved names
├── index.ts                                  # exports, API paths, detail field
└── docs/api-explorer.ts

packages/server/src/
├── services/core/
│   ├── platform-images.ts                    # new
│   ├── compose-tailscale.ts                  # new
│   ├── tailscale-ingress.ts                  # new: Real + Mock
│   ├── docker.ts                             # exec options, rm service/volume/network
│   └── deployment.ts                         # setting, injection, hooks, teardown
├── services/simple-factory.ts
├── server.ts                                 # routes
└── __tests__/
    ├── deployments/compose-tailscale.test.ts
    ├── deployments/tailscale-ingress-setting.test.ts
    ├── deployments/tailscale-ingress-lifecycle.test.ts
    ├── deployments/tailscale-ingress-status.test.ts
    ├── routes/tailscale-ingress-routes.test.ts      # location follows existing route tests
    └── integration/tailscale-ingress.it.ts

packages/sdk/src/index.ts
packages/cli/src/commands/deployments/tailscale.ts   # new
packages/cli/src/index.ts
packages/cli/src/__tests__/tailscale.test.ts

packages/web/src/
├── utils/sdk-adapter.ts
├── state/queryKeys.ts
├── hooks/useTailscaleIngressApi.ts           # new
├── components/TailscaleIngressCard.tsx       # new (location follows existing components)
├── pages/DeploymentDetail.tsx
└── __tests__/…

docs/adr/0007-private-tailscale-ingress.md
docs/TAILSCALE_INGRESS.md
.specify/memory/constitution.md
```

**Structure Decision**: The existing monorepo layout. New server logic is three new files beside the modules they resemble (`compose-mounts.ts`, `compose-network.ts`), with `deployment.ts` gaining only call sites and the setting's three methods.

## Phasing

1. **Foundation**: shared types and validation, reserved names, image pin, Docker methods, pure injection with its tests.
2. **Story 3 then Stories 1 and 2**: off-is-unchanged proven first; then setting persistence, routes, injection wiring, hooks, driver, status.
3. **Story 4**: lifecycle and cleanup paths.
4. **Stories 5 and 6**: guidance, alternative backend and TCP mode (mostly validation and tests on top of phase 2).
5. **Clients**: SDK, CLI, web.
6. **Docs and governance**: ADR, constitution, operator guide, validation record.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle I: an ingress path that does not pass through Traefik | A tailnet grant names a destination. The only destination a Hola host offers today is the shared proxy, and the proxy picks the app from a hostname the caller controls, so a grant to it is a grant to every app, the dashboard and the admin API. Per-app isolation needs a per-app destination that never touches the shared proxy. | **Put Traefik on the tailnet and grant that**: exactly the problem being solved. **A second Traefik entrypoint per app**: needs a host port per app, and still one shared address. **Tell operators to run their own sidecar**: the validator rightly forbids what that needs (extra networks reaching other apps, arbitrary images with state mounts), so it would mean weakening the validator for everyone. |
| A third-party image run by the platform | Tailscale's own client is the only implementation of the protocol. | Building it into the server image would add a privileged-adjacent network daemon to a container that holds the Docker socket. |

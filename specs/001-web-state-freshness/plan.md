# Implementation Plan: Web UI State Freshness

**Branch**: `001-web-state-freshness` | **Date**: 2026-07-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-web-state-freshness/spec.md`

## Summary

Replace the web dashboard's ad-hoc, non-reactive local-state + `globalCache` +
`live-bus` pattern with **TanStack Query** as the single reactive source of truth
for server-owned data, and wire the existing global `/api/events` SSE stream
directly into the `QueryClient`. Scope is the first (highest-value) slice:
**deployments** (list + detail + config + history), **jobs**, and the **dashboard
summary**. After the change, a deployment status/deletion/job event received over
`/api/events` updates every mounted view that reads that data — Apps, Deployments,
Deployment detail, job tracker, dashboard summary — with no browser refresh, and
polling is demoted to a fallback for when the stream is disconnected.

The public hook names (`useDeploymentsApi`, `useDeploymentDetailApi`, `useJobsApi`,
`useWorkingApi`, and the detail sub-hooks) are preserved to limit page churn; their
internals are re-implemented on `useQuery`/`useMutation`. `useGlobalEvents` stops
touching `globalCache`/`live-bus` and instead drives the `QueryClient` via
`setQueryData` / `invalidateQueries` / `removeQueries`.

## Technical Context

**Language/Version**: TypeScript ~6.0, React 19.2 (`packages/web`)

**Primary Dependencies**: `@tanstack/react-query` (new), React Router 7,
`@hola/sdk`, `@hola/shared`; existing `useSSE` hook for the event stream

**Storage**: N/A (client-side in-memory query cache; no persistence)

**Testing**: Vitest 4 + `@testing-library/react` + jsdom (`packages/web`, run via
`bun --cwd packages/web test` / `npx vitest run`)

**Target Platform**: Modern browsers (SPA served by nginx; `/api` proxied to server)

**Project Type**: Web application — change is confined to the `web` package
frontend; no server, sdk, or shared changes required for this slice.

**Performance Goals**: Event-to-render propagation ≤ 3s across all open views
(SC-001/SC-002); event handling is O(number of affected queries), negligible.

**Constraints**:
- `/api/events` MUST stay a **relative** URL (prod same-origin + Vite dev proxy).
- Event stream + data access MUST remain authenticated (unchanged `useSSE`/`api`).
- No new direct `globalCache` usage for server-owned API data (FR-011).
- Mutations are **server-confirmed**, not optimistic (clarification 2026-07-06).
- Deletion while viewing detail → **redirect to list + transient notice**
  (clarification 2026-07-06).

**Scale/Scope**: ~5 hook modules re-implemented; ~5 consumer pages/components
(`Dashboard`, `Apps`, `Deployments`, `DeploymentDetail`, `JobTracker`/`JobTrackerNew`);
1 provider added at the app root; `useGlobalEvents` rewritten; `live-bus` retired
for server state. Deferred: catalog, backups, notifications, settings, system status.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against `.specify/memory/constitution.md` v1.0.0:

| Principle | Applies? | Assessment |
|-----------|----------|------------|
| I. Traefik-Only Ingress | Indirect | No ingress change. Preserves the relative `/api/events` URL so prod same-origin + Vite proxy both resolve (FR-012). PASS |
| II. Remote Catalog as Single Source of Truth | No | Catalog data is explicitly out of scope for this slice. PASS |
| III. Async Deploy Lifecycle | No | Client-only change; deploy lifecycle untouched. The UI now *reflects* async lifecycle events more faithfully. PASS |
| IV. Real/Mock Service Pairs | No | Server-side convention; the web package does not use `simple-factory`. Tests inject a `QueryClient` + mock SSE, consistent in spirit. PASS |
| V. Generic Cross-App Primitives | No | No cross-app primitive or manifest surface involved. PASS |
| VI. Auth Is Platform-Agnostic and Default-On | Indirect | Event stream + API calls remain authenticated via the existing `api`/`useSSE` layer; no auth weakening (FR-013). PASS |
| VII. Quality Gates Before Merge | **Yes** | Land via branch + PR to `main`; `bun run typecheck`, `lint`, `test`, `build` must pass across packages; re-run typecheck after lint auto-fix; versions stay in sync (`web` stays `0.0.0`). Enforced in tasks. PASS |

**Result: PASS** — no violations, no Complexity Tracking entries required.

Adding a well-established client dependency (`@tanstack/react-query`) does not
implicate any platform principle; it *reduces* complexity by replacing three
bespoke mechanisms (`globalCache` for server state, `live-bus`, and manual
per-hook polling orchestration) with one standard reactive cache.

*Post-Phase-1 re-check*: Design artifacts introduce no server/platform surface,
no host ports, no catalog or auth changes. Constitution Check still **PASS**.

## Project Structure

### Documentation (this feature)

```text
specs/001-web-state-freshness/
├── plan.md              # This file
├── spec.md              # Feature spec (with Clarifications)
├── research.md          # Phase 0 — decisions & rationale
├── data-model.md        # Phase 1 — query families, event→cache mapping
├── quickstart.md        # Phase 1 — how to validate the feature end-to-end
├── contracts/
│   ├── query-keys.md    # Centralized query key contract
│   ├── events.md        # SSE event → QueryClient action contract
│   └── hooks.md         # Preserved hook return-shape contract
└── checklists/
    └── requirements.md  # Spec quality checklist (from /speckit-specify)
```

### Source Code (repository root)

Change is confined to `packages/web/src`:

```text
packages/web/src/
├── state/                      # NEW — server-state layer
│   ├── queryClient.ts          # QueryClient factory + default options
│   ├── queryKeys.ts            # Centralized, stable query keys
│   └── useGlobalQueryEvents.ts # SSE → QueryClient wiring (replaces globalCache patching)
├── hooks/
│   ├── useDeploymentsApi.ts    # re-implement on useQuery (same export/return shape)
│   ├── useDeploymentDetailApi.ts # detail + config + history + mutations on useQuery/useMutation
│   ├── useJobsApi.ts           # re-implement on useQuery (+ useDeploymentJobs/useActiveJobs)
│   ├── useWorkingApi.ts        # dashboard summary on useQuery
│   ├── useGlobalEvents.ts      # thin: mount SSE + delegate to useGlobalQueryEvents
│   └── useSSE.ts               # unchanged
├── components/layout/AppShell.tsx  # still calls useGlobalEvents (now query-driven)
├── main.tsx | App.tsx          # wrap tree in <QueryClientProvider>
├── pages/
│   ├── Dashboard.tsx | Apps.tsx | Deployments.tsx | DeploymentDetail.tsx  # consumers; minimal churn
├── components/JobTracker.tsx | JobTrackerNew.tsx  # consumers
└── utils/
    ├── live-bus.ts             # retired for server state (delete after migration)
    └── cache.ts (globalCache)  # remains only for any non-API/UI use; not used for server state

packages/web/src/__tests__/ (and co-located *.test.ts)
├── state/useGlobalQueryEvents.test.ts   # NEW — event → invalidate/patch/remove
├── hooks/useGlobalEvents.test.ts        # UPDATE — asserts QueryClient effects, not globalCache
├── pages/DeploymentDetail.test.tsx      # NEW/UPDATE — rerenders on simulated SSE patch
└── utils/live-bus.test.ts               # REMOVE/replace — live-bus retired for server state
```

**Structure Decision**: Single-package (web) frontend change. A new
`packages/web/src/state/` directory owns the query client, keys, and SSE wiring;
existing hook modules are re-implemented in place to preserve their import paths
and return shapes; consumer pages change minimally (mostly none, since the hooks'
public contracts are kept).

## Phase 0 — Research

See [research.md](./research.md). All Technical Context items are resolved; there
are no open `NEEDS CLARIFICATION` markers (the three spec clarifications closed the
material UX/scope decisions, and the remaining choices — query defaults, patch-vs-
invalidate, provider placement, live-bus retirement — are decided in research.md).

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — query families, cached entity shapes, and the
  event → cache-action mapping (the "state model").
- [contracts/query-keys.md](./contracts/query-keys.md) — the centralized query-key
  contract (stable keys, hierarchy for family invalidation).
- [contracts/events.md](./contracts/events.md) — for each SSE event type, the exact
  `QueryClient` action(s) to perform.
- [contracts/hooks.md](./contracts/hooks.md) — the preserved public return shape of
  each migrated hook, so consumer pages need no changes.
- [quickstart.md](./quickstart.md) — runnable validation of the acceptance criteria.

## Complexity Tracking

No constitution violations — section intentionally empty.

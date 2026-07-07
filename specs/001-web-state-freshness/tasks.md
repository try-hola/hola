---
description: "Task list for Web UI State Freshness"
---

# Tasks: Web UI State Freshness

**Input**: Design documents from `specs/001-web-state-freshness/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED — the spec explicitly requires them (FR-014 + "Tests To Add", SC-006).

**Organization**: Grouped by user story. All work is in `packages/web`. Run the web
suite with `bun --cwd packages/web test`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1 / US2 / US3 / US4 (maps to spec.md user stories)

## Path Conventions

Web SPA package: source under `packages/web/src/`, tests co-located as `*.test.ts(x)`
or under `packages/web/src/__tests__/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the library and scaffold the server-state layer.

- [X] T001 Add `@tanstack/react-query` to `packages/web` (`bun add @tanstack/react-query --cwd packages/web`); verify it appears under `dependencies` in `packages/web/package.json`
- [X] T002 Create the `packages/web/src/state/` directory and an empty barrel/index if the codebase uses one (otherwise skip the barrel); no logic yet

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The reactive cache backbone every user story depends on — query client,
centralized keys, provider, and the SSE→QueryClient wiring skeleton.

**⚠️ CRITICAL**: No user-story migration can begin until this phase is complete.

- [X] T003 [P] Create the `QueryClient` factory in `packages/web/src/state/queryClient.ts` with defaults from research.md R2 (`staleTime` 5s lists/summary & 10s detail, `gcTime` default, `refetchOnWindowFocus: true`, `refetchOnReconnect: true`, query `retry: 1`, mutations no retry)
- [X] T004 [P] Create centralized query keys in `packages/web/src/state/queryKeys.ts` per contracts/query-keys.md (`summary`, `deployments.{all,list,detail,config,history}`, `jobs.{all,list,detail}`), all `as const`, with a `normalizeParams` helper for stable list keys
- [X] T005 Wrap the app root in `<QueryClientProvider>` in `packages/web/src/main.tsx` using the T003 factory (outside the router, inside auth context per research.md R5)
- [X] T006 Create `packages/web/src/state/useGlobalQueryEvents.ts` skeleton: subscribe to `/api/events` via the existing `useSSE` (relative URL, existing reconnect config, `eventTypes: ['job_update','deployment_update','deployment_deleted']`), call `useQueryClient()`, and dispatch to a `handleGlobalEvent(qc, event, opts)` with per-event branches stubbed (implemented in later phases); wrap per-event work defensively so one bad event can't break the subscription (contracts/events.md)
- [X] T007 Rewrite `packages/web/src/hooks/useGlobalEvents.ts` to be a thin wrapper that mounts `useGlobalQueryEvents()`; remove its `globalCache` and `live-bus` imports (FR-011)

**Checkpoint**: Provider mounted, keys + client exist, SSE handler dispatches (no-op branches). Hooks can now be migrated one family at a time.

---

## Phase 3: User Story 1 - Deployment status propagates across every view (Priority: P1) 🎯 MVP

**Goal**: A `deployment_update` event refreshes the Apps page, Deployments list, and
Deployment detail (incl. config + history) with no browser refresh; an open detail
page re-renders from shared query data.

**Independent Test**: Seed a detail query, dispatch a simulated `deployment_update`,
assert the detail re-renders the new status and the deployments/summary families are
invalidated; manually, change a status and watch all deployment views update.

### Tests for User Story 1 ⚠️ (write first, expect fail)

- [X] T008 [P] [US1] In `packages/web/src/state/__tests__/useGlobalQueryEvents.test.ts`, test: `deployment_update` on a seeded `deployments.detail(id)` patches status/uptime/lastUpdated AND invalidates `deployments`, `jobs`, `summary` families. Also assert (FR-010): a `deployment_update` for an **uncached** id is a no-op — no throw and no phantom `deployments.detail` cache entry is created
- [X] T009 [P] [US1] In `packages/web/src/__tests__/pages/DeploymentDetail.test.tsx`, test: rendering `DeploymentDetail` inside a `QueryClientProvider` with a seeded detail query re-renders the new status when a simulated `deployment_update` patches that query
- [X] T010 [P] [US1] In `packages/web/src/state/__tests__/useGlobalQueryEvents.test.ts`, test: two sibling list readers (Deployments + Apps params) both go stale/refetch on one `deployments` family invalidation
- [X] T010a [P] [US1] In `packages/web/src/state/__tests__/useGlobalQueryEvents.test.ts`, test (spec.md Edge Cases — burst/out-of-order): dispatching two `deployment_update`s for the same id out of order converges the cached detail to the event with the newest `lastUpdated`/status (latest-wins; no stuck intermediate state)

### Implementation for User Story 1

- [X] T011 [US1] Implement the `deployment_update` branch in `packages/web/src/state/useGlobalQueryEvents.ts` per contracts/events.md (setQueryData patch of `deployments.detail(id)` when cached; invalidate `deployments`, `jobs`, `summary`). Guard the patch to be latest-wins: only overwrite when the event's `lastUpdated` is newer than the cached value, so an out-of-order/stale event can't clobber fresher data (satisfies T010a)
- [X] T012 [P] [US1] Migrate `packages/web/src/hooks/useDeploymentsApi.ts` to `useQuery` with `queryKeys.deployments.list(params)`; preserve `{ data, loading, error, refetch }` shape (contracts/hooks.md); drop `globalCache`/`onLive` usage
- [X] T013 [US1] Migrate `packages/web/src/hooks/useDeploymentDetailApi.ts` core detail to `useQuery` with `queryKeys.deployments.detail(id)`; keep the exported mutation methods (`updateConfiguration`, `executeAction`, `upgradeDeployment`, `removeDeployment`) — convert them to `useMutation` with server-confirmed `onSuccess` invalidation per data-model.md (no optimistic final state)
- [X] T014 [P] [US1] Migrate `useDeploymentConfigApi` and `useDeploymentHistoryApi` (same file) to `useQuery` with `queryKeys.deployments.config(id)` / `history(id, page)` so they join the `deployments` family (clarification: config+history in scope)
- [X] T015 [P] [US1] Migrate `packages/web/src/hooks/useWorkingApi.ts` (dashboard summary) to `useQuery` with `queryKeys.summary`; preserve return shape
- [X] T016 [US1] Verify consumer pages `packages/web/src/pages/Apps.tsx`, `Deployments.tsx`, `DeploymentDetail.tsx`, `Dashboard.tsx` compile unchanged against the preserved hook shapes; adjust only if a hook's surface shifted

**Checkpoint**: Deployment status changes propagate live across Apps, Deployments, detail, config, history, and summary. MVP demonstrable.

---

## Phase 4: User Story 2 - Deleted deployments disappear immediately (Priority: P1)

**Goal**: A `deployment_deleted` event removes the app from all list views and adjusts
summary counts; an open detail page auto-redirects to the list with a transient
"removed" notice (clarification 2026-07-06).

**Independent Test**: Dispatch a simulated `deployment_deleted`; assert the detail
query is removed and `deployments`/`summary` invalidated; render the detail page and
assert it redirects + shows the notice.

### Tests for User Story 2 ⚠️

- [X] T017 [P] [US2] In `packages/web/src/state/__tests__/useGlobalQueryEvents.test.ts`, test: `deployment_deleted` removes `deployments.detail(id)` (and config/history for that id), invalidates `deployments` + `summary`, and invokes the `onDeploymentDeleted(id)` callback. Also assert (FR-010): a `deployment_deleted` for an id that was never loaded is a safe no-op (no throw; `onDeploymentDeleted` still called so a mismatched open detail isn't left stale)
- [X] T018 [P] [US2] In `packages/web/src/__tests__/pages/DeploymentDetail.test.tsx`, test: when the viewed deployment is deleted, the page navigates to the list route and surfaces a transient "removed" notice

### Implementation for User Story 2

- [X] T019 [US2] Implement the `deployment_deleted` branch in `packages/web/src/state/useGlobalQueryEvents.ts` per contracts/events.md (removeQueries detail+config+history for the id; invalidate `deployments`, `summary`; call `opts.onDeploymentDeleted?.(id)`)
- [X] T020 [US2] Wire the redirect in `packages/web/src/pages/DeploymentDetail.tsx`: on deletion of the currently-viewed id (via the callback or by observing the removed detail query), navigate to the Deployments/Apps list using React Router and trigger the transient notice
- [X] T021 [US2] Provide the transient "removed" notice: reuse the app's existing toast/notification affordance if one exists; otherwise add a minimal transient notice component in `packages/web/src/components/` and use it from T020

**Checkpoint**: Deletions vanish from lists + summary live, and the detail page never dead-ends on a removed app.

---

## Phase 5: User Story 3 - Job activity & dashboard summary stay current (Priority: P2)

**Goal**: `job_update` events refresh the job tracker / recent jobs and the summary
counts without a browser refresh.

**Independent Test**: Dispatch a simulated `job_update`; assert `jobs` + `summary`
invalidate; a mounted job tracker refetches.

### Tests for User Story 3 ⚠️

- [X] T022 [P] [US3] In `packages/web/src/state/__tests__/useGlobalQueryEvents.test.ts`, test: `job_update` invalidates `jobs` + `summary` families

### Implementation for User Story 3

- [X] T023 [US3] Implement the `job_update` branch in `packages/web/src/state/useGlobalQueryEvents.ts` (invalidate `jobs`, `summary`)
- [X] T024 [US3] Migrate `packages/web/src/hooks/useJobsApi.ts` (and `useDeploymentJobs`, `useActiveJobs`) to `useQuery` with `queryKeys.jobs.list(params)`; preserve return shape; drop `globalCache`/`onLive`
- [X] T025 [P] [US3] Verify `packages/web/src/components/JobTracker.tsx` and `JobTrackerNew.tsx` compile/behave against the migrated `useJobsApi`; adjust only if needed

**Checkpoint**: Jobs and summary counts update live from events.

---

## Phase 6: User Story 4 - Live updates primary, polling as fallback (Priority: P3)

**Goal**: Events are the primary consistency mechanism; polling becomes a bounded
safety net via TanStack Query's `refetchInterval` (transitional-only) plus
`refetchOnReconnect`/focus. Bespoke `live-bus`-gated timers are removed.

**Independent Test**: With the event stream disabled, confirm in-scope views still
reconcile on next fetch (focus/interval); with it enabled, confirm updates come from
events, not scheduled polls.

### Tests for User Story 4 ⚠️

- [X] T026 [P] [US4] In `packages/web/src/hooks/useGlobalEvents.test.ts` (rewritten), test: `useGlobalEvents` mounts the SSE subscription and drives the `QueryClient` (no `globalCache`/`live-bus` usage)
- [X] T027 [P] [US4] Add a fallback test (e.g. in `packages/web/src/__tests__/utils/live-features.test.ts` or a new hook test): a transitional deployments/jobs query enables `refetchInterval` and reconciles when no event arrives; non-transitional data does not poll
- [X] T027a [P] [US4] In `packages/web/src/state/__tests__/useGlobalQueryEvents.test.ts` (or a `useGlobalEvents` test), test (FR-009): when the `/api/events` subscription **reconnects** after a drop, the in-scope families (`deployments`, `jobs`, `summary`) are invalidated so changes missed during the outage reconcile — even for a mounted, online, focused, non-transitional query

### Implementation for User Story 4

- [X] T028 [US4] Replace the bespoke `isLiveConnected()`-gated `setInterval` polling in `useDeploymentsApi`, `useDeploymentDetailApi`, and `useJobsApi` with TanStack Query `refetchInterval`, enabled only while data is transitional (deployment `installing`/`updating`; active jobs) per research.md R8
- [X] T028a [US4] In `packages/web/src/state/useGlobalQueryEvents.ts`, invalidate the in-scope families (`deployments`, `jobs`, `summary`) whenever the `useSSE('/api/events')` connection transitions from disconnected → connected (reconnect), closing the missed-events window from FR-009 (SSE reconnect does not replay events). Serialize with the other edits to this file (see Dependencies note)
- [X] T029 [US4] Remove `packages/web/src/utils/live-bus.ts` and delete `packages/web/src/utils/live-bus.test.ts` once no server-state hook imports `live-bus` (grep to confirm zero importers first)

**Checkpoint**: All in-scope freshness is event-driven with a bounded polling fallback; `live-bus` retired.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, regression guards, and the full quality gate.

- [X] T030 [P] Grep the migrated hooks (`useDeploymentsApi`, `useDeploymentDetailApi`, `useJobsApi`, `useWorkingApi`) for `globalCache` and confirm zero server-state usage remains (FR-011 / SC-007); remove now-dead `globalCache`/`sdk-adapter` invalidation paths for these endpoints if unused elsewhere
- [X] T031 [P] Confirm `/api/events` remains a relative URL and the stream + API calls remain authenticated (FR-012 / FR-013)
- [X] T032 Run `bun --cwd packages/web test` and make the full web suite green (including the new/updated freshness tests)
- [X] T033 Run the full gate: `bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build` (re-run typecheck after lint per CLAUDE.md / Constitution VII)
- [X] T034 Execute the manual scenarios in `specs/001-web-state-freshness/quickstart.md` (status propagation, deletion+redirect, jobs+summary, fallback) — ideally via the `vm-e2e` skill / `bin/vm-web-check` against a real dashboard

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — **BLOCKS all user stories** (provider, keys, client, SSE skeleton).
- **US1 (Phase 3)**: depends on Foundational. Establishes the deployment query family + detail migration.
- **US2 (Phase 4)**: depends on Foundational + **US1's detail migration** (T013) since the redirect builds on the migrated detail page/hook.
- **US3 (Phase 5)**: depends on Foundational. Largely independent of US1/US2 (jobs family) — can run in parallel with US1/US2 by a second developer.
- **US4 (Phase 6)**: depends on the hook migrations it edits (US1's deployment hooks T012–T014, US3's jobs hook T024). Do after those exist.
- **Polish (Phase 7)**: depends on all desired stories.

### Within Each User Story

- Tests (marked ⚠️) written first and expected to fail before implementation.
- Event-handler branch + hook migration before consumer-page verification.

### Parallel Opportunities

- T003 + T004 in parallel (different files); T005–T007 follow.
- Within US1: T008/T009/T010 (tests) in parallel; T012/T014/T015 (separate hook files) in parallel; T011 & T013 touch shared/handler files — serialize.
- US3 (jobs) can proceed in parallel with US1/US2 after Foundational, since it edits different hook/handler branches — coordinate the single `useGlobalQueryEvents.ts` file (T011/T019/T023 all edit it → serialize those three).
- Polish T030/T031 in parallel.

**Note**: `useGlobalQueryEvents.ts` is edited by T006, T011, T019, T023, T028a — these MUST be serialized (same file), even though their stories are otherwise independent.

---

## Parallel Example: User Story 1

```bash
# Tests first (different files):
Task: "US1 event test in packages/web/src/state/__tests__/useGlobalQueryEvents.test.ts"
Task: "US1 detail rerender test in packages/web/src/__tests__/pages/DeploymentDetail.test.tsx"

# Then independent hook migrations (different files):
Task: "Migrate useDeploymentsApi.ts to useQuery"
Task: "Migrate useDeploymentConfigApi/useDeploymentHistoryApi to useQuery"
Task: "Migrate useWorkingApi.ts (summary) to useQuery"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & VALIDATE**:
   deployment status now propagates live across every deployment view. Demo-able MVP.

### Incremental Delivery

- Foundation ready → US1 (status live) → US2 (deletions + redirect) → US3 (jobs+summary
  live) → US4 (polling demoted, `live-bus` retired) → Polish (gate + quickstart).
- Each story is an independently testable increment that doesn't regress the prior.

### Parallel Team Strategy

- After Foundational: Dev A takes US1→US2 (deployments/detail); Dev B takes US3 (jobs).
  Coordinate edits to the single `useGlobalQueryEvents.ts` handler (serialize T011/T019/T023).
  US4 and Polish land last, together.

---

## Notes

- [P] = different files, no incomplete-task dependency.
- No server / `@hola/sdk` / `@hola/shared` changes in this slice — web package only.
- Preserve exported hook names + return shapes so consumer pages stay unchanged (contracts/hooks.md).
- Commit after each task or logical group; keep `web` version at `0.0.0`.
- Constitution VII gate (T033) is mandatory before PR; re-run typecheck after lint.

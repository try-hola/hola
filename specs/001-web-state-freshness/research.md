# Phase 0 Research: Web UI State Freshness

All decisions below resolve the Technical Context. No `NEEDS CLARIFICATION` remain.

## R1. Server-state library

**Decision**: Adopt `@tanstack/react-query` (v5) as the reactive server-state
layer for `packages/web`.

**Rationale**: The problem is squarely *server state* — fetching, caching,
invalidation, cross-view sharing, and mutation synchronization. TanStack Query is
the industry-standard solution for exactly this: it provides a reactive cache
(subscribers re-render on change — the missing piece that made `globalCache`
patching a no-op), structural-sharing to avoid needless re-renders, built-in
`staleTime`/`gcTime`, `refetchOnWindowFocus`/reconnect, and a `QueryClient`
imperative API (`setQueryData`/`invalidateQueries`/`removeQueries`) that the SSE
handler can call directly. React 19 is fully supported.

**Alternatives considered**:
- **Zustand / Redux / Jotai** — client-state stores; would require hand-rolling
  fetching, caching, dedupe, and invalidation. Rejected: this is not client-owned
  state, and rebuilding a query cache by hand is the trap the current code fell
  into.
- **SWR** — viable and lighter, but weaker mutation/invalidation ergonomics and
  less expressive query-key/family invalidation, which this design leans on
  heavily. The handoff explicitly recommends TanStack Query.
- **Make `globalCache` reactive** (add a subscriber mechanism) — rejected: that
  reinvents TanStack Query poorly and keeps the fragile mixed cache shapes.

## R2. QueryClient default options

**Decision**:
- `staleTime`: **short but non-zero** — 5s for lists/summary, 10s for detail. With
  the SSE stream as the primary freshness driver, queries need not aggressively
  refetch; events invalidate precisely what changed.
- `gcTime`: default (5 min) — keeps recently-viewed detail patchable by events.
- `refetchOnWindowFocus`: **true** — cheap correctness safety net when a laptop
  wakes / a tab regains focus (supports FR-009).
- `refetchOnReconnect`: **true**.
- `retry`: 1 for queries (avoid hammering a briefly-down server); mutations no
  auto-retry.

**Rationale**: Events do the heavy lifting; these defaults make the fallback path
correct without redundant network chatter. Values are starting points, tunable in
implementation.

**Alternatives considered**: `staleTime: 0` (refetch-happy, redundant with SSE,
rejected); `staleTime: Infinity` (fully event-driven, but brittle if an event is
ever missed — rejected in favor of a modest fallback).

## R3. Event → cache action: patch vs. invalidate

**Decision**:
- `deployment_update` → **patch** the cached detail via `setQueryData`
  (status/uptime/lastUpdated, matching the current instant-update behavior) **and**
  `invalidateQueries` the `deployments` family, `jobs` family, and `summary`.
- `deployment_deleted` → `removeQueries` the detail (all sub-keys for that id) and
  `invalidateQueries` `deployments` + `summary`.
- `job_update` → `invalidateQueries` `jobs` + `summary` (patching job list/detail
  is a later optimization; invalidation is sufficient and robust).

**Rationale**: Patching the detail preserves today's zero-latency status update on
the open page; invalidation of families guarantees list/summary convergence
without needing to know every cached params permutation. Invalidation only
refetches queries with active observers (mounted views) plus marks the rest stale,
so it is cheap and correct for unmounted views (FR-010).

**Alternatives considered**: patch everything (fragile — must reconstruct every
list/summary shape, and lists are param-keyed); invalidate everything including
detail (loses the instant on-page status patch, adds a refetch). Chosen approach
mirrors the handoff and the existing `useGlobalEvents` intent.

## R4. Query-key hierarchy for family invalidation

**Decision**: Centralize keys in `state/queryKeys.ts` with a hierarchical,
`as const` structure so `invalidateQueries({ queryKey: ['deployments'] })` matches
every list/detail/config/history entry by prefix. See
[contracts/query-keys.md](./contracts/query-keys.md).

**Rationale**: TanStack Query matches query keys by array prefix; a stable
hierarchy (`['deployments','list',params]`, `['deployments','detail',id]`, …) makes
"invalidate the whole deployments family" a one-liner and prevents the
incomplete-invalidation bug the SDK adapter has today.

## R5. Provider placement

**Decision**: Create the `QueryClient` via a `state/queryClient.ts` factory and
wrap the app in `<QueryClientProvider>` at the **root** — in `main.tsx`, outside
the router but inside any auth context the API needs. One client instance for the
app; tests construct a fresh client per test.

**Rationale**: A single app-wide cache is the whole point (cross-view sharing).
Root placement ensures every route and `AppShell`'s `useGlobalEvents` share it.

**Alternatives considered**: per-route clients (defeats cross-view sharing —
rejected).

## R6. SSE integration point

**Decision**: Keep the single `/api/events` subscription mounted once in
`AppShell` via `useGlobalEvents`. Rewrite `useGlobalEvents` to call a new
`useGlobalQueryEvents` (in `state/`) that grabs `useQueryClient()` and performs the
R3 actions. Keep the **relative** `/api/events` URL and the existing `useSSE`
reconnect config unchanged.

**Rationale**: The subscription lifecycle, auth, and relative-URL handling already
work (FR-012/FR-013); only the event *handler* changes — from `globalCache`/
`live-bus` to `QueryClient`.

## R7. Fate of `live-bus` and `globalCache`

**Decision**:
- **`live-bus`**: retired for server state. Its two jobs — signal-refetch and
  connection-gated polling — are subsumed by TanStack Query (observers refetch on
  invalidate; `refetchOnReconnect` + query `refetchInterval` handle fallback).
  Remove `live-bus.ts` and its test once no server-state hook imports it.
- **`globalCache`**: MUST NOT be used for server-owned API data going forward
  (FR-011). Leave the module in place only if a non-API/UI consumer remains;
  otherwise it can be removed in cleanup. The `api-hybrid`/`sdk-adapter`
  `api:*`-cache invalidation for the migrated endpoints becomes redundant for
  freshness — server state is now owned by TanStack Query.

**Rationale**: Two competing caches for the same data is the root cause; the
migration must collapse to one.

## R8. Fallback polling as a query concern

**Decision**: Replace the bespoke `isLiveConnected()`-gated `setInterval` polling
in the hooks with TanStack Query's `refetchInterval`, enabled **only** while data
is transitional (a deployment `installing`/`updating`, or active jobs) **and** as a
safety net. Because events now drive convergence, the interval can be conservative
(e.g. 5s) and is naturally paused by `refetchOnReconnect`/focus behavior.

**Rationale**: Satisfies FR-008 (polling = fallback) with the library's own
mechanism instead of hand-rolled timers; preserves convergence when SSE is down
(SC-005).

**Alternatives considered**: keep manual timers alongside queries (duplicate
mechanism, rejected); no polling at all (fails SC-005 fallback requirement).

## R9. Deletion-while-viewing redirect

**Decision**: The detail page subscribes to knowledge of its own deletion. On
`deployment_deleted` for the viewed id, `useGlobalQueryEvents` removes the detail
query; the `DeploymentDetail` page detects the removal (query returns no
data / a "gone" signal) and navigates to the Deployments list via React Router,
surfacing a transient toast/notice ("<app> was removed"). Aligns with the
2026-07-06 clarification.

**Rationale**: Router-driven redirect is the cleanest, most testable realization of
FR-003; avoids a dead-end page for a nonexistent deployment.

**Open implementation detail (non-blocking)**: exact notice/toast mechanism uses
whatever transient-notification affordance the app already has; if none exists, a
lightweight one is added. Deferred to tasks.

## R10. Testing approach

**Decision**: Unit-test `useGlobalQueryEvents` by constructing a `QueryClient`,
seeding queries, dispatching synthetic `SSEEvent`s, and asserting
`getQueryData`/`getQueryState` (patched / invalidated / removed). Component-test
`DeploymentDetail` by rendering inside a `QueryClientProvider`, seeding the detail
query, simulating a `deployment_update`, and asserting the DOM re-renders the new
status. Replace `live-bus.test.ts`; update `useGlobalEvents.test.ts` to assert
QueryClient effects.

**Rationale**: Directly validates FR-014 / SC-006 at the seam where freshness is
implemented, without needing a live server.

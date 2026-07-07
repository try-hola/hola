# Contract: SSE Event → QueryClient Actions

**File**: `packages/web/src/state/useGlobalQueryEvents.ts` (invoked by
`useGlobalEvents`, mounted once in `AppShell`)

Consumes the existing global `/api/events` stream (relative URL, authenticated,
via `useSSE`) and translates each in-scope `SSEEvent` into imperative
`QueryClient` actions. This module is the single writer that keeps the reactive
cache fresh from platform events. It MUST NOT touch `globalCache` or `live-bus`.

## Interface

```ts
// Given a QueryClient (from useQueryClient()) and an SSEEvent, apply cache actions.
function handleGlobalEvent(qc: QueryClient, event: SSEEvent, opts: {
  onDeploymentDeleted?: (deploymentId: string) => void; // for detail-page redirect
}): void
```

`useGlobalQueryEvents()` wires `handleGlobalEvent` as the `useSSE('/api/events', …)`
callback with `eventTypes: ['job_update','deployment_update','deployment_deleted']`
and the existing reconnect config. It also reports connection state if any consumer
still needs it (fallback polling is otherwise handled by query options).

## Event → actions

### `deployment_update` — `{ deploymentId, status, uptime?, lastUpdated }`
| # | Action |
|---|--------|
| 1 | `qc.setQueryData(queryKeys.deployments.detail(deploymentId), prev => prev ? { ...prev, status, uptime, lastUpdated } : prev)` |
| 2 | `qc.invalidateQueries({ queryKey: queryKeys.deployments.all })` |
| 3 | `qc.invalidateQueries({ queryKey: queryKeys.jobs.all })` |
| 4 | `qc.invalidateQueries({ queryKey: queryKeys.summary })` |

- Action 1 is a **no-op if the detail is not cached** (updater sees `prev === undefined`).
- The `prev` shape is `GetDeploymentResponse`; only the three volatile fields are overwritten.

### `deployment_deleted` — `{ deploymentId }`
| # | Action |
|---|--------|
| 1 | `qc.removeQueries({ queryKey: queryKeys.deployments.detail(deploymentId) })` (also `config`/`history` for that id — covered by `removeQueries({ queryKey: ['deployments', ...], predicate })` or explicit removes) |
| 2 | `qc.invalidateQueries({ queryKey: queryKeys.deployments.all })` |
| 3 | `qc.invalidateQueries({ queryKey: queryKeys.summary })` |
| 4 | `opts.onDeploymentDeleted?.(deploymentId)` — the open `DeploymentDetail` uses this (or observes the removed detail query) to redirect to the list + show a transient "removed" notice |

### `job_update` — `{ jobId, status, progress?, finishedAt? }`
| # | Action |
|---|--------|
| 1 | `qc.invalidateQueries({ queryKey: queryKeys.jobs.all })` |
| 2 | `qc.invalidateQueries({ queryKey: queryKeys.summary })` |

(Optional future optimization: `setQueryData` patch of a cached job list/detail.
Invalidation alone satisfies this slice.)

## Guarantees / rules

- **Idempotent & order-tolerant**: applying the same event twice, or events out of
  order, converges to the latest server state (invalidate-refetch is latest-wins;
  the detail patch only ever writes the newest event's fields).
- **Unmounted safe**: invalidation marks unobserved queries stale without fetching;
  they refetch on next mount (FR-010). `setQueryData` on an absent key is a no-op.
- **No throw escapes**: a handler error for one event MUST NOT break the stream
  subscription (wrap per-event work defensively, mirroring today's `signalLive`).
- **Relative URL preserved**: `/api/events` stays relative (FR-012).
- **Auth preserved**: no change to how `useSSE`/`api` authenticate (FR-013).

## Test contract (FR-014 / SC-006)

- `deployment_update` on a seeded detail query → detail data patched
  (status/uptime/lastUpdated) AND `deployments`/`jobs`/`summary` marked invalidated.
- `deployment_deleted` → detail query removed; `deployments`/`summary` invalidated;
  `onDeploymentDeleted` invoked with the id.
- `job_update` → `jobs`/`summary` invalidated.
- A component reading `queryKeys.deployments.detail(id)` re-renders when a simulated
  `deployment_update` patches that query.
- Two sibling list readers (Deployments + Apps) both refetch on one
  `deployments` family invalidation.

# Phase 1 Data Model: Web UI State Freshness

This feature has no persistent/server data model. The "model" is the **client-side
query cache**: the set of query families, their cached shapes, and how platform
events transition them. Types below already exist in `@hola/shared` unless noted.

## Query Families (cached entities)

| Family | Query key (see contracts/query-keys.md) | Cached shape (`@hola/shared`) | Source call |
|--------|------------------------------------------|-------------------------------|-------------|
| Summary | `['summary']` | `GetSummaryResponse` | `api.summary()` |
| Deployments — list | `['deployments','list',params]` | `GetDeploymentsResponse` | `api.deployments.list(params)` |
| Deployment — detail | `['deployments','detail',id]` | `GetDeploymentResponse` | `api.deployments.byId(id)` |
| Deployment — config | `['deployments','config',id]` | `GetDeploymentConfigResponse` | `api.deployments.config(id)` |
| Deployment — history | `['deployments','history',id,page]` | `GetDeploymentHistoryResponse` | `api.deployments.history(id,{page,limit})` |
| Jobs — list | `['jobs','list',params]` | `GetJobsResponse` | `api.jobs.list(params)` |
| Jobs — detail (future) | `['jobs','detail',id]` | (job item) | — (invalidation-only for now) |

`params` objects are normalized (stable key order) so a given logical query maps to
exactly one cache entry.

## Platform Events (triggers) — from `@hola/shared` `SSEEvent`

| Event type | Payload (`data`) | Meaning |
|------------|------------------|---------|
| `deployment_update` | `{ deploymentId, status: DeploymentStatus, uptime?, lastUpdated }` | A deployment's status/uptime changed |
| `deployment_deleted` | `{ deploymentId }` | A deployment was removed |
| `job_update` | `{ jobId, status: JobStatus, progress?, finishedAt? }` | A job progressed/finished |

Other `SSEEvent` variants (`log`, `system_update`) are **out of scope** and remain
on their existing separate streams.

## State Transitions: Event → Cache Actions

The authoritative mapping the SSE handler (`useGlobalQueryEvents`) implements. Full
detail in [contracts/events.md](./contracts/events.md).

### `deployment_update`
1. `setQueryData(['deployments','detail', deploymentId], prev => prev && { ...prev, status, uptime, lastUpdated })`
   — instant on-page patch when the detail is cached (no-op if absent).
2. `invalidateQueries({ queryKey: ['deployments'] })` — list/detail/config/history converge.
3. `invalidateQueries({ queryKey: ['jobs'] })` — a status change usually rides a lifecycle job.
4. `invalidateQueries({ queryKey: ['summary'] })` — counts.

### `deployment_deleted`
1. `removeQueries({ queryKey: ['deployments','detail', deploymentId] })`
   (and `config`/`history` for that id) — drop the gone record's detail cache.
2. `invalidateQueries({ queryKey: ['deployments'] })` — remove from list views.
3. `invalidateQueries({ queryKey: ['summary'] })` — counts.
4. **Redirect signal**: if the removed id is the one the open `DeploymentDetail` is
   viewing, the page navigates to the list + shows a transient "removed" notice
   (FR-003 / clarification 2026-07-06).

### `job_update`
1. `invalidateQueries({ queryKey: ['jobs'] })` — job tracker / recent jobs.
2. `invalidateQueries({ queryKey: ['summary'] })` — counts.
   (Optional later optimization: `setQueryData` patch of a known job list/detail.)

## Invalidation from Mutations (server-confirmed)

Per FR-007 (server-confirmed, not optimistic), each mutation's `onSuccess`
invalidates the affected families; the visible change comes from the ensuing
refetch and/or the SSE event:

| Mutation | Invalidate on success |
|----------|-----------------------|
| `executeAction` (start/stop/restart) | `['deployments','detail',id]`, `['deployments']`, `['jobs']`, `['summary']` |
| `updateConfiguration` | `['deployments','detail',id]`, `['deployments','config',id]`, `['deployments']`, `['summary']` |
| `upgradeDeployment` (promote) | `['deployments','detail',id]`, `['deployments']`, `['jobs']`, `['summary']` |
| `removeDeployment` (delete) | `removeQueries(['deployments','detail',id])`, invalidate `['deployments']`, `['summary']`; caller navigates away |

## Invariants

- **Single owner**: every server-owned datum above is read only via its query hook;
  no component holds a private long-lived copy that can drift (FR-001, FR-006).
- **Prefix-invalidation correctness**: all deployment sub-queries share the
  `['deployments', …]` prefix so one family invalidation reaches them (config +
  history included — clarification 2026-07-06).
- **No `globalCache` for these families** (FR-011).
- **Idempotent/latest-wins**: repeated or out-of-order events converge to the
  latest server state via invalidate-refetch; the detail patch only overwrites the
  three volatile fields (status/uptime/lastUpdated).

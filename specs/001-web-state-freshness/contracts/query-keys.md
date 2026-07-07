# Contract: Centralized Query Keys

**File**: `packages/web/src/state/queryKeys.ts`

Query keys are the shared vocabulary between query hooks (readers), mutations, and
the SSE handler (writers). They MUST be centralized, stable, and hierarchical so
that a single family invalidation (`['deployments']`) reaches every sub-query
(list, detail, config, history) by array-prefix match.

## Shape

```ts
export const queryKeys = {
  summary: ['summary'] as const,

  deployments: {
    all: ['deployments'] as const,
    list: (params: GetDeploymentsRequest) =>
      ['deployments', 'list', normalizeParams(params)] as const,
    detail: (id: string) => ['deployments', 'detail', id] as const,
    config: (id: string) => ['deployments', 'config', id] as const,
    history: (id: string, page: number) =>
      ['deployments', 'history', id, page] as const,
  },

  jobs: {
    all: ['jobs'] as const,
    list: (params: JobsListParams) => ['jobs', 'list', normalizeParams(params)] as const,
    detail: (id: string) => ['jobs', 'detail', id] as const,
  },
} as const;
```

## Rules

1. **Prefix hierarchy**: every deployment sub-key begins with `'deployments'`; every
   job sub-key begins with `'jobs'`. `invalidateQueries({ queryKey: queryKeys.deployments.all })`
   MUST invalidate list, detail, config, and history entries.
2. **Param normalization**: `list(params)` MUST produce a stable key for logically
   equal params regardless of key order (`normalizeParams` sorts keys / drops
   `undefined`) so one logical query = one cache entry. This replaces the current
   `JSON.stringify(params)` cache-key strings.
3. **`as const`**: keys are readonly tuples so TypeScript preserves literal types
   and mismatched keys are caught at compile time.
4. **Single source**: hooks, mutations, and `useGlobalQueryEvents` MUST import keys
   from this module — no inline `['deployments', …]` literals elsewhere.
5. **Stability**: key structure is part of the contract; changing it is a breaking
   change requiring all readers/writers to update together.

## Consumers

- Readers: `useDeploymentsApi`, `useDeploymentDetailApi`, `useDeploymentConfigApi`,
  `useDeploymentHistoryApi`, `useJobsApi`/`useDeploymentJobs`/`useActiveJobs`,
  `useWorkingApi`.
- Writers: the four deployment mutations (see contracts/hooks.md) and
  `useGlobalQueryEvents` (see contracts/events.md).

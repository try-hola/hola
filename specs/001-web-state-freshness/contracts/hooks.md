# Contract: Preserved Public Hook Shapes

To limit page churn, the migrated hooks keep their **names, import paths, and
return shapes**; only their internals move from local-state/`globalCache` to
`useQuery`/`useMutation`. Consumer pages (`Dashboard`, `Apps`, `Deployments`,
`DeploymentDetail`, `JobTracker`/`JobTrackerNew`) should compile and behave
unchanged, aside from the new freshness behavior.

The shared `{ data, loading, error, refetch }` shape maps onto TanStack Query as:
`loading ← isPending/isLoading`, `error ← error?.message ?? null`,
`data ← data ?? null`, `refetch ← () => void refetch()`.

## `useDeploymentsApi(params)` — `hooks/useDeploymentsApi.ts`
- Uses `useQuery({ queryKey: queryKeys.deployments.list(params), queryFn: () => api.deployments.list(params) })`.
- Returns `{ data: GetDeploymentsResponse | null, loading, error, refetch }`.
- Fallback poll: `refetchInterval` enabled only when the list has a transitional
  item (`installing`/`updating`); else off (FR-008).

## `useDeploymentDetailApi(id)` — `hooks/useDeploymentDetailApi.ts`
- Query: `queryKeys.deployments.detail(id)` → `api.deployments.byId(id)`.
- Returns existing surface: `{ data, loading, error, refetch, updateConfiguration, executeAction, upgradeDeployment, removeDeployment }`.
- Mutations use `useMutation`; each `onSuccess` invalidates per data-model.md
  (server-confirmed — no optimistic final state; a pending affordance is allowed).
- `removeDeployment` removes the detail query and invalidates the list/summary; the
  caller navigates away (existing behavior).
- Fallback poll: `refetchInterval` only while `status` is `installing`/`updating`.

## `useDeploymentConfigApi(id)` & `useDeploymentHistoryApi(id, page)` — same file
- Queries: `queryKeys.deployments.config(id)` / `queryKeys.deployments.history(id, page)`.
- In-scope for this slice (clarification 2026-07-06): they belong to the
  `deployments` family and are refreshed by family invalidation on relevant
  events/mutations.
- Return `{ data, loading, error, refetch }` as today.

## `useJobsApi(params)` (+ `useDeploymentJobs`, `useActiveJobs`) — `hooks/useJobsApi.ts`
- Query: `queryKeys.jobs.list(params)` → `api.jobs.list(params)`.
- Returns `{ data: GetJobsResponse | null, loading, error, refetch }`.
- Fallback poll via `refetchInterval` while `autoRefresh` and active jobs exist;
  events are primary.

## `useWorkingApi()` (dashboard summary) — `hooks/useWorkingApi.ts`
- Query: `queryKeys.summary` → `api.summary()`.
- Returns `{ data: GetSummaryResponse | null, loading, error, refetch }`.

## `useGlobalEvents()` — `hooks/useGlobalEvents.ts`
- No return value (mounted for effect in `AppShell`).
- Rewritten to delegate to `useGlobalQueryEvents()`; MUST NOT import
  `globalCache` or `live-bus`.

## App root — `main.tsx`
- Wrap the tree in `<QueryClientProvider client={queryClient}>` using the
  `state/queryClient.ts` factory, outside the router, inside auth context.

## Non-goals (this slice)
- Catalog, backups, notifications, settings, system-status hooks are unchanged.
- No change to `@hola/sdk`, `@hola/shared`, or the server.

# Quickstart: Validate Web UI State Freshness

How to prove the feature works end-to-end. Assumes the repo is set up (`bun install`).

## Prerequisites

- `@tanstack/react-query` added to `packages/web` (`bun add @tanstack/react-query --cwd packages/web`).
- App wrapped in `<QueryClientProvider>`; hooks migrated per
  [contracts/hooks.md](./contracts/hooks.md); `useGlobalQueryEvents` wired per
  [contracts/events.md](./contracts/events.md).

## 1. Automated tests (fast path — FR-014 / SC-006)

```bash
bun --cwd packages/web test
```

Expected: the freshness suite passes, including —
- `state/useGlobalQueryEvents.test.ts` — event → patch/invalidate/remove
  (deployment_update patches detail + invalidates families; deployment_deleted
  removes detail + invalidates; job_update invalidates jobs+summary).
- `hooks/useGlobalEvents.test.ts` (updated) — asserts QueryClient effects, no
  `globalCache`/`live-bus`.
- `pages/DeploymentDetail.test.tsx` — the detail page re-renders the new status
  when a simulated `deployment_update` patches its query.
- Sibling-view test — Deployments + Apps both refetch on one `deployments`
  family invalidation.
- `utils/live-bus.test.ts` removed/replaced.

Then the full gate (Constitution VII):

```bash
bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build
```

(Re-run `typecheck` after `lint` — CI has caught post-lint-fix regressions.)

## 2. Manual cross-view freshness (SC-001…SC-004)

Run the stack (dev): `bun --cwd packages/web dev` against a running server, or use
the disposable-VM flow (`vm-e2e` skill) against a real dashboard.

**Status propagation (User Story 1 / SC-001)**
1. Open the app in two tabs: Tab A on a Deployment detail page (status
   *installing*), Tab B on the Apps page.
2. Trigger/allow the deployment to reach *running* (the server emits
   `deployment_update`).
3. Expect: within ~3s, Tab A's detail badge flips to *running* and Tab B's Apps
   card updates — **no refresh**. The Deployments list and dashboard summary also
   reflect it.

**Deletion (User Story 2 / SC-002 + redirect clarification)**
1. Tab A on the detail page for app X; Tab B on Deployments list.
2. Remove app X (from Tab B, or via API/another client → `deployment_deleted`).
3. Expect: app X disappears from all list views and summary counts drop within
   ~3s; **Tab A auto-redirects to the list with a transient "app X was removed"
   notice** (not a dead page).

**Jobs + summary (User Story 3)**
1. Open the job tracker and dashboard.
2. Start an install/upgrade; watch jobs progress and summary counts update live.

**Polling as fallback (User Story 4 / SC-005)**
1. In devtools, block/kill the `/api/events` connection (offline the EventSource).
2. Make a change server-side.
3. Expect: views still converge to current data on their next fetch (focus a tab,
   or wait for the transitional `refetchInterval`), demonstrating polling is a
   safety net rather than the primary mechanism.

## 3. Regression checks

- No new direct `globalCache` reads/writes for deployments/jobs/summary data
  (FR-011 / SC-007) — grep the migrated hooks for `globalCache` and confirm none
  remain for these families.
- `/api/events` still a relative URL (FR-012).
- Auth still required for the stream and API calls (FR-013).

## Success = 

All automated tests green, the four manual scenarios pass with **zero browser
refreshes** for in-scope data, and the fallback scenario still reconciles.

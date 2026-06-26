# Finding: `hola uninstall` leaves an `error`-state tombstone

## Symptom

After `hola uninstall` (server `DeploymentService.deleteDeployment`) the command
appears to succeed and the containers/data are gone, but a leftover deployment
record lingers in `error` state. In e2e, `hola deployments` shows a stuck `error`
entry for the just-deleted app.

## Root cause: a teardown-vs-storage-removal race

`deleteDeployment` (`packages/server/src/services/core/deployment.ts`) tore down
containers **asynchronously** and then removed storage **immediately**:

1. It called `executeAction(deploymentId, { action: 'stop' })`, which only
   **enqueues** a lifecycle job and returns — it does not wait for the job to run.
2. It then deprovisioned auth, deleted the in-memory record, and called
   `removeStorage(deploymentId)`, which deletes
   `/data/deployments/<id>/runtime/` (including `docker-compose.yml`).

Steps 1 and 2 race. In practice `removeStorage` wins, so when the still-pending
`stop` job finally runs `runLifecycleJob`, its `docker compose down` executes
against an already-deleted runtime dir and fails (`no configuration file
provided` / `docker-compose.yml not found`).

For a `stop` action the executor treats a `composeDown` failure as fatal
(`if (!res.success && action !== 'delete') throw`). The `catch` in
`runLifecycleJob` then sets `deployment.status = 'error'` and **re-persists** the
record — resurrecting the deployment that `deleteDeployment` had just removed.
That re-persisted row is the `error` tombstone.

## Fix

Tear the containers down **synchronously, in-line, before** removing storage, and
never route the delete-time teardown through a fire-and-forget job that can
re-persist the record.

- Added a protected hook `teardownContainers(deploymentId)` on the in-memory base
  service (no-op default).
- `deleteDeployment` now `await`s `teardownContainers(deploymentId)` instead of
  enqueuing a `stop` job. The teardown completes before `removeStorage`, so
  `docker compose down` always sees the compose file.
- `RealDeploymentService` overrides `teardownContainers` to call
  `dockerService.composeDown(runtimeDir, projectName)` directly. A `composeDown`
  failure is logged and **tolerated** (deletion always proceeds) and — crucially —
  this path never touches/persists the deployment record, so it cannot leave an
  `error` tombstone.

Net effect: the teardown reliably runs against the live runtime dir, deletion is
unconditional, and no late job can resurrect the deleted deployment.

## Regression test

`packages/server/src/__tests__/deployments/lifecycle.test.ts` →
`delete runs compose-down before removing the runtime dir, leaving no error
tombstone`.

It installs a deployment, then deletes it with a `MockDockerService` whose
`composeDown` mirrors real `docker compose down` (fails when the compose file is
gone) plus a small delay that makes the old ordering deterministically lose the
race. It asserts:

- `composeDown` ran exactly once and the compose file still existed at call time
  (teardown happened before storage removal);
- the runtime dir is gone and the deployment is fully removed (404);
- no `error` tombstone remains — in-memory, after rehydrating a fresh service from
  the same data root, and no failed teardown job lingers for the deployment.

Verified: the test fails 3/3 against the pre-fix code and passes 3/3 with the fix;
the full server suite (350 tests) stays green.

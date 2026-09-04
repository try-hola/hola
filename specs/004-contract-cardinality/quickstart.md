# Quickstart: validating Contract Cardinality and the Container-Logs Contract

**Feature**: `004-contract-cardinality` · Branch `004-contract-cardinality`

## Prerequisites

```bash
bun install
bun run typecheck && bun run lint && bun run build
```

## 1. Hermetic suites (no Docker)

```bash
# server: vocabulary, coercion, broker, guard, rollup, mounts, defaults, validator, proxy, tokens
bun --cwd packages/server test \
  src/__tests__/bundles/contracts.test.ts \
  src/__tests__/bundles/manifest-backup.test.ts \
  src/__tests__/deployments/contract-broker.test.ts \
  src/__tests__/deployments/contract-provider-guard.test.ts \
  src/__tests__/deployments/contract-rollup.test.ts \
  src/__tests__/routing/compose-mounts.test.ts \
  src/__tests__/routing/compose-defaults.test.ts \
  src/__tests__/validation/compose-validate.test.ts \
  src/__tests__/lib/docker-proxy.test.ts \
  src/__tests__/auth/contract-tokens.test.ts

# web
cd packages/web && npx vitest run src/__tests__/utils/backup-coverage.test.ts src/__tests__/pages

# cli
cd packages/cli && npx vitest run src/__tests__/install.test.ts

# everything
bun run test
```

Expected: green. The suite must include, by name, a test whose fixture is the postiz shape (accepts `backup@1`, one participation on `postiz-postgres`, two `postgres:*` services) asserting `coverage.state === 'partial'`, `targeted 1`, `recognised 2`.

## 2. Broker end-to-end against the docker double

`contract-broker.test.ts` drives `RealDeploymentService` with an exec-recording `MockDockerService`. Confirm these scenarios pass and read as described:

| Scenario | Expected |
|---|---|
| two participations, both ok | pre-hooks `app-db` then `temporal-db`; finalize results carry both `participationId`s |
| second pre-hook fails | job `failed`; error `…1 of 2 participation(s): <id>/temporal-db`; post-hooks ran for `app-db` and `temporal-db`; a third participation never started |
| singular manifest | one participation `default`; identical exec sequence to the pre-feature test |
| two apps | app with the lower deployment id runs first |

## 3. Provider guard

`contract-provider-guard.test.ts`: install A providing `backup@1` (with `grants`), then install B providing `backup@1` → `ConflictError` `PROVIDER_EXISTS` naming A; remove A; B succeeds. B providing `container-logs@1` beside A is allowed (different contract).

## 4. Container-logs grant on a materialised compose

Materialise a provider deployment with `grantedContracts: ['container-logs@1']` and assert the runtime compose per [contracts/compose.md](./contracts/compose.md): `hola-docker-proxy` service present with the ro socket volume and no `hola` network; `DOCKER_HOST` on every other service; `sh.hola.*` labels everywhere. Materialise again without the grant → none of it. Validator: `/var/run/docker.sock`, `/var/lib/docker/containers`, `/var/lib/docker`, `/var/run` bind sources → `VOLUME_NOT_UNDER_APP_DATA`; a user `hola-docker-proxy` service → `RESERVED_SERVICE_NAME`.

## 5. Proxy allowlist and redaction

`docker-proxy.test.ts` starts a fake Docker API on a temp unix socket and the proxy in front of it:

```
GET /containers/json            → 200, body unchanged
GET /v1.45/containers/abc/json  → 200, body has Config.Tty and Config.Labels, no Config.Env, no HostConfig, no Mounts
GET /containers/abc/logs        → 200, streamed bytes identical
GET /containers/abc/archive     → 403
POST /containers/abc/exec       → 403
GET /images/json                → 403
```

## 6. Dashboard

```bash
cd packages/web && npx vitest run src/__tests__/pages/Backups.coverage.test.tsx src/__tests__/pages/InstallWizard.grants.test.tsx
```

Backups page with a postiz-shaped acceptor shows **Partially covered · 1 of 2** and the summary excludes it from "covered". Two providers → the conflict warning. Wizard for a manifest providing `container-logs@1` shows the new consent row and blocks Next until acknowledged.

## 7. Optional live check (disposable VM, needs Proxmox credentials)

```bash
bin/vm-create && bin/vm-wait-ssh
# bootstrap per the vm-e2e skill, then on the VM:
hola install postiz              # coverage on the Backups page reads Partially covered · 1 of 2
docker inspect -f '{{json .Config.Labels}}' $(docker ps -q --filter label=sh.hola.app=postiz) | head -1
bin/vm-destroy --yes
```

No collector bundle exists in the catalog yet (try-hola/apps#30); the container-logs path is verified by the hermetic materialise and proxy tests until it does.

## 8. Docs and follow-ups

- `docs/adr/0004-capability-contracts.md` has §9–§13 and status "Accepted (amended 2026-09-04)".
- `docs/adr/0002-cross-app-integration.md` notes `container-logs` is a contract.
- Two `try-hola/apps` issues exist and try-hola/apps#30 has the pointer comment; numbers recorded in `tasks.md`.

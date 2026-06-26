# Root cause: `hola restart` leaves a deployment in `error`

## Symptom

`hola restart <deploymentId>` reproducibly drives a deployment into `error` state
with no running container. Server stdout showed a STOP completing ("Compose
project stopped successfully") but no subsequent "Starting compose project", so it
looked like the start half of restart never ran.

## What actually happens

`restart` is **not** a down-then-up. `executeAction('restart')`
(`packages/server/src/services/core/deployment.ts`) enqueues a single `start`-type
job with `payload.action = 'restart'`. In `runLifecycleJob` the `action === 'restart'`
branch (deployment.ts:1236) does, in order:

1. `provisionAuth(deployment)` — re-provision the app's Authentik auth artifacts
2. `materializeCompose(...)` — write the runtime `docker-compose.yml`
3. `composeUp(...)` — `docker compose up -d` (recreate)

The STOP the tester saw came from a **separate** `stop` action, not from restart.
The restart itself never reached `composeUp` because **step 1 threw**.

## Evidence (live VM 103, server `ghcr.io/try-hola/server:0.6.26`)

Job record + job logs for the failed restart (`GET /api/jobs/<id>` and `/logs`):

```
{"id":"job_1782489827615_c38fneygqxo","type":"start","status":"failed","progress":10,"deploymentId":"uptime-kuma-ff425754"}

"Job started"
"Starting deployment action: restart"
"Deployment action 'restart' failed: Authentik PATCH /api/v3/providers/proxy/2/ failed: 400"
"Job failed"
```

The failure is at the **provisionAuth** step (progress never passes 10), before any
compose work — which is why server stdout shows zero compose activity for the
restart job and the container stays gone. The error is logged at the *job* level
(LoggingService), not in the server's stdout stream, which is why it was invisible
in `docker compose logs server`.

uptime-kuma uses `forward-auth`, so on every (re)provision the provisioner takes
the idempotent reuse path in `provisionForwardAuth`
(`packages/server/src/services/core/provisioner.ts`):

```ts
await this.api('PATCH', `/api/v3/providers/proxy/${existing.providerPk}/`,
  { external_host: externalHost });   // <-- 400
```

Read-only GET of that provider on the VM confirms the trigger:

```json
{ "pk": 2, "name": "hola-uptime-kuma-uptime-k", "mode": "forward_single",
  "external_host": "https://uptime-kuma.192.168.1.15.sslip.io", "internal_host": "" }
```

Authentik's `ProxyProviderSerializer.validate()` validates against
`attrs.get("mode", ProxyMode.PROXY)`. A **partial** update (PATCH) that omits
`mode` is therefore validated as `PROXY` mode, and PROXY mode requires a non-empty
`internal_host`. A forward-auth provider correctly has `internal_host: ""`, so the
mode-less PATCH is rejected:

```
HTTP 400 {"internal_host": ["Internal host cannot be empty when forward auth is disabled."]}
```

The create call (`POST /api/v3/providers/proxy/`) sends `mode: 'forward_single'`
and succeeds — install works. Only the reuse PATCH omits `mode`, so the failure
surfaces on the first restart/redeploy of any forward-auth app. (native-oidc apps
PATCH `/providers/oauth2/` with a different serializer and are unaffected.)

## Fix

Resend `mode: 'forward_single'` on the reuse PATCH so Authentik validates the
update in forward-auth mode (matching the create payload):

```ts
await this.api('PATCH', `/api/v3/providers/proxy/${existing.providerPk}/`, {
  mode: 'forward_single',
  external_host: externalHost,
});
```

With provisionAuth succeeding, restart proceeds to `composeUp` and the deployment
returns to `running`.

Regression test added in `authentik-contract.test.ts`: the forward-auth reuse path
PATCHes with `mode: 'forward_single'` and the mock fetch returns 400 if `mode` is
absent, locking in the contract.

## Deterministic validation (real Authentik, local Docker)

The unit contract test mocks `fetch`, so it can't prove the real Authentik
serializer accepts the payload. An integration test in
`authentik-provision.it.ts` (`forward-auth reuse (restart/redeploy)`) drives the
exact reuse path against a **real** Authentik booted in Docker: provision a
forward-auth provider, then re-provision with the saved ref (the call
`runLifecycleJob`'s restart branch makes via `provisionAuth`) and a changed host.

Red/green, ~65s per run (`bun test:integration`, gated on Docker):

- **Without the fix** the reuse re-provision fails on
  `PATCH /api/v3/providers/proxy/<pk>/ failed: 400` — the live bug.
- **With the fix** it reuses the provider in place, the provider keeps
  `internal_host: ""` (still forward-auth, not silently flipped to proxy), and the
  `external_host` is refreshed.

This confirms the fix is complete at the provisioner layer: the reuse PATCH was the
only failing step. `completeAuthWiring` (the step after `composeUp`) does no
Authentik work for a forward-auth app — `runPostDeploySetup` is a no-op without an
`oidc.setup` block, and `activateRoute` only re-emits the Traefik file config — so
there is no further provisioning failure on the restart path. (A real-VM e2e of the
full `install → restart → running` loop for a forward-auth app is covered by the
catalog/lifecycle test harness.)

The integration harness's `waitForApi` was also hardened to wait for the default
`default-provider-authorization-implicit-consent` flow blueprint (not just the API
socket), removing a cold-boot race where a fast first test 404'd before Authentik
finished applying its default flows.

## Secondary observation (benign)

Uninstalling a *failed* deployment logged `docker-compose.yml not found at
.../runtime/docker-compose.yml` during its stop step. `composeDown`/`composeUp`
guard with `existsSync(composeFile)` and throw if absent (docker.ts:231). For the
`delete` action this is tolerated — `runLifecycleJob` only rethrows a down failure
when `action !== 'delete'` (deployment.ts:1233), and `deleteDeployment` additionally
wraps the stop in try/catch. So it is a warning, not a blocker, and is out of scope
for this fix.

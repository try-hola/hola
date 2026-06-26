# Findings: forward-auth apps fail messily under `HOLA_AUTH_MODE=none`

## Symptom

With the platform running `HOLA_AUTH_MODE=none` (no Authentik backend), installing
an app whose manifest declares `auth.mode: forward-auth` (or `native-ldap`) failed
late and left a tombstone. Discovered via e2e: `uptime-kuma`
(`auth.mode: forward-auth`) could not be installed under mode `none`.

## Root cause

The deploy lifecycle is async. `createFromDraft` creates the deployment record and
enqueues a `start` job; the job later runs `runLifecycleJob`, which calls
`provisionAuth(...)` **before** `materializeCompose`/`composeUp`.

Under `HOLA_AUTH_MODE=none` the active provisioner is `NoneProvisionerService`,
whose `provision()` intentionally **throws** for modes that need a real auth
backend (`forward-auth`, `native-ldap`):

> `App "<app>" requires auth mode "<mode>", which needs an auth backend. Set HOLA_AUTH_MODE=authentik to install it.`

That rejection policy is correct — a forward-auth route would be gated by a
non-existent outpost, so shipping it ungated would expose an app meant to be
SSO-gated. The bug was purely about **timing**: the rejection happened inside the
deploy job, *after* a deployment record already existed. So `composeUp` never ran
and the deployment was left stuck in `error` state (a confusing tombstone) instead
of the user getting the clear error immediately at install time.

## Fix

Preflight the app's declared auth requirement against the active auth backend
**before** any deployment record/job is created, reusing the exact same capability
check and error message the None backend already uses (single-sourced — no
divergent wording). The policy is unchanged: these apps are still rejected under
mode `none`; they just fail up front now.

### `packages/server/src/services/core/provisioner.ts`
- New `ProvisionerService.assertCanProvisionAuthMode(mode, appName)` — a
  synchronous, side-effect-free precheck. Backends with a real provider
  (`RealAuthentikProvisionerService`, `MockProvisionerService`) implement it as a
  no-op; `NoneProvisionerService` throws for `forward-auth`/`native-ldap`.
- Extracted the rejection into a single module helper
  `assertModeRunnableWithoutBackend(mode, appName)` (backed by
  `MODES_REQUIRING_BACKEND`). Both `NoneProvisionerService.assertCanProvisionAuthMode`
  and its `provision()` (kept as defense-in-depth) call it, so the error wording
  lives in exactly one place.

### `packages/server/src/services/core/deployment.ts`
- New protected hook `assertAuthProvisionable(auth, appName)` on the base
  `InMemoryDeploymentService` (default no-op). `RealDeploymentService` overrides it
  to call `this.provisioner.assertCanProvisionAuthMode(...)` for the declared mode
  **and** for a forward-auth fallback when `auth.fallback === 'forward-auth'` —
  mirroring exactly which modes `provisionAuth` would actually provision.
- Both `createFromDraft` (install) and `promote` (new release) call the hook right
  after building the release from the draft and **before** creating any deployment
  state, routing activation, or job. A rejection therefore throws straight back to
  the caller (the CLI "Preflight…" step) with the clear message and leaves no
  `error`-state deployment behind.

## Regression test

`packages/server/src/__tests__/deployments/auth-provisioning.test.ts`:
- `forward-auth under HOLA_AUTH_MODE=none is rejected up front, creating no
  error-state deployment` — installs a `forward-auth` app with a real
  `NoneProvisionerService`, asserts `createFromDraft` rejects with the
  "...needs an auth backend. Set HOLA_AUTH_MODE=authentik to install it." message,
  and that no deployment and no job were created.
- `native-oidc under HOLA_AUTH_MODE=none installs fine` — the contrast case proves
  the preflight does **not** over-reject modes that can run without a backend.

## Validation

`bun --cwd packages/server typecheck`, `bun run lint`, and the full server suite
(`bun --cwd packages/server test`, 351 pass) are all green. Not validated
end-to-end (no VM); this is a server-unit-level fix.

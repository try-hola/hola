# Research: Opt-in Private Tailscale Ingress

Two read-only sweeps on 2026-11-20: the Hola code at `main@7b2e698`, and the Tailscale documentation, public OpenAPI schema and `tailscale/tailscale` source. Nothing in the Tailscale half was run. "Source" below means read in code, not stated in docs. Every item marked **UNVERIFIED** is a validation task (V1 to V10 at the end), not an assumption the build may lean on silently.

## R1. Companion runs `tailscaled` directly; Hola drives it by exec

**Decision**: The companion's command is `tailscaled --tun=userspace-networking --statedir=/var/lib/tailscale --socket=/tmp/tailscaled.sock`. Hola signs it in and configures the Service imperatively, with `docker compose exec`, after the stack is up.

**Why**: The image's default entrypoint (`containerboot`) is built for declarative use and gets in the way here:

- It re-runs `tailscale up --authkey` on every boot unless `TS_AUTH_ONCE=true`, which needs the credential in the container's environment for the container's whole life. That is incompatible with "the credential is deleted once joined".
- Declarative Services in `TS_SERVE_CONFIG` exist in source only, with no official example. The service's web key needs the literal tailnet suffix, which is not known until after sign-in. A variable-shadowing bug in `watchServeConfigChanges` (source, v1.104.7) makes first-boot advertisement depend on a later, unrelated notification.
- It resets the serve configuration to empty at startup and sleeps 20 seconds on every advertise or un-advertise.

The documented imperative commands do everything needed, and both the serve configuration and the advertise preference persist in the state directory, so a restart of the container (host reboot, `restartUntouchedServices`) resumes with no Hola involvement. **UNVERIFIED** (V1): that a bare `tailscaled` in the official image resumes a persisted Service after restart. Because it is unverified, the after-up hook does not rely on it: it re-applies the (idempotent) serve configuration on every lifecycle job, the V1 fallback adopted pre-emptively in code review rather than left for the validation to trigger. The sign-in itself is not repeated; that still rests on the persisted state.

**Rejected**: containerboot with `TS_AUTHKEY` in the environment (credential at rest in `docker inspect`); a Hola-built image (a second image to build, sign and patch).

## R2. Tailscale Services facts the design depends on

| Fact | Status |
|---|---|
| A Service host must be a tagged device; the CLI refuses otherwise | Documented and source |
| Minimum client 1.86; remote (non-localhost) upstream handling present from 1.92 | Documented / source |
| Generally available since 2026-02-19, on all plans | Documented (plan limits read through a summary; confirm before quoting) |
| `tailscale serve --service=svc:NAME --https=443 http://host:port`; `--tcp=PORT tcp://host:port` | Documented; non-localhost target needs a scheme (source) |
| The remote-target check passes in userspace mode | Source. **UNVERIFIED** end to end (V2) |
| A Service is defined in the admin console or `PUT /tailnet/{t}/services/{name}` (scope `services`) | Documented |
| What happens when a host advertises an undefined Service | **Not documented** (V3) |
| Each host needs approval unless `autoApprovers.services` covers it | Documented |
| "Advertised but not approved" is visible on the host as the Service missing from `.Self.CapMap["service-host"]` | Source and one doc line. Exact JSON shape **UNVERIFIED** (V4) |
| Grant: `{"src":["tag:x"],"dst":["svc:name"],"ip":["tcp:443"]}` | Documented |
| A `svc:` grant gives no reach to the host device's own address | Implied by the policy-test docs. **UNVERIFIED** (V5) |
| Service name is `<name>.<tailnet>.ts.net`; certificate issued automatically when tailnet HTTPS is on | Documented. Whether it issues only after approval is **UNVERIFIED** (V6) |
| The proxy preserves the original `Host`, adds `X-Forwarded-*`, strips and re-adds identity headers, which are empty for tagged callers | Source and documented |
| WebSocket, SSE and long requests through the proxy | Standard Go reverse proxy, no response timeout set. **UNVERIFIED** (V7) |
| `tailscale logout` on a non-ephemeral device expires it; the record remains | Documented |
| `tailscale serve drain svc:x`, then `clear svc:x` | Documented, in that order |
| OAuth client secret as an auth key: `<secret>?ephemeral=false&preauthorized=true` with `--advertise-tags`; scope `auth_keys` | Documented |
| Userspace mode with `cap_drop: ALL`, read-only root, tmpfs `/tmp` | Plausible from source. **UNVERIFIED** (V8) |
| Latest stable image `tailscale/tailscale:v1.104.7` | Docker Hub / GitHub release 2026-11-12 |

## R3. Credential handling

**Decision**: The credential is written once to `deployments/<id>/tailscale/credential` (mode 0600) on the server's own data volume, which no app container can mount. In the lifecycle job, after the stack is up and only if the companion reports `NeedsLogin`, Hola pipes it over stdin into a file on the companion's tmpfs, runs `tailscale up --auth-key=file:/tmp/hola-authkey --advertise-tags=<tag> --hostname=<name>`, and removes the tmpfs file. Once the companion reports `Running`, the server-side file is deleted.

It never enters: the rendered compose, `runtime/.env`, a job payload (payloads are stored in SQLite, `jobs.ts:493`), an exec argument list, an error message (4xx messages are logged, `error-mapping.ts:247`), or exec output logging (a new `quiet` exec option; `composeExec` logs up to 1000 characters today, `docker.ts:546`).

An OAuth client secret (`tskey-client-…`) gets `?ephemeral=false&preauthorized=true` appended. An auth key (`tskey-auth-…`) is used as given; if it is not pre-tagged the `--advertise-tags` flag still applies.

**Rejected**: environment injection (visible in `docker inspect` until the container is recreated); keeping the credential for automatic re-enrolment (a reusable secret at rest, against the prompt).

## R4. Where the tailnet identity lives

**Decision**: A project-scoped named volume, `hola-ts-state`, declared by the injection and mounted at `/var/lib/tailscale`.

| Option | Problem |
|---|---|
| Under the app's data root | Captured by pre-upgrade snapshots and restore-on-install; copied to a restored install. Violates FR-022. |
| `<apps-root>/.hola/<id>/` | Outside snapshots, but inside what a consented `backup@1` provider mounts read-only (`deployment.ts:2819`). A backup would hold a device identity. |
| The server's data volume | Not a host path, so it cannot be bind-mounted into an app's container. |
| A new host root with a new identity mount | Works, but changes the production compose stack and `install.sh` for every host, opted in or not. |
| **Named volume** | Passes the deploy-time gate (it checks bind mounts only, `compose-resolved-guard.ts:76-113`). Not in any backup or snapshot. Survives `compose down`, which is what stop/start needs. |

Cost: `compose down` never removes it, and the server has no volume wrapper. So `DockerService` gains `removeVolume` (Real and Mock), called on disable, uninstall and force removal.

## R5. Network isolation

**Decision**: Two networks the injection declares, both project-scoped:

- `hola-ts-backend`, `internal: true`. Members: the companion and the chosen backend only. The backend gets the alias `hola-ts-backend` there, and that fixed alias is the only upstream name Hola ever writes.
- `hola-ts-egress`, a plain bridge. Member: the companion only. It exists so the companion can reach the Tailscale coordination and relay servers.

The companion joins neither the project's `default` network (where the app's database sits) nor `hola`. `sidecarNetworks()` (`compose-mounts.ts:71-94`), which the log-proxy sidecar uses to join every app network, is deliberately not reused.

When the backend declared no networks, attaching it to `hola-ts-backend` must also add `default: {}`, the same correction `attachToHolaNetwork` makes (`compose-network.ts:75-104`), or it would silently leave the project network.

A backend with any `network_mode` is refused (`TAILSCALE_BACKEND_UNSUPPORTED`). The validator permits `network_mode: service:<name>` (`compose-validate.ts:456-466`), and a service in another's network namespace cannot be attached to a network of its own.

**UNVERIFIED** against real Docker until the integration test (T019) runs: that the companion cannot open a connection to a non-backend service of its own project, or to a container of another project.

## R6. Injection point and order

`materializeCompose` (`deployment.ts:2614-2922`) adds platform pieces after validation, then runs the containment gate last. Every existing helper walks all services and skips only `hola-docker-proxy`: contract environment (`compose-mounts.ts:198`), `DOCKER_HOST` (`:120`), the writable restore-staging mount (`:261`), and contract `hola` membership (`compose-network.ts:124-151`).

**Decision**: The companion is injected **after all of them**, immediately before the runtime compose is written (`:2863`). Being last is what keeps it from receiving a contract token, the Docker proxy address, the staging mount or `hola` membership, with no skip list to keep in sync. A test asserts the companion carries none of those, so a future helper added after it fails a test.

`applyPlatformDefaults` has already run by then, so the companion sets its own restart policy, logging, hardening and `sh.hola.*` labels, as the log proxy does.

`hola-tailscale` is added to `RESERVED_SERVICE_NAMES` (`compose-validate.ts:77`), and the two network names and the volume name are refused as app-declared names in the same place, so a bundle cannot pre-declare any of them.

## R7. Applying a change, and removing the companion

There is no "redeploy" action; a configuration change calls `executeAction('restart')` (`deployment.ts:3648`), which re-materializes, runs `up -d`, then restarts every service `up` left untouched.

**Decision**: Private-ingress changes reuse that restart job, with two hooks in `runLifecycleJob`:

- **before up** — if the setting is disabled with removal pending and the companion is running: `serve drain`, `serve clear`, `logout` (each best effort, bounded), then `compose rm -sf hola-tailscale`. This is needed because `up -d` has no `--remove-orphans` (`docker.ts:353`); a companion dropped from the file would keep running.
- **after up** — enabled: sign in if needed, apply the serve configuration if it differs from what was last applied, wait up to 60 seconds for `Running`, delete the credential. Disabled with removal pending: remove the state volume and the two networks, then clear the pending flag.

Differences from the existing configuration path, each required by the spec:

- The endpoint calls `assertNotBusy` (`deployment.ts:1239`); the existing PATCH path does not.
- On a stopped app nothing is enqueued. Enable only saves. Disable runs the local cleanup directly under `runExclusive`; the containers are already gone, so the device cannot be signed out and the response says so.

## R8. Default backend port

`manifest.ingress.port` is typed (`catalog.ts:658`) and never read. The normal route's port is `release.ports[0].container` (`deployment.ts:6095-6101`). The default backend is `ingressService` (falling back to the app name, as `:2638` does) on that port. If the release declares no port, the operator must give one.

## R9. Image pin

The only precedent for a platform sidecar image falls back to `:latest` (`deployment.ts:2842`). There is no pinned-image module.

**Decision**: A new `platform-images.ts` exports the companion image as an exact `tag@sha256:digest`, overridable by `HOLA_TAILSCALE_IMAGE` for hosts with a registry mirror. An override without a tag or digest is refused. A unit test fails if the constant is not digest-pinned.

**Resolved (T001, 2026-11-20)**: `tailscale/tailscale:v1.104.7` is still the newest stable tag on Docker Hub. Multi-arch index digest `sha256:72c1e19e0aedca96b8533bbb0b4368564410ff20b17e53b804eb6c1f04a31be4` (via `docker buildx imagetools inspect`). The image contains `/usr/local/bin/tailscaled` and `tailscale`, and ships `/usr/bin/nc` (used by the integration test for TCP probes). Dependabot does not see image references in TypeScript, so keeping the pin fresh is a filed follow-up issue, not solved here.

**Updated (#592)**: The pin now lives in `packages/server/platform-images/tailscale/Dockerfile`, a never-built one-line `FROM` that `platform-images.ts` imports as text and parses strictly. Dependabot tracks that file weekly in its own `docker` entry (label `tailscale-companion`), so a bump PR changes what the server runs with no second edit.

## R10. Status

Read on demand with `compose exec hola-tailscale tailscale --socket=/tmp/tailscaled.sock status --json`, cached in memory for 30 seconds per deployment.

| Observation | State |
|---|---|
| Setting absent or disabled | `off` |
| Companion container not running, app running | `starting` (under 60 s since the last deploy) else `error` |
| App stopped | `disconnected` |
| `BackendState` `NeedsLogin` / `NeedsMachineAuth` | `needs-sign-in` |
| `Running`, Service absent from `Self.CapMap["service-host"]` | `waiting-for-approval` |
| `Running`, Service present | `connected` |
| `Running`, `Self.Online` false | `disconnected` |
| Backend service missing from the active release, or exec failed | `error` |

"Waiting for approval" also covers "the Service is not defined yet"; from the host the two may be indistinguishable (V3, V4), so the action text names both steps.

## R11. API verbs

The setting is a single sub-resource replaced whole, so `PUT`. The SDK and the web adapter have only `get/post/patch/delete` (`sdk/src/index.ts:102-127`); both gain `put`. `getRequiredCapability` has no deployment `PUT` rule, but its fallback maps every mutating method to `write:deployments` (`auth.ts:285-287`); a test pins that.

## R12. Governance

Principle I is redefined, which the constitution's own versioning policy calls a MAJOR bump: 1.0.0 → 2.0.0, with the Sync Impact Report updated. ADR 0007 records the decision. Both ship in the same PR as the code.

## Validation tasks needing a real tailnet

None of these can run in CI. Each is recorded in [validation.md](./validation.md) with a result, and the feature is not complete until all have one (FR-039).

| # | Question | If it fails |
|---|---|---|
| V1 | Bare `tailscaled` in the official image resumes sign-in, serve config and advertisement after a container restart | Re-apply serve config in the after-up hook on every start (already idempotent) |
| V2 | `serve --service … http://hola-ts-backend:PORT` is accepted in the userspace container | Fall back to `serve set-config` |
| V3 | Advertising an undefined Service: error, or silent wait | Adjust the status mapping and action text |
| V4 | Shape of `CapMap["service-host"]` when unapproved and approved | Adjust the parser |
| V5 | A client granted only `svc:x` cannot reach the companion device's own address | Guidance must add an explicit caveat; no code path can fix policy |
| V6 | The Service certificate issues, and when | Status text for the window before issue |
| V7 | WebSocket, SSE and a 10-minute request survive | Document the limit (FR-011) |
| V8 | `cap_drop: ALL`, read-only root, tmpfs `/tmp` | Relax only the failing control, recorded in the ADR. **Unauthenticated half observed (T019, 2026-11-20):** the companion starts and stays up under all of it and `status --json` answers `NeedsLogin`; no control was relaxed. Signed-in half still needs a tailnet. |
| V9 | `logout` leaves an expired, named device record | Adjust the operator message |
| V10 | Host-header and address substitution (Story 2) land on the backend only | Design defect; stop |

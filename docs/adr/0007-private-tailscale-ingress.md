# ADR 0007: Private Tailscale ingress — the platform's first second path in

- **Status:** Accepted (November 2026, spec 010 — opt-in private Tailscale ingress). The
  Tailscale-side behaviour it depends on is **not yet verified on a real tailnet**; see
  "Open validation".
- **Context:** Every Hola app is reached at `<app>.<HOLA_BASE_DOMAIN>` through one shared
  Traefik on one shared address. Constitution Principle I (v1.0.0) said all app traffic
  enters through Traefik. A growing case does not fit: a **non-human client that should reach
  exactly one app and nothing else**, first an AI agent calling Omnigraph's MCP endpoint. A
  Tailscale grant names a *destination*, and the only destination a Hola host offers is the
  host, so granting it grants the shared proxy and therefore every app, the dashboard and the
  admin API.

## Context

Tailscale offers a destination narrower than a machine: a named **Service** (`svc:name`) with
its own private address and DNS name, which a policy grant can name as a destination by
itself. If each opted-in deployment is its own Service, and that Service forwards to one
backend of that app and nothing else, then "this agent may reach Omnigraph" can be written as
policy without also meaning "and every other app".

That cannot be built on the shared proxy. Traefik chooses the app from a hostname the *caller*
controls, so any client allowed to reach Traefik can ask for any app by changing the `Host`
header. Isolation needs a destination per app that never touches the shared proxy, which is a
second path in. That is a change to a non-negotiable principle, which is why it is recorded
here and in a constitution amendment (2.0.0) rather than introduced as an exception.

## Decision

### 1. A platform-owned companion, per opted-in deployment

When an operator enables the setting on a deployment, `materializeCompose` injects one extra
service, `hola-tailscale` (the **companion**), running `tailscale/tailscale` pinned to an exact
version **and digest** (`v1.104.7`, `sha256:72c1e19e…31be4`; `HOLA_TAILSCALE_IMAGE` overrides
it for a registry mirror and is refused without a tag or digest). The companion joins the
tailnet as a **tagged** device, serves one Service, and forwards to exactly one backend of the
app. Nothing comes from the app's bundle: a catalog author writes nothing, and a bundle that
declares the reserved service, network or volume names (`hola-tailscale`, `hola-ts-backend`,
`hola-ts-egress`, `hola-ts-state`) is refused by the validator.

The setting lives on the deployment record (`tailscaleIngress`), not the release, so upgrade
and rollback do not touch it. With the setting off or absent the rendered compose is exactly
what it was before this feature.

### 2. Injected last

The companion is added **after** every other post-validation helper and immediately before the
runtime compose is written. Each of those helpers (contract environment, `DOCKER_HOST`, the
restore-staging mount, contract `hola` membership) fans out to *all* services and skips only
`hola-docker-proxy`. Added last, the companion receives none of them (no contract token, no
Docker-proxy address, no staging mount, no `hola` network) with no skip list to keep in sync.
A test asserts it, so a helper added after it fails a test instead of silently privileging a
third-party container. The deploy-time containment gate (`assertResolvedMountsContained`) still
runs over the result. The companion has no bind mount at all, so it passes without a grant.

### 3. Two networks, and what is on them

| Network | Kind | Members |
|---|---|---|
| `hola-ts-backend` | `internal: true` | the companion and the chosen backend, which gets the alias `hola-ts-backend` there |
| `hola-ts-egress` | plain bridge | the companion only, so it can reach Tailscale's coordination and relay servers |

The companion is on neither the project's `default` network (where the app's database sits)
nor `hola`. The only upstream host Hola ever writes is the literal `hola-ts-backend`; no
operator input reaches the host part of an upstream, so the setting offers a choice of the
release's *declared services* plus a port, never an address. A backend with a `network_mode`
is refused: a service in another's network namespace cannot be given a network of its own.
When the backend declared no networks, attaching it also adds `default`, or it would silently
leave the project network.

### 4. Hardening

The companion runs as `contracts/compose.md` specifies: `tailscaled` in userspace networking
(`--tun=userspace-networking`, no `/dev/net/tun`), `read_only: true` with a tmpfs `/tmp`,
`cap_drop: [ALL]`, `no-new-privileges`, no `ports`, `privileged`, `cap_add`, `devices`,
`network_mode`, `pid`, `ipc` or `userns_mode`, no bind mount (so never the Docker socket), no
`environment` entry (no credential, no contract token, no `DOCKER_HOST`), the platform's
`sh.hola.*` labels plus `sh.hola.role: tailscale-ingress`, and `restart: unless-stopped`.
It offers no subnet routing, exit-node behaviour or public exposure (Funnel), and the setting
has no field that could ask for one.

**Hardening validation (partial, observed 2026-11-20):** the real-Docker integration test (`tailscale-ingress.it.ts`) starts the companion with exactly these controls (`read_only`, `tmpfs /tmp`, `cap_drop: [ALL]`, `no-new-privileges`, a named volume on `/var/lib/tailscale`, userspace networking) and it stays up with zero restarts and answers `tailscale status --json` as `NeedsLogin`. No control had to be relaxed. What this does NOT show is `tailscaled` running signed in under the same controls: that is V8 proper, still NOT RUN until a real tailnet is available.

### 5. Driven by exec, not by the image's entrypoint

The image's default entrypoint (`containerboot`) is declarative: it needs the credential in the
container's environment for the container's whole life (or re-runs sign-in on every boot), its
declarative Service support exists only in source, and it resets serve configuration at
startup. So the companion's entrypoint is bare `tailscaled`, and Hola drives it with
`compose exec` after the stack is up: `tailscale status --json` to observe, `tailscale up` to
sign in, `tailscale serve --service=… --https|--tcp=… <upstream>` to serve, `serve drain` then
`serve clear`, and `logout` to withdraw. Serve configuration and the advertise preference
persist in the state directory, so a container restart resumes without Hola. (Unconfirmed: V1.)

### 6. Credential lifetime

The joining credential (auth key `tskey-auth-…` or OAuth client secret `tskey-client-…`) is
**write-only** and **transient**:

- Written once to `deployments/<id>/tailscale/credential`, mode 0600, on the server's own data
  volume, which no app container can mount.
- Used only in the lifecycle job's after-up hook, and only if the companion reports
  `NeedsLogin`: piped over stdin into a file on the companion's tmpfs, passed as
  `--auth-key=file:…`, then removed from the tmpfs (also on failure).
- Deleted from the host when the companion reports `Running`, when replaced, on disable, and
  with the deployment on uninstall.

It never enters the rendered compose, `runtime/.env`, a job payload (stored in SQLite), an
exec argument list, an error message, exec output logging (a `quiet` exec option) or any API
read; reads carry only `credentialHeld`. No reusable secret stays at rest; the persisted
device identity is what keeps the companion signed in. If that is lost or revoked the status
becomes "needs sign-in" and the operator supplies a new credential.

### 7. Identity in a named volume

The device identity (key, serve configuration, certificates) lives in a project-scoped Docker
**named volume**, `hola-ts-state`, mounted at `/var/lib/tailscale`.

| Option | Why not |
|---|---|
| Under the app's data root | Captured by pre-upgrade snapshots and restore-on-install; a restored install would hold a copy of another device's identity |
| `<apps-root>/.hola/<id>/` | Outside snapshots, but inside what a consented `backup@1` provider mounts read-only, so a backup would hold a device identity |
| The server's data volume | Not a host path, cannot be bind-mounted into an app container |
| A new host root plus identity mount | Works, but changes the production compose stack and `install.sh` for every host |

A named volume passes the deploy-time gate (it checks bind mounts only), is in no backup or
snapshot, and survives `compose down`, which stop/start needs. Because `compose down` never
removes it, `DockerService` gains `removeVolume` (Real and Mock), called on disable, uninstall
and force removal.

### 8. Changes ride the existing restart job

Per Principle III the endpoint only validates and persists; the work runs in
`runLifecycleJob` through the existing restart path, serialized per deployment (the
F09/F10 rules in CLAUDE.md apply: a conflicting operation in flight is refused `409 DEPLOYMENT_BUSY`). Two
hooks:

- **Before up:** if disable is pending and the companion is running, drain, clear and log out
  (best effort, bounded), then `compose rm -sf hola-tailscale`. Compose has no
  `--remove-orphans` on `up` here, so a companion dropped from the file would otherwise keep
  running. This is the one hook failure that fails the job: continuing would leave a companion
  running that the operator asked to remove.
- **After up:** enabled, sign in if needed, apply the serve configuration on every job
  (idempotent; withdrawing the previously applied Service first when its name, mode or listen
  port changed), wait up to 60 seconds for a signed-in state, delete the credential. Disabled,
  remove the volume and the two networks and clear the pending flag.

Both hooks log and reflect their failure in status but never fail the job otherwise: a
companion that cannot connect never fails the app's deployment or its normal address, and a
deploy never waits more than 60 seconds on it. On a stopped app, enable only saves; disable
cleans up locally under the deployment lock (the device cannot be signed out, and the response
says so). If the chosen backend disappears in an upgrade or rollback, the app renders **without**
the companion and status reports `error` naming the service; traffic is never redirected to a
different one.

## The boundaries: what it can never do

| Boundary | Requirement | How it is held |
|---|---|---|
| Never reaches anything but the one backend | FR-015 | Companion on the internal backend network only (plus an egress bridge); not on `default` or `hola`; a fixed upstream alias; no free-form address in the setting |
| Never privileged | FR-014 | The hardening list in §4; each absence is a test; the deploy-time gate re-checks |
| Never routes, exits or publishes | FR-017 | No setting field for subnet routes, exit nodes or Funnel; `tailscale up` pins `--ssh=false --accept-routes=false --advertise-exit-node=false --advertise-routes= --exit-node=` (all present in v1.104.7); `tailscaled`'s argv is fixed with no SOCKS5/HTTP proxy listener; Hola never runs `funnel` |
| Never weakens the validator | FR-016 | The companion is a post-validation injection like `hola-docker-proxy`; validator rules are untouched; reserved names refuse a bundle's imitation |
| Never touches tailnet policy | Out of scope | Hola does not call the Tailscale administration API; it tells the operator what to define, approve and grant, and offers a copyable *example* grant |

It also adds no credential to forwarded requests, does not rewrite the `Host` header and
relaxes no security header (FR-012).

## The forward-auth limit

Traefik is where Hola's `forward-auth` gate (Authentik's embedded outpost) sits. The private
path does not pass through Traefik, so **that gate does not cover it**. Protection on the
private path is tailnet policy plus whatever the app enforces itself. Rather than a silent
bypass, enabling the ingress on a `forward-auth` app requires an explicit acknowledgement
(`acknowledgeForwardAuthBypass`; `--ack-forward-auth`). Native OIDC and LDAP apps authenticate
inside the app and are unaffected. The same applies to anything else Traefik middleware does
for a deployment's normal address.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Put Traefik on the tailnet and grant that | Exactly the problem: one destination, every app |
| A second Traefik entrypoint per app | Needs a host port per app and is still one shared address |
| Tell operators to run their own sidecar | The validator rightly forbids what that needs (extra networks reaching other apps, arbitrary images with state mounts); allowing it would weaken the validator for everyone |
| Build `tailscaled` into the server image | Adds a network daemon to the container that holds the Docker socket |
| `containerboot` with `TS_AUTHKEY` in the environment | Credential at rest in `docker inspect`; declarative Services are source-only |
| Keep the credential for automatic re-enrolment | A reusable secret at rest; "rotation" is cleaner as one supply action |
| A Hola-built companion image | A second image to build, sign and patch |
| Identity under the apps root | Captured by snapshots, backups and restore-on-install (§7) |
| Hola calls the Tailscale admin API to define Services, approve and delete devices | Needs a broad administrative credential at rest; left as a possible later addition |

## Consequences

- **The platform now has a second ingress path**, per deployment, opt-in, operator-enabled and
  never bundle-declared. Principle I is restated accordingly (constitution 2.0.0, a MAJOR
  bump because it redefines a principle). The enforcement half of the old principle is
  unchanged: no host ports, pinned images, the validator not bypassed.
- **A third-party image is run by the platform**, pinned by digest, pulled only for opted-in
  deployments. A failed pull fails the deploy like any other image. Dependabot does not see
  image references in TypeScript, so keeping the pin fresh is a tracked follow-up, not
  automatic.
- **The egress bridge is a general-purpose network.** The companion can reach whatever a
  bridge container can (the internet, and the host and LAN through the bridge gateway). The
  setting gives no operator-controlled way to use that, since `tailscaled` only forwards to
  the configured upstream, but the isolation claim rests on that and on the hardening above,
  not on the egress network being closed.

  **Review conclusion on FR-015 (2026-11-20).** What a *tailnet client* can make the
  companion reach is exactly one destination, `hola-ts-backend:<port>`: the serve upstream is
  a literal host (never operator input), no routes or exit node are advertised (and are
  pinned off on every `tailscale up`), and Tailscale SSH, Funnel and the proxy listeners are
  never enabled with no input that could enable them. Advertising is node-side, so an admin
  console cannot approve a route the node never offered. Read that way, FR-015 holds. Read
  literally, as a property of the *container*, it does not: the egress bridge's gateway is the
  Docker host, so a process inside the companion can reach the host's published ports,
  including Traefik on 80/443, which is a path to every app through the shared proxy, plus
  the LAN. Exploiting that needs code execution inside the companion (a compromised
  `tailscaled` or image), not a crafted request. Closing it needs host-level egress filtering
  (e.g. a DOCKER-USER rule dropping the egress subnet's traffic to the host and RFC 1918
  ranges), which Hola does not manage today. Whether to accept this residual risk, narrow
  FR-015's wording to the forwarding path, or add host filtering is an open decision.
- **Disabling leaves a record for the operator.** `logout` signs a non-ephemeral device out
  but its record stays in the admin console until deleted. Hola always names the device and
  says whether it was signed out; the operator deletes it. (V9 checks the leftover record's
  shape.)
- **Reachability is not authentication.** Tailnet policy is additive, a grant to the Hola host
  is not a grant to one app, and clients sharing one identity cannot be told apart by policy.
  The guidance says all three.
- **Limits:** one private ingress per deployment, one backend, one listening port, HTTP(S)
  or plain TCP, no re-encryption to an HTTPS-only backend.

## Open validation

None of V1 to V10 has run on a real tailnet. Each is recorded as NOT RUN in
`specs/010-tailscale-ingress/validation.md`, and the feature is not complete until each has a
result. What would change if a check fails is in `research.md`.

| # | Question |
|---|---|
| V1 | A bare `tailscaled` resumes sign-in, serve config and advertisement after a container restart |
| V2 | `serve --service … http://hola-ts-backend:PORT` is accepted in the userspace container |
| V3 | What happens when the host advertises an undefined Service |
| V4 | The shape of `CapMap["service-host"]`, unapproved and approved |
| V5 | A client granted only the Service cannot reach the companion device's own address |
| V6 | The Service certificate issues, and when |
| V7 | WebSocket, SSE and a 10-minute request survive |
| V8 | `cap_drop: ALL`, read-only root and a tmpfs `/tmp` work with a signed-in device |
| V9 | `logout` leaves an expired, named device record |
| V10 | Host-header and address substitution land on the backend only (a design defect if not) |

Also unrun: SC-001 (off to connected in under ten minutes from the guidance alone) and SC-009
(an identity limited to the Omnigraph Service can call `/mcp` and cannot reach a second app).

## Related

- Constitution Principle I (amended to 2.0.0 with this ADR) and Principle V.
- ADR 0004 — capability contracts; the log-proxy sidecar is the precedent for a
  platform-injected container added after validation.
- ADR 0006 — the restore-staging grant, the other place the platform widened its privilege
  surface in the open.
- `specs/010-tailscale-ingress/` — spec, plan, research (R1 to R12, V1 to V10), data-model,
  `contracts/api.md`, `contracts/compose.md`, `validation.md`.
- `docs/TAILSCALE_INGRESS.md` — the operator guide.

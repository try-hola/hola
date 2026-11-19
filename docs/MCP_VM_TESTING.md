# Disposable-VM end-to-end testing (Proxmox)

This repo's devcontainer can drive a **throwaway Proxmox VM** for end-to-end
testing — entirely from inside the container, without touching the host shell.
The VM lifecycle runs over the **Proxmox REST API** (the `bin/vm-*` helpers); the
CLI is tested by bootstrapping Hola onto the VM **over SSH**; and the dashboard is
verified with **headless Chromium** (`bin/vm-web-check`) from the container.

There is an optional `proxmox` MCP server wired in `.mcp.json`, but the `bin/`
scripts cover the whole lifecycle, so it isn't required. Nothing here exposes
Proxmox to the public internet, and **no secrets are committed**.

---

## How it fits together

```
┌─ devcontainer (Claude Code runs here) ──────────────────────────────┐
│                                                                     │
│  bin/vm-*  ─────────────────────────► Proxmox REST API ──► VM       │
│  (create / wait-ssh / snapshot / destroy / reap — token auth)       │
│                                                                     │
│  bin/vm-ssh, hola bootstrap ──(ssh + ephemeral key)──► VM (CLI/stack)│
│                                                                     │
│  bin/vm-web-check ──(Playwright/Chromium, over the network)──► VM   │
│  (loads the dashboard, signs in, asserts it renders, screenshots)   │
│                                                                     │
│  .mcp.json ─► proxmox MCP (HTTP, OPTIONAL — bin/vm-* already cover)  │
└─────────────────────────────────────────────────────────────────────┘
        ▲ secrets from .devcontainer/mcp.env  OR  host env (containerEnv)
```

- **`bin/vm-*`** talk to the Proxmox REST API directly (least-privilege token),
  with a `--dry-run` smoke mode that proves the wiring without any infrastructure.
- **SSH** (`bin/vm-ssh`, `hola bootstrap --host`) handles setup, installs, the CLI
  bootstrap, and on-VM tests. `bin/vm-create` injects an ephemeral per-VM key via
  cloud-init; `bin/vm-wait-ssh` writes a `~/.ssh/config` alias so `hola bootstrap`
  works with no extra flags.
- **`bin/vm-web-check`** drives headless Chromium from the container against the
  dashboard URL — no in-VM desktop, no VNC. This is the UI/front-door test.
- **The `vm-e2e` skill** (`.claude/skills/vm-e2e/`) ties it together: create →
  bootstrap the CLI → verify the stack → web-check → teardown.

---

## One-time setup

0. **Build the VM template** (on the Proxmox host, not the devcontainer). Copy
   `bin/proxmox-build-template` to the host and run it as root (needs Proxmox VE 8+
   and `libguestfs-tools`). It bakes in cloud-init, the QEMU guest agent, Docker +
   the Compose v2 plugin, and a sudo/docker user:

   ```bash
   ./proxmox-build-template --id 9000            # build the template
   ./proxmox-build-template --dry-run            # rehearse, change nothing
   ```

   The baked user (`--user`, default `hola`) must match `VM_SSH_USER` below. To
   hand this off to an agent/person with SSH access to the host, use the runbook in
   `docs/vm-e2e-host-setup.md` (also covers the one-time token role grant).

1. **Open the repo in the devcontainer.** Claude Code runs *inside* it.

2. **Provide secrets** one of two ways (both keep secrets out of git):
   - **Env file:** run `bin/mcp-setup` — it copies `.devcontainer/mcp.env.example`
     → `.devcontainer/mcp.env` (gitignored); fill in the values. **or**
   - **Host environment:** `export` the same variables on your host; `containerEnv`
     in `devcontainer.json` forwards them in (`${localEnv:...}`).

   Use a **least-privilege Proxmox API token**, never a root password. On PVE 9 the
   token needs `PVEVMAdmin` (VM ops) **plus** `PVEDatastoreUser` on the storage and
   `PVESDNUser` on the bridge — see `docs/vm-e2e-host-setup.md`.

3. **For the browser stage**, install Playwright's Chromium once:
   `bun install && bunx playwright install --with-deps chromium`.

4. **(Optional) proxmox MCP** — if you run one, set `PROXMOX_MCP_URL` and approve
   it via `/mcp`. Not required; the `bin/` scripts cover the lifecycle.

---

## The workflow

Driven by the **`vm-e2e` skill** (ask Claude to "run the vm-e2e test"), or by hand:

```bash
VMID=$(bin/vm-create | tail -1)        # clone template, inject ephemeral SSH key, start
bin/vm-wait-ssh --vmid "$VMID"         # wait for boot + guest-agent IP; writes ssh alias hola-vm-$VMID
hola bootstrap --host "hola-vm-$VMID" --env-file .devcontainer/hola.env   # install Hola over SSH
bin/vm-ssh --vmid "$VMID" -- 'cd /opt/hola && docker compose ps'          # verify the stack
bin/vm-web-check                       # headless-Chrome front-door check (login + render)
FORCE=1 bin/vm-destroy --vmid "$VMID"  # tear down (or snapshot on failure)
```

### Bootstrap the hola CLI onto the VM

```bash
# One-time: generate a real Hola .env (the wizard can't run headlessly).
hola init --out .devcontainer/hola.env          # gitignored; NOT mcp.env

VMID=$(bin/vm-create | tail -1)
bin/vm-wait-ssh --vmid "$VMID"
hola bootstrap --host "hola-vm-$VMID" --env-file .devcontainer/hola.env
```

`--env-file` must be a **rendered Hola `.env`** (not `mcp.env`). To test the
**local** CLI, run the working-tree binary
(`bun --cwd packages/cli src/index.ts bootstrap … --env-file "$PWD/.devcontainer/hola.env"`);
note it still pulls the published server/web images — see the `vm-e2e` skill for
the both-modes flow and the advanced local-image path.

### Headless front-door check (no desktop / VNC)

`bin/vm-web-check` drives Chromium (Playwright) from the container against the
dashboard URL: it loads the page, signs in the way the dashboard asks, asserts the
authenticated `/apps` view, and writes screenshots to `logs/web-check/`.

Which sign-in it performs follows the server's real `GET /api/auth/config` — the
check never stubs it, so it exercises the dashboard's actual login:

- **`apikey` / `none`** (e.g. `bin/vm-e2e-suite`'s `mode=none` VMs) — the admin-key
  field, with the key from `HOLA_API_KEY` / `--key`. The VM is never contacted.
- **`oidc`** (`HOLA_AUTH_MODE=authentik`, e.g. `bin/vm-catalog-test` VMs) — the
  dashboard redirects to Authentik by itself; the check signs in there as
  `akadmin` (the same flow as `bin/vm-sso-check`, shared in
  `bin/lib/authentik-login.mjs`), lets the dashboard finish `/auth/callback`, and
  then asks `GET /api/auth/me` which role the session got. `akadmin` is an
  Authentik superuser, which the server seeds into the dashboard admin group
  (`HOLA_OIDC_ADMIN_GROUP`, default `hola-admins`), so anything but admin fails
  the check. The password is `AUTHENTIK_BOOTSTRAP_PASSWORD` from the VM's
  `/opt/hola/.env`, read over `bin/vm-ssh` (`--vmid`, default the VM in harness
  state) **only** in this mode and handed to the browser through its environment
  — never printed or put on a command line. The VM's `HOLA_DOMAIN` must match the
  URL, so a stale VM id cannot hand over another host's password. A caller that
  already holds the password may export `WEB_CHECK_SSO_PASSWORD` instead.

```bash
bin/vm-web-check                       # URL + key read from .devcontainer/hola.env
bin/vm-web-check --url https://apps.10.0.0.50.sslip.io --key <admin-key>
# an Authentik-mode VM kept by vm-catalog-test --keep:
HOLA_ENV_FILE=.devcontainer/hola-catalog.env bin/vm-web-check --vmid <id>
```

It exits non-zero on failure (so it slots into CI / `vm-test`). For deeper UI
flows (browse the catalog, install an app, assert it deploys), extend
`bin/lib/web-check.mjs`. Requires Playwright's Chromium (setup step 3).

### One-shot end-to-end (and smoke test)

`bin/vm-test` runs the whole lifecycle: create → wait-ssh → run a command →
destroy on success (snapshot + keep on failure with `--keep-on-fail`).

```bash
bin/vm-test --dry-run                          # prove the wiring, touch nothing
bin/vm-test --ssh -- 'cd /opt/hola && docker compose ps'   # run on the VM
bin/vm-test -- bin/vm-web-check                # run the web check in the container
```

### Deterministic e2e suite (the repeatable regression test)

`bin/vm-test` runs *one* command; `bin/vm-e2e-suite` runs the whole **product
flow** and asserts every step. It's the cheap, repeatable end-to-end test: a
fresh VM with `HOLA_AUTH_MODE=none` (no Authentik — saves ~2 GB RAM and several
minutes) and a single light app. It renders a creds-free Hola `.env` (sslip.io +
a private test-CA certificate in trusted mode, Traefik's self-signed default
otherwise; see "DNS & TLS" below) with a deterministic per-run admin key, then:

```
create VM → wait-ssh → render .env → hola bootstrap → verify stack →
browse catalog → install app → assert reachable at its subdomain →
deployments list → restart → stop → uninstall → tear down
```

```bash
bin/vm-e2e-suite --dry-run        # rehearse every step, touch no infrastructure
bin/vm-e2e-suite                  # real run: create → assert each step → destroy
bin/vm-e2e-suite --keep-on-fail   # snapshot + keep the VM if something fails
bin/vm-e2e-suite --app vaultwarden  # default app (override with --app)
```

Each step prints `PASS`/`FAIL`; the run exits non-zero on any failure and prints
a summary. Per-step output (bootstrap, install, lifecycle, `compose ps`, plus
server/app logs on a failed deploy) lands in `logs/vm-e2e-suite/`.

**App choice matters under `HOLA_AUTH_MODE=none`.** The deploy job runs
`provisionAuth` *before* `composeUp`, and `provisionAuth` is only a no-op for apps
whose manifest declares `auth.mode: none`. For `forward-auth` apps (uptime-kuma,
homepage, webtop, backrest) or `native-oidc` apps (actual-budget, immich), there
is no Authentik to provision against under mode=none, so `provisionAuth` throws
and `composeUp` never runs — the deploy fails. The suite therefore defaults to
**vaultwarden** (`auth.mode: none`, light, serves directly). `--app uptime-kuma`
will fail under mode=none on servers without the #267 fix; the suite detects that
exact signature and prints the root cause. Robustness: before installing it waits
until the server can spawn `docker compose` (and retries the first deploy with
backoff) to defeat the docker-spawn `ENOENT` race.

### Catalog sweep — install EVERY app and verify it comes up

`bin/vm-catalog-test` is the catalog-wide generalization of the single-app suite.
It brings up **one** `HOLA_AUTH_MODE=authentik` VM (so apps of *every* auth mode —
`none`, `forward-auth`, `native-oidc` — can provision), then walks the catalog
running the **deterministic per-app test** (`bin/lib/app-test.sh`) against each
app, one at a time:

```
(setup once) create VM → wait-ssh → render authentik .env → bootstrap →
              verify core stack → wait for Authentik → wait deploy-ready
(per app)     install → verify it converges to `running` with its containers up
              and its front door answering → uninstall → next
```

Only one app is live at a time, so peak RAM stays bounded (core + Authentik + the
single heaviest app). `bin/lib/app-test.sh` is the **single source of truth** for
the per-app checks — the sweep is just that test in a loop over `hola catalog`.

The output is built for monitoring a long run, then drilling into failures:

- **STDOUT** = one terse line per app: `PASS uptime-kuma (1m12s)` /
  `FAIL gitea (verify, 3m04s)  logs: logs/vm-catalog-test/gitea/`, then a summary.
- **STDERR** = the live verbose setup trace (create/bootstrap/verify).
- **Files** = `logs/vm-catalog-test/<app>/` holds the install JSON, server logs,
  container states, and deploy logs — open these when a line says `FAIL`.

```bash
bin/vm-catalog-test --dry-run               # rehearse the whole sweep, no infra
bin/vm-catalog-test                         # install + verify EVERY catalog app
bin/vm-catalog-test 2>logs/vm-catalog-test/setup.log   # pure terse stdout view
bin/vm-catalog-test --apps gitea,immich     # just these
bin/vm-catalog-test --skip webtop           # everything except one
bin/vm-catalog-test --memory 8192           # size the VM for heavy apps
bin/vm-catalog-test --restart               # also restart each app (exercises #267)
bin/vm-catalog-test --lifecycle             # restart + stop + uninstall each app
```

The auth mode is read off the *front door*, not hard-coded per app: the verify
step accepts any healthy response — `200` (a `none`/`native-oidc` app serving
directly) **or** a `30x`/`401` redirect to Authentik (a `forward-auth` app gated at
the Traefik edge). The hard "came up correctly" gate is the deployment converging
to `running` with its containers healthy on the host; one-shot init/migration
containers that exit `0` are tolerated.

Exit code = number of apps that failed. `--keep-on-fail` snapshots and keeps the
VM if any app failed (default: always destroy so reruns stay cheap).

> **Caveat — the sweep tests the RELEASED server image.** `hola bootstrap` installs
> the published `ghcr.io/try-hola/server` pinned to the CLI version, so the sweep
> exercises the **last release**, not `main`. Server fixes that are merged but
> unreleased won't be present — notably an **uninstall that leaves containers** is
> the already-fixed #271, and a **forward-auth `--restart` failure** is the
> already-fixed #267, both pending a release. To validate current `main`, build a
> server image and load it onto the VM (the *Advanced — local server/web image*
> path in the vm-e2e skill), then re-run.
>
> Some catalog apps also can't install fully unattended and will FAIL with the
> deploy error in their per-app log — read it to separate a real regression from an
> app-config gap. Two patterns seen in practice: a required secret that must be a
> **real external token** (e.g. gitea's runner registration token — a generated
> value is rejected), and a manifest that leaves a needed value **blank** (e.g. a
> Postgres password not wired, an upstream `try-hola/apps` issue → the app's init
> container exits non-zero). The harness auto-fills required *secret* env vars with
> generated tokens and SKIPs apps that need non-secret manual config, but it can't
> invent a valid external token.

---

## Helper command reference

| Command           | What it does                                              | Destructive |
|-------------------|----------------------------------------------------------|:-----------:|
| `bin/proxmox-build-template` | **(Proxmox host)** build the cloud-init/agent/docker template | no¹ |
| `bin/mcp-setup`   | Scaffold/validate `mcp.env`; list the optional MCP server | no          |
| `bin/vm-create`   | Clone template → start VM; inject ephemeral SSH key       | no          |
| `bin/vm-wait-ssh` | Block until the VM accepts SSH; write the ssh alias       | no          |
| `bin/vm-ssh`      | Run a command (or open a shell) on the VM over SSH        | no          |
| `bin/vm-web-check`| Headless-Chrome front-door check of the dashboard        | no          |
| `bin/vm-snapshot` | Create or `--list` snapshots                             | no          |
| `bin/vm-destroy`  | Stop + purge the VM and its key (confirmation required)   | **yes**     |
| `bin/vm-reap`     | Find + destroy LEAKED `hola-test*` clones (confirms once) | **yes**     |
| `bin/vm-test`     | Full create→test→teardown lifecycle (`--dry-run`, `--ssh`) | yes (teardown) |
| `bin/vm-e2e-suite`| Deterministic product e2e: bootstrap→install→lifecycle→uninstall, asserted | yes (teardown) |
| `bin/vm-catalog-test`| Install EVERY catalog app on one Authentik VM, verify each comes up (terse stdout, per-app logs) | yes (teardown) |

¹ `bin/proxmox-build-template` runs on the **Proxmox host** (not the container);
`--force` replaces an existing template VMID, `--destroy --id N` removes one.

**Teardown.** Normal runs self-clean (`vm-test`/the skill destroy on success).
For leaks — a crashed run, lost devcontainer state — `bin/vm-reap` sweeps every
non-template VM named `hola-test*` and destroys it (templates are never touched).
Remove a template itself with `bin/proxmox-build-template --destroy --id <N>` on
the host (or `bin/vm-destroy --vmid <N>` via the API).

Common flags: `--vmid N` (target a specific VM; otherwise the "current" one in
`.devcontainer/.vm-state`), `--dry-run` (print actions, change nothing),
`--yes`/`FORCE=1` (skip the destroy confirmation, e.g. in CI). Run any with `-h`.

Every state-changing action is appended to `logs/vm-actions.log` (gitignored).

---

## DNS & TLS for the test VM (no cloud creds)

Hola serves the dashboard at `HOLA_DOMAIN` and apps at `*.HOLA_BASE_DOMAIN` via
Traefik. For a disposable VM you do **not** want real public DNS, ACME-DNS, or
provider credentials. Use **`sslip.io`** — zero config, no creds:

Give the VM a **static IP** via cloud-init (`VM_IPCONFIG0=ip=10.0.0.50/24,gw=10.0.0.1`
in `mcp.env`), then in the Hola config use that IP's sslip.io name:

```
HOLA_BASE_DOMAIN=10.0.0.50.sslip.io     # *.10.0.0.50.sslip.io → 10.0.0.50, via public DNS
HOLA_DOMAIN=apps.10.0.0.50.sslip.io
```

`<anything>.<ip>.sslip.io` resolves to that IP, so the container's headless
Chromium (and `curl`) reach the dashboard with no DNS setup. A static IP keeps the
URL stable across boots (DHCP also works — just re-read the IP after `vm-wait-ssh`).

**TLS: trusted mode (the default once you have a test CA).** Without DNS-01 the VM
gets no real Let's Encrypt cert (it isn't reachable on :80 for HTTP-01), so Traefik
would serve its **default self-signed cert** and every probe would need `-k` /
`NODE_TLS_REJECT_UNAUTHORIZED=0` / `ignoreHTTPSErrors`. That also hides real bugs:
a native-OIDC app whose container cannot verify Authentik's certificate (gitea 28 and
friends) fails at login while every "is it up" probe stays green. So the harness
runs a **private test CA**, and the VM serves, and every container trusts, a cert
signed by it. **Test infrastructure only: nothing in the Hola product changes, and
nothing here ships anywhere real.**

```bash
bin/vm-test-ca init       # once: creates .devcontainer/.test-ca/{ca.pem,ca.key} (gitignored)
bin/vm-test-ca status     # trusted | untrusted: <why>
```

- **On when** the CA exists and `VM_TRUSTED_TLS` is not `0`. **Off** (`VM_TRUSTED_TLS=0`,
  or no CA) the suites behave exactly as they always did: `-k`, the bypass,
  `ignoreHTTPSErrors`, no VM-side files (an offline golden selftest guards it). A
  one-line banner on stderr says which mode a run is in.
- `bin/vm-test-ca init` **refuses to overwrite** an existing CA (exit 2; `--force`
  replaces it). `ca.key` is mode 0600, never printed and **never copied to a VM**.
  `bin/vm-test-ca issue --ip <ip>` makes the per-VM wildcard leaf
  (`<ip>.sslip.io` + `*.<ip>.sslip.io`, 365 days, re-issued under 30 days left);
  `spki --ip <ip>` prints the leaf's base64 SHA-256 SPKI.

**What the harness puts on the VM** (trusted mode only):

| Path on the VM | What | When |
|---|---|---|
| `/etc/hola-test-ca/bundle.pem` | the devcontainer's system roots + the test CA | before bootstrap |
| `/usr/local/libexec/hola-test-ca-runtime` | the runtime front end (`bin/lib/test-ca-runtime.sh`), Docker's runtime path | before bootstrap |
| `/usr/local/libexec/hola-test-ca-runtime.py` | the OCI runtime shim (`bin/lib/test-ca-runtime.py`) | before bootstrap |
| `/etc/docker/daemon.json` | merged: runtime `hola-test-ca`, `default-runtime` | before bootstrap |
| volume `hola-data`: `/test-tls/{cert,key}.pem` | the leaf and its key | right after bootstrap |
| volume `hola-data`: `/runtime/traefik/test-tls.yml` | Traefik's default-store certificate | right after bootstrap |

- **Traefik** picks `test-tls.yml` up through its watched dynamic-config directory
  with no restart, and serves the CA-signed leaf for every router kind (core hosts,
  app hosts, bypass and protected-bypass paths, the Authentik outpost path), because
  the product configures no per-router certificate resolver on a creds-free VM.
- **Containers** trust the CA through the **runtime shim**, deliberately *below* Hola:
  it is registered as Docker's default runtime and, on every container `create`,
  bind-mounts the bundle read-only and sets `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and
  `REQUESTS_CA_BUNDLE` (only where the container hasn't set them), then `exec`s the
  real `runc` with the original arguments. Docker actually runs a tiny `sh` front end
  that `exec`s `runc` directly for every call without a `create` argument (healthcheck
  `exec`s, `state`, `kill`, `delete`), so only container creation starts Python. Because it sits under container creation
  it covers every container Hola ever (re)creates (restart, redeploy, rollback,
  promote) with no change to the product, the server image or any bundle. (A
  server-side hook was considered and rejected: this stays test-harness only.) It must
  be installed **before** `hola bootstrap` (a container records its runtime at
  creation), which the suites do. It is inert if the bundle file (or the Python shim
  behind the front end) is missing, so an error in the shim never stops a container
  being created; that is not a promise about what the container does next (below).
- **System trust-store overlay:** because exec'd processes never see the env (next
  bullet), the shim also bind-mounts the bundle read-only over each system trust-store
  file the image already has (`/etc/ssl/certs/ca-certificates.crt` and friends), which
  is what gitea's `compose exec`'d Go setup relies on. A read-only store breaks an image
  that rewrites it at startup, so the overlay (only the overlay) is **skipped** when
  `update-ca-certificates`, `update-ca-trust`, `c_rehash` or `trust extract` appears in
  the container's command, in a script that command names (resolved inside the image),
  or in a standard entrypoint hook directory (`/docker-entrypoint.d`, `cont-init.d`,
  s6-overlay `s6-rc.d`, ...). It is a heuristic: Docker puts no image name or label in
  the OCI config, so no per-image rule is possible below Hola. An image that reaches a
  rewriter some other way still gets the overlay and may crash-loop; run that app with
  `VM_TRUSTED_TLS=0`.
- **`docker exec` caveat:** an exec'd process does **not** inherit the shim's env
  (exec builds its env from Docker's config, not the OCI spec), and `/proc/1/environ`
  is unreadable in many images (non-root PID 1, s6-overlay). The `sso-trust` probe
  therefore checks the container's recorded runtime and the mounted bundle, then runs
  the fetch with the three variables passed explicitly (`docker exec -e …`).

**Per-bundle OIDC trust** (`bin/lib/oidc-trust.tsv`, read by the `sso-trust` stage of
the per-app test). In trusted mode, after `verify-up` (and again after `--restart`), a
native-OIDC app's container must be able to fetch Authentik's OIDC discovery document
(or its liveness URL) over TLS with its **own runtime**:

| Bundle | Runtime | Mechanism | If it can't |
|---|---|---|---|
| gitea | Go | the system trust-store overlay (its `compose exec`'d setup never sees `SSL_CERT_FILE`) | **FAIL** at `sso-trust` |
| immich, postiz, actual-budget | Node | `NODE_EXTRA_CA_CERTS` | **FAIL** at `sso-trust` |
| mealie | Python | `SSL_CERT_FILE` + `REQUESTS_CA_BUNDLE` | **FAIL** at `sso-trust` |
| hangar | unverified | not yet checked | **SKIP**: `[sso-trust: SKIP (trust not covered)]` on its result line |

A SKIP never hides the app's install/verify/restart results. An app absent from the
table isn't native-OIDC and the step doesn't run.

**Full SSO logins:** `bin/vm-sso-check` drives headless Chromium through the whole
login (app login page, "Login with Authentik", akadmin, consent, an authenticated API
call) on a **kept** trusted VM, with TLS verified. It can also assert a service worker
registers (which needs a trusted secure context):

```bash
bin/vm-catalog-test --apps gitea,immich,mealie --keep          # prints the kept VMID
bin/vm-sso-check --vmid <id> --app gitea --app immich --app mealie
bin/vm-sso-check --vmid <id> --app craft-apps --service-worker /effectcraft/
bin/vm-destroy --vmid <id> --yes
```

`bin/vm-web-check` likewise verifies TLS (Chromium gets the leaf's SPKI, errors are
not ignored) when the URL is `<ip>.sslip.io` and trusted mode is on.

**Out of scope:** `hola bootstrap`'s own post-install verify still does `curl -sk`
inside the product CLI. That is product code and is left alone.

**Untrusted mode** (no CA, or `VM_TRUSTED_TLS=0`): Traefik serves its default
self-signed cert, `bin/vm-web-check` launches Chromium with `ignoreHTTPSErrors`, and
`hola bootstrap`'s verify uses `curl -k`. Correct for functional testing; don't ship
these certs anywhere real.

### Testing the ACME flow with the staging CA

To exercise cert *issuance* (not self-signed) without burning production rate
limits, point Traefik at Let's Encrypt **staging**:

```
ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory
```

Staging only does anything **when a challenge can succeed**: either HTTP-01 (the
VM reachable from the internet on :80, no creds, per-host certs only) or DNS-01 (a
real domain + provider creds — the creds path we otherwise avoid; staging's limits
are ~100× prod's). On the default creds-free, self-signed path no ACME challenge
runs, so `ACME_CA_SERVER` is a no-op there. Staging certs are untrusted; start from
a fresh `acme.json` when switching CA servers.

### Keeping AWS / DNS-provider creds OUT of the env file

Real wildcard certs need **DNS-01**, whose provider creds (`AWS_ACCESS_KEY_ID`,
`CF_DNS_API_TOKEN`, …) Traefik reads from the stack's `.env`. The Hola wizard only
prompts for them **when `ACME_DNS_PROVIDER` is `route53`/`cloudflare`**. So:

- **For tests, leave `ACME_DNS_PROVIDER` unset** — the wizard never asks for AWS
  creds and `.devcontainer/hola.env` stays credential-free (use sslip.io +
  self-signed).
- **If you ever need DNS-01**, don't bake the creds into the committed test
  `hola.env`. Inject them out-of-band into the VM's `/opt/hola/.env` *after*
  bootstrap (over `bin/vm-ssh`); the `dns01` overlay reads `${AWS_ACCESS_KEY_ID:-}`
  from the environment.

---

## Security model

- **No secrets in git.** `mcp.env`, `hola.env`, `.vm-state`, and `.vm-keys/` are
  gitignored; only `*.example` templates are committed. Host-env injection via
  `containerEnv` is the alternative for secret-manager-backed teams.
- **Least privilege.** Scripts authenticate to Proxmox with an **API token**
  (`PVEAPIToken` header), not a root password — scoped to the VM/storage/SDN
  permissions the lifecycle needs (see the host-setup runbook).
- **Private networking.** Point `PROXMOX_*` at the management subnet or a VPN. The
  VM and its dashboard live on the private test network; nothing is exposed
  publicly.
- **TLS.** Set `PROXMOX_CACERT` to verify the Proxmox cert. `PROXMOX_TLS_INSECURE=1`
  is lab-only and logs a warning on every call.
- **Disposable + logged.** VMs are clones meant to be thrown away; destructive
  actions require confirmation (or explicit `--yes`/`FORCE=1`) and are audited.
- **Ephemeral SSH keys.** Each VM gets its own throwaway keypair, injected via
  cloud-init and deleted on destroy. No shared key, no password auth; the private
  key never leaves the container or enters git.

---

## The optional `proxmox` MCP server

`.mcp.json` defines an **optional** `proxmox` MCP server (streamable-HTTP at
`PROXMOX_MCP_URL`). The `bin/vm-*` scripts already cover the lifecycle via the REST
API, so you can leave it blank. If you run one, point Claude at it there (or swap
in a stdio `command`/`args` entry) and approve it via `/mcp`. Values come from the
container environment (`mcp.env` or host passthrough) — never hard-code them.

---

## Troubleshooting

- **`bin/vm-*` say a var is missing** — they read `.devcontainer/mcp.env` and the
  environment; run `bin/mcp-setup` and fill in the Proxmox API section.
- **Clone fails with a 403 permission error** — the token is missing a privilege;
  PVE 9 needs `PVEVMAdmin` + `PVEDatastoreUser` (storage) + `PVESDNUser` (bridge).
  See `docs/vm-e2e-host-setup.md`.
- **No SSH / guest-agent IP** — confirm the template has the QEMU guest agent and a
  cloud-init drive (the builder bakes both); check `bin/vm-wait-ssh` output.
- **web-check can't launch Chromium** — run `bunx playwright install --with-deps
  chromium` (the `--with-deps` apt step needs sudo).
- **Want to see what a script would do** — add `--dry-run`.

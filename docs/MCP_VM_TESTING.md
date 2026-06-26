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
dashboard URL: it loads the page, signs in with the admin key, asserts the
authenticated `/apps` view, and writes screenshots to `logs/web-check/`.

```bash
bin/vm-web-check                       # URL + key read from .devcontainer/hola.env
bin/vm-web-check --url https://apps.10.0.0.50.sslip.io --key <admin-key>
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
self-signed TLS) with a deterministic per-run admin key, then:

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

> Note on `--restart`/`--lifecycle`: `hola bootstrap` installs the **published**
> server image, and the forward-auth restart fix (#267) ships in a later release —
> so restarting a `forward-auth` app on a released image will (correctly) FAIL
> until that release is out. The default sweep (install + verify + uninstall) works
> for every app on the released image; reach for the lifecycle flags against a
> server image that already carries the fix (see *Advanced* in the vm-e2e skill).

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

**TLS:** without DNS-01 the VM gets no real Let's Encrypt cert (it isn't reachable
on :80 for HTTP-01), so Traefik serves its **default self-signed cert**.
`bin/vm-web-check` launches Chromium with `ignoreHTTPSErrors`, and `hola
bootstrap`'s verify uses `curl -k`. Correct for functional testing; don't ship
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

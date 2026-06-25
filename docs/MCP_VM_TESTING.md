# Disposable-VM testing via MCP (Proxmox + VNC)

This repo's devcontainer is wired so that **Claude Code, running inside the
container**, can drive a disposable Proxmox VM and interact with its GUI over
VNC — for end-to-end and GUI-driven testing — without ever touching the host
shell.

Two MCP servers do the work:

| Server    | Purpose                                                        |
|-----------|----------------------------------------------------------------|
| `proxmox` | Create / start / stop / snapshot / destroy a disposable VM     |
| `vnc`     | Connect to that VM's VNC console and interact with the GUI      |

For **non-GUI** work — setup, package installs, headless/integration tests — use
**SSH** instead (`bin/vm-ssh`). SSH needs no MCP server: Claude Code already has a
shell, so it just runs `ssh` over the private network. Reach for VNC only when you
genuinely need the GUI (installers, desktop apps, BIOS); SSH is faster and gives
real stdout/exit codes.

Both are **already-running services** you point the container at (over the
private management network or a tunnel). This repo adds the *client* wiring:
`.mcp.json`, env plumbing, and `bin/` helpers. Nothing here exposes Proxmox or
VNC to the public internet, and **no secrets are committed**.

---

## How it fits together

```
┌─ devcontainer (Claude Code runs here) ──────────────────────────────┐
│                                                                     │
│  bin/vm-*  ─────────────────────────► Proxmox REST API ──► VM       │
│  (lifecycle: create/start/snapshot/destroy — no MCP needed)         │
│                                                                     │
│  bin/vm-ssh / hola bootstrap ──(ssh + ephemeral key)──► VM (CLI)    │
│                                                                     │
│  .mcp.json ─► vnc MCP (stdio, @hrrrsn/mcp-vnc) ─► 127.0.0.1:5900    │
│                                       └─(ssh tunnel)─► VM VNC (GUI)  │
│  .mcp.json ─► proxmox MCP (HTTP, OPTIONAL — bin/vm-* already cover)  │
└─────────────────────────────────────────────────────────────────────┘
        ▲ secrets from .devcontainer/mcp.env  OR  host env (containerEnv)
```

- **`bin/vm-*`** talk to the Proxmox REST API directly — VM lifecycle, scriptable
  and CI-friendly, with a `--dry-run` smoke test that proves the wiring without
  any infrastructure. The **proxmox MCP server is therefore optional**.
- **SSH** (`bin/vm-ssh`, and `hola bootstrap --host`) handles setup, installs, the
  CLI bootstrap, and headless tests — no MCP, just `ssh` over the private network.
- **The `vnc` MCP server** runs *in-container* as a stdio subprocess
  (`@hrrrsn/mcp-vnc` via `npx`) and is the one essential MCP piece — it's how
  Claude drives the VM's GUI/browser. `bin/vm-vnc-tunnel` forwards the VM's VNC
  to `127.0.0.1:5900` over SSH so nothing is exposed.
- **The `vm-e2e` skill** (`.claude/skills/vm-e2e/`) ties it together: create →
  bootstrap the CLI → verify → drive the browser → teardown.

---

## One-time setup

0. **Build the VM template** (on the Proxmox host, not the devcontainer). Copy
   `bin/proxmox-build-template` to the host and run it as root (needs Proxmox VE 8+
   and `libguestfs-tools`). It bakes in cloud-init, the QEMU guest agent, Docker,
   and a sudo/docker user — everything the flow depends on:

   ```bash
   # headless template (CLI bootstrap / SSH testing):
   ./proxmox-build-template --id 9000
   # desktop template (adds XFCE + Firefox + TigerVNC for the browser stage):
   ./proxmox-build-template --id 9001 --desktop --vnc-password '<choose-one>'
   # rehearse without changing anything:
   ./proxmox-build-template --dry-run
   ```

   The baked user (`--user`, default `hola`) must match `VM_SSH_USER` below. See
   `--help` for storage/bridge/sizing flags.

1. **Open the repo in the devcontainer.** Claude Code runs *inside* it.

2. **Provide secrets** one of two ways (both keep secrets out of git):

   - **Env file (per-developer):** run `bin/mcp-setup`. It copies
     `.devcontainer/mcp.env.example` → `.devcontainer/mcp.env` (gitignored);
     fill in the values. **or**
   - **Host environment:** `export` the same variables on your *host* before
     launching the devcontainer. `devcontainer.json`'s `containerEnv` forwards
     them in (`${localEnv:...}`). Good for shared/secret-manager-backed setups.

   Required values are documented inline in `mcp.env.example`. Use a
   **least-privilege Proxmox API token**, never a root password.

3. **Approve the MCP servers.** Project-scoped servers from `.mcp.json` start as
   *pending approval*. In a Claude Code session run `/mcp` and approve `proxmox`
   and `vnc` (or accept the prompt on first use). Verify with:

   ```bash
   bin/mcp-setup          # prints env status + `claude mcp list`
   claude mcp list        # proxmox / vnc should health-check ✓
   ```

---

## The test workflow

### Driven by Claude Code (the intended path)

Ask Claude, in a session inside the devcontainer, to do something like:

> Using the `proxmox` MCP server, clone a VM from template `9000`, start it, and
> wait until it's running. Then use the `vnc` MCP server to connect to its
> console, walk through <the GUI test>, and report what you see. Snapshot the VM
> if anything fails; otherwise destroy it.

Claude will call the MCP tools directly. The `bin/` helpers below are available
to it for the lifecycle steps, and double as the manual/CI path.

### Driven by scripts (manual or CI)

```bash
bin/vm-create                 # clone template -> start; records the new VM as "current"
bin/vm-connect --wait         # wait for boot, print the VNC endpoint for the vnc MCP
# ... run your tests / drive the GUI ...
bin/vm-snapshot --name good   # optional: capture state
bin/vm-destroy                # stop + purge the current VM (asks for confirmation)
```

### SSH into the VM (setup, installs, headless tests)

`bin/vm-create` provisions an **ephemeral per-VM SSH key** by default (when
`VM_SSH_USER` is set): it generates a throwaway `ed25519` keypair and injects the
public key via cloud-init before first boot. The private key lives gitignored
under `.devcontainer/.vm-keys/<vmid>` and is deleted by `bin/vm-destroy`.

```bash
bin/vm-create                 # also injects an ephemeral SSH key via cloud-init
bin/vm-wait-ssh               # block until sshd is reachable
bin/vm-ssh -- sudo apt-get update && sudo apt-get install -y nginx
bin/vm-ssh -- bash -lc 'cd /opt/app && ./run-tests.sh'
bin/vm-ssh                    # interactive shell
bin/vm-destroy                # tears down the VM and its key
```

`bin/vm-test --ssh -- <cmd>` runs the whole lifecycle and executes `<cmd>` *on the
VM* over SSH (instead of locally in the container).

**Requirements:** a **cloud-init-enabled template with the QEMU guest agent**
installed (the agent reports the VM's IP; cloud-init applies the key). Templates
without cloud-init: pass `bin/vm-create --no-ssh` and use VNC, or point
`VM_SSH_HOST`/`VM_SSH_KEY` at a pre-provisioned key. Keys are per-VM and never
leave the container or enter git.

### Bootstrap the hola CLI onto the VM

`bin/vm-wait-ssh` writes an `~/.ssh/config` alias `hola-vm-<vmid>` pointing at the
ephemeral key, so the CLI's own SSH installer works with no extra flags:

```bash
# One-time: generate a real Hola .env (the wizard can't run headlessly).
hola init --out .devcontainer/hola.env          # gitignored; NOT mcp.env

VMID=$(bin/vm-create | tail -1)
bin/vm-wait-ssh --vmid "$VMID"                           # prints the alias: hola-vm-$VMID
hola bootstrap --host "hola-vm-$VMID" --env-file .devcontainer/hola.env
bin/vm-ssh --vmid "$VMID" -- 'cd /opt/hola && docker compose ps'   # verify the stack
```

This is "test the CLI against a real host": `hola bootstrap` installs Hola on the
VM over SSH, exactly as an end user would. Note `--env-file` must be a **rendered
Hola `.env`** (not `mcp.env`). To test the **local** CLI, run the working-tree
binary (`bun --cwd packages/cli src/index.ts bootstrap …`); note it still pulls
the published server/web images — see the `vm-e2e` skill (incl. the advanced
local-image path) for the full both-modes flow.

### Browser/GUI testing via the in-container VNC MCP server

The `vnc` MCP server (`@hrrrsn/mcp-vnc`) runs as a stdio subprocess inside the
container. Point it at the VM's console with an SSH tunnel, then drive the GUI:

```bash
bin/vm-vnc-tunnel             # ssh-forward VM:5900 -> 127.0.0.1:5900
# then use the vnc MCP tools: vnc_screenshot / vnc_click / vnc_type_text / ...
bin/vm-vnc-tunnel --down      # close the tunnel
```

**Requirements:** a desktop + browser + a VNC server (e.g. x11vnc) in the guest on
`VNC_REMOTE_PORT` (default 5900), and `VNC_PASSWORD` set. If the `vnc` server was
spawned before the tunnel came up, reconnect it via `/mcp`.

### The vm-e2e skill (recommended)

`.claude/skills/vm-e2e/` encapsulates the whole loop — create → bootstrap the CLI
→ verify the stack → drive the in-VM browser → snapshot-on-fail / destroy-on-pass
— with a released-vs-local CLI choice. Ask Claude to "run the vm-e2e test" (or
invoke the skill) instead of stitching the steps by hand.

### One-shot end-to-end (and smoke test)

`bin/vm-test` runs the whole lifecycle: create → wait → resolve VNC → run tests →
destroy on success (snapshot + keep on failure with `--keep-on-fail`).

```bash
# Prove the wiring with zero infrastructure (touches nothing):
bin/vm-test --dry-run

# Real run with your integration suite as the VM-targeted test:
bin/vm-test -- bun run test:integration
```

---

## Helper command reference

| Command           | What it does                                              | Destructive |
|-------------------|----------------------------------------------------------|:-----------:|
| `bin/proxmox-build-template` | **(Proxmox host)** build the cloud-init/agent/docker template | no¹ |
| `bin/mcp-setup`   | Scaffold/validate `mcp.env`; list MCP servers            | no          |
| `bin/vm-create`   | Clone template → (start) VM; inject ephemeral SSH key    | no          |
| `bin/vm-connect`  | Wait for boot; resolve/print the VNC endpoint            | no          |
| `bin/vm-wait-ssh` | Block until the VM accepts SSH                           | no          |
| `bin/vm-ssh`      | Run a command (or open a shell) on the VM over SSH       | no          |
| `bin/vm-vnc-tunnel` | SSH-forward the VM's VNC to 127.0.0.1 for the vnc MCP   | no          |
| `bin/vm-snapshot` | Create or `--list` snapshots                             | no          |
| `bin/vm-destroy`  | Stop + purge the VM and its key (confirmation required)  | **yes**     |
| `bin/vm-reap`     | Find + destroy LEAKED `hola-test*` clones (confirms once) | **yes**     |
| `bin/vm-test`     | Full create→test→teardown lifecycle (`--dry-run`, `--ssh`) | yes (teardown) |

¹ `bin/proxmox-build-template` runs on the **Proxmox host** (not the container);
`--force` replaces an existing template VMID, `--destroy --id N` removes one.

**Teardown.** Normal runs self-clean (`vm-test`/the skill destroy on success).
For leaks — a crashed run, lost devcontainer state — `bin/vm-reap` sweeps every
non-template VM named `hola-test*` and destroys it (templates are never touched).
Remove a template itself with `bin/proxmox-build-template --destroy --id <N>` on
the host (or `bin/vm-destroy --vmid <N>` via the API).

Common flags: `--vmid N` (target a specific VM; otherwise the "current" one in
`.devcontainer/.vm-state`), `--dry-run` (print actions, change nothing),
`--yes`/`FORCE=1` (skip the destroy confirmation, e.g. in CI). Run any with
`-h` for full usage.

Every state-changing action is appended to `logs/vm-actions.log` (gitignored).

---

## DNS & TLS for the test VM (no cloud creds)

Hola serves the dashboard at `HOLA_DOMAIN` and apps at `*.HOLA_BASE_DOMAIN` via
Traefik. For a disposable VM you do **not** want real public DNS, ACME-DNS, or
provider credentials. Two creds-free options:

1. **`sslip.io` wildcard (recommended).** Give the VM a **static IP** via cloud-init
   (`VM_IPCONFIG0=ip=10.0.0.50/24,gw=10.0.0.1` in `mcp.env`), then in the Hola
   config use that IP's sslip.io name:
   ```
   HOLA_BASE_DOMAIN=10.0.0.50.sslip.io     # *.10.0.0.50.sslip.io → 10.0.0.50, no DNS setup
   HOLA_DOMAIN=apps.10.0.0.50.sslip.io
   ```
   `<anything>.<ip>.sslip.io` resolves to that IP via public DNS — so both the
   in-VM browser and the container resolve app routes with zero config. Works for
   a fixed IP you choose on the test bridge.
2. **In-VM `/etc/hosts`.** Since the browser runs *inside* the VM, map the few
   hostnames you'll hit (`apps.hola.test`, `<app>.hola.test`) to `127.0.0.1` in the
   guest's `/etc/hosts` and set `HOLA_BASE_DOMAIN=hola.test`. No wildcard, but fine
   when you exercise a known handful of apps.

**TLS:** neither option gets a real Let's Encrypt cert (the VM isn't reachable on
:80 for HTTP-01, and we're avoiding DNS-01). Traefik serves its **default
self-signed cert** — the in-VM browser just accepts the warning, and `hola
bootstrap`'s verify step already uses `curl -k`. That's correct for functional
testing; don't ship these certs anywhere real.

### Testing the ACME flow with the staging CA

If you actually want to exercise cert *issuance* (not self-signed), point Traefik
at Let's Encrypt **staging** so you don't burn production's strict rate limits:

```
ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory
```

But staging only does anything **when a challenge can succeed** — which on a
private test VM means one of:

- **HTTP-01, no creds:** the VM is reachable from the internet on :80 with a real
  domain (sslip.io counts). Per-host certs only (HTTP-01 can't do wildcards).
- **DNS-01:** needs a real domain + provider creds (`ACME_DNS_PROVIDER` +
  `AWS_*`/`CF_*`) — the creds path we otherwise avoid. This is where staging pays
  off most: repeated installs against a real domain would hit prod's per-domain
  weekly cap; staging's limits are ~100× higher.

If you're on the **default creds-free, private-VM, self-signed** path, no ACME
challenge runs at all, so `ACME_CA_SERVER` is a no-op there — staging matters only
once you opt into real issuance. Staging certs are untrusted (browser warning);
start from a fresh `acme.json` when switching CA servers.

### Keeping AWS / DNS-provider creds OUT of the env file

Real wildcard certs on a private host need **DNS-01**, whose provider creds
(`AWS_ACCESS_KEY_ID`, `CF_DNS_API_TOKEN`, …) Traefik reads from the stack's `.env`.
The Hola wizard only prompts for them **when `ACME_DNS_PROVIDER` is `route53`/
`cloudflare`** (`requiredWhen: isRoute53`). So:

- **For tests, leave `ACME_DNS_PROVIDER` unset.** The wizard never asks for AWS
  creds, and your `.devcontainer/hola.env` stays credential-free. Use the sslip.io
  + self-signed path above.
- **If you ever do need DNS-01**, don't bake the creds into the committed test
  `hola.env`. Inject them out-of-band into the VM's `/opt/hola/.env` *after*
  bootstrap (over `bin/vm-ssh`), or pass them as host env Traefik reads — the
  `dns01` overlay already takes `${AWS_ACCESS_KEY_ID:-}` from the environment.

---

## Security model

- **No secrets in git.** `mcp.env` and `.vm-state` are gitignored; only the
  `*.example` template is committed. Host-env injection via `containerEnv` is the
  alternative for secret-manager-backed teams.
- **Least privilege.** Scripts authenticate to Proxmox with an **API token**
  (`PVEAPIToken` header), not a root password. Scope the token to just the
  clone/start/stop/snapshot/delete it needs on the test pool.
- **Private networking.** Point `PROXMOX_*` at the management subnet or a VPN.
  VNC never touches the public internet: `bin/vm-vnc-tunnel` carries it inside an
  SSH tunnel (encrypted, key-auth) to `127.0.0.1`, so only the container can reach
  it. Don't bind the guest's VNC server to a public interface.
- **TLS.** Set `PROXMOX_CACERT` to verify the Proxmox cert. `PROXMOX_TLS_INSECURE=1`
  is lab-only and logs a warning on every call.
- **Disposable + logged.** VMs are clones meant to be thrown away; destructive
  actions require confirmation (or explicit `--yes`/`FORCE=1`) and are audited.
- **Ephemeral SSH keys.** Each VM gets its own throwaway keypair, injected via
  cloud-init and deleted on destroy. No shared key, no password auth, private key
  never leaves the container or enters git (`.devcontainer/.vm-keys/` is ignored).

---

## The MCP servers in `.mcp.json`

- **`vnc`** — runs **in-container** as a stdio subprocess: `npx -y @hrrrsn/mcp-vnc`
  ([github.com/hrrrsn/mcp-vnc](https://github.com/hrrrsn/mcp-vnc)). It speaks raw
  RFB and connects to `VNC_HOST:VNC_PORT` (default `127.0.0.1:5900`, fed by
  `bin/vm-vnc-tunnel`). Tools: `vnc_screenshot`, `vnc_click`, `vnc_move_mouse`,
  `vnc_key_press`, `vnc_type_text`, `vnc_type_multiline`. To use a different VNC
  MCP implementation, swap the `command`/`args` in `.mcp.json`.
- **`proxmox`** — **optional**, configured as streamable-HTTP at `PROXMOX_MCP_URL`.
  The `bin/vm-*` scripts already cover the lifecycle via the REST API, so you can
  leave it blank. If you run a Proxmox MCP server, point Claude at it there (or
  swap in a stdio `command`/`args` entry).

Values come from the container environment (`.devcontainer/mcp.env` or host
passthrough) — never hard-code them.

---

## Troubleshooting

- **Server shows ⏸ pending approval** — approve it via `/mcp` in a session.
- **Health check fails** — check `bin/mcp-setup` output; an `(unset)` URL/token
  means the env didn't reach the container. Re-check `mcp.env` or your host
  exports, then reload the window.
- **`bin/vm-*` say a var is missing** — they read `.devcontainer/mcp.env` and the
  environment; run `bin/mcp-setup` and fill in the Proxmox API section.
- **Want to see what a script would do** — add `--dry-run`.

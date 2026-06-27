---
name: vm-e2e
description: >-
  End-to-end test Hola on a disposable Proxmox VM: spin up a throwaway VM, bootstrap
  the hola CLI onto it over SSH, verify the stack, then check the dashboard with a
  headless browser. Use when asked to e2e/smoke-test the CLI or dashboard against a
  real host, test `hola bootstrap`, or validate the UI. Needs a Proxmox token +
  cloud-init template (see .devcontainer/mcp.env). All steps are --dry-run-able.
---

# Hola end-to-end VM test

Drives a full real-host test from inside the devcontainer using the `bin/vm-*`
helpers (VM lifecycle over the Proxmox REST API) and `bin/vm-web-check` (headless
Chromium against the dashboard URL — no in-VM desktop or VNC). Background:
`docs/MCP_VM_TESTING.md`.

## Pick the mode from the user's request

- **CLI under test**: released (default) vs local working tree.
  - Default → use the installed `hola`; it pulls the **published** images + bundle
    pinned to its version.
  - "test my changes" / "local" → run the **working-tree CLI binary**
    (`bun --cwd packages/cli src/index.ts …`). This tests your CLI/bootstrap code.
    It STILL installs released server/web images — `hola bootstrap` always pulls
    `ghcr.io/try-hola/{server,web}` (it never ships local app code). Testing local
    *server/web image* changes is a separate heavier path (see "Advanced" below).
- **Browser stage**: include it when the request involves the UI/dashboard.
  `bin/vm-web-check` drives headless Chromium from the container against the
  dashboard URL — no extra VM setup. Otherwise stop after CLI/stack verification.

## Preflight (do this first, once)

1. Ensure env is set: run `bin/mcp-setup`. Confirm the Proxmox API vars and
   `VM_TEMPLATE_ID`, `VM_SSH_USER` are non-`(unset)`. If they're missing, STOP and
   tell the user to fill `.devcontainer/mcp.env` — don't guess infra values. If no
   template exists yet, point them at `bin/proxmox-build-template` (run on the
   Proxmox host) — `VM_SSH_USER` must match its baked `--user`.
2. **Hola config exists**: bootstrap needs a pre-rendered Hola `.env`
   (`.devcontainer/hola.env` by default; the wizard can't run headlessly). If it's
   missing, STOP and ask the user to generate it once: `hola init --out
   .devcontainer/hola.env`. Do NOT pass `.devcontainer/mcp.env` here — that's the
   MCP/infra env, not a Hola config. For DNS, use the creds-free test setup: a
   static IP (`VM_IPCONFIG0`) + an `sslip.io` base domain (`HOLA_BASE_DOMAIN=
   <ip>.sslip.io`), and leave `ACME_DNS_PROVIDER` unset so no AWS/provider creds
   are ever written to `hola.env` (self-signed TLS; the verify uses `curl -k`).
   See "DNS & TLS" in docs/MCP_VM_TESTING.md.
3. Sanity-check with no infra: `bin/vm-test --dry-run`. It should exit 0.
4. For the browser stage, ensure Playwright's Chromium is installed (one-time):
   `bun install && bunx playwright install --with-deps chromium`.

## Steps

> Prepend `DRY_RUN=1` (or pass `--dry-run`) to any step to rehearse without
> touching infrastructure. Always run the teardown step, even on failure.

1. **Create + boot the VM** (also injects an ephemeral SSH key via cloud-init):
   ```bash
   VMID=$(bin/vm-create | tail -1)
   ```
2. **Wait for SSH** (writes an `~/.ssh/config` alias `hola-vm-$VMID`):
   ```bash
   bin/vm-wait-ssh --vmid "$VMID"
   ALIAS="hola-vm-$VMID"
   ```
3. **Bootstrap the hola CLI onto the VM.** Use the Hola `.env`
   (`HOLA_ENV_FILE`, default `.devcontainer/hola.env`) — NOT mcp.env. Run
   `--dry-run` first to print the plan, then for real. Pick the CLI per the mode:
   - **Released (default):**
     ```bash
     hola bootstrap --host "$ALIAS" --env-file .devcontainer/hola.env
     ```
   - **Local working tree (`--local`):** run the working-tree CLI directly. Pass an
     ABSOLUTE `--env-file` path — with `--cwd packages/cli`, a relative path resolves
     against `packages/cli`, not the repo root:
     ```bash
     bun --cwd packages/cli src/index.ts bootstrap \
       --host "$ALIAS" --env-file "$PWD/.devcontainer/hola.env"
     ```
   If the working tree's version is ahead of the latest GitHub release, the
   release bundle/images for it won't exist — pin an existing one with
   `--ref cli-vX.Y.Z`.
4. **Verify the stack came up** over SSH (no browser needed):
   ```bash
   bin/vm-ssh --vmid "$VMID" -- 'cd /opt/hola && docker compose ps'
   ```
   Confirm `traefik`, `server`, and `web` are running. `hola bootstrap` also
   prints the admin API key (interactive runs) — capture it from its output.
5. **Browser stage (optional)** — verify the dashboard renders with a headless
   browser, from the container (no in-VM desktop/VNC):
   ```bash
   bin/vm-web-check          # reads URL+key from hola.env; screenshots to logs/web-check
   ```
   It loads the dashboard, signs in with the admin key, asserts the authenticated
   `/apps` view, and exits non-zero on failure. Read the screenshots
   (`logs/web-check/*.png`) and describe what you observe. For deeper UI flows
   (browse the catalog, install an app), extend `bin/lib/web-check.mjs`.
6. **Decide outcome**:
   - **Pass** → tear down: `FORCE=1 bin/vm-destroy --vmid "$VMID"`.
   - **Fail** → preserve for inspection instead of destroying:
     ```bash
     bin/vm-snapshot --vmid "$VMID" --name "failure-<short-reason>"
     ```
     Report the failure, the snapshot name, and `bin/vm-destroy --vmid $VMID` to
     clean up later.

## Shortcuts

- **Deterministic, repeatable e2e suite**: `bin/vm-e2e-suite` runs the whole
  product flow against a fresh VM and asserts each step — create → bootstrap
  (`HOLA_AUTH_MODE=none`) → verify stack → browse catalog → install app → assert
  it's reachable at its subdomain → deployments list → restart → stop → uninstall
  → tear down. Cheap (no Authentik, one light app), `--dry-run`-able,
  `--keep-on-fail` to snapshot a failure. This is the go-to regression test;
  prefer it over hand-driving the steps above. It defaults to **vaultwarden**
  (`auth.mode: none`) because under `HOLA_AUTH_MODE=none` only `auth.mode: none`
  apps deploy — `provisionAuth` runs before `composeUp`, and forward-auth /
  native-oidc apps have no Authentik to provision against (so e.g.
  `--app uptime-kuma` fails under mode=none until the #267 fix ships; the suite
  detects and explains that). Before installing it waits until the server can
  spawn `docker compose` (defeats the docker-spawn `ENOENT` race). Output →
  `logs/vm-e2e-suite/`.
- **Whole-catalog sweep**: `bin/vm-catalog-test` brings up one
  `HOLA_AUTH_MODE=authentik` VM and installs **every** catalog app in turn (one at
  a time), asserting each converges to `running` with its containers up and its
  front door answering — then uninstalls it. Auth-mode-agnostic (accepts a 200 or a
  30x/401 redirect to Authentik). Terse one-line-per-app PASS/FAIL on stdout; full
  per-app logs under `logs/vm-catalog-test/<app>/`. `--apps a,b` / `--skip x` to
  scope, `--memory MB` for heavy apps, `--restart`/`--lifecycle` to also exercise
  the lifecycle (needs a server image carrying the #267 fix — see *Advanced*). The
  per-app checks live in `bin/lib/app-test.sh`, shared with `bin/vm-e2e-suite`.
- **CLI/integration on the VM**: `bin/vm-test --ssh -- <cmd>` runs create →
  wait-ssh → `<cmd>` on the VM → teardown in one shot.
- **Just rehearse the whole flow**: `bin/vm-test --dry-run` or
  `bin/vm-e2e-suite --dry-run`.

## Advanced — testing local server/web *image* changes

`hola bootstrap` always pulls the published `ghcr.io/try-hola/{server,web}` images,
so it does NOT exercise uncommitted server/web code. To test local app images,
don't go through bootstrap for the images — instead:

1. Build locally: `bun run build` then `HOLA_BUILD=1` image builds (see
   `packages/compose/docker-compose.build.yml`), tagging them for a version `vX`.
2. Get them onto the VM without a registry:
   `docker save hola-server:vX hola-web:vX | bin/vm-ssh -- docker load`
   (or push to a registry the VM can pull and pin `HOLA_VERSION=vX`).
3. Bootstrap as usual, then on the VM set `HOLA_VERSION=vX` in
   `/opt/hola/.env` and `cd /opt/hola && ./scripts/up.sh` to run your images.

Only do this when the user explicitly wants to validate server/web changes on the
VM; for CLI/bootstrap testing, the normal `--local` flow above is enough.

## Guardrails

- Never expose Proxmox publicly; it rides the private network. Use a
  least-privilege Proxmox API token.
- `bin/vm-destroy` is destructive and asks for confirmation unless `FORCE=1`/
  `--yes`. Every state change is logged to `logs/vm-actions.log`.
- VMs are disposable — prefer recreating over reusing a dirty VM. Always tear
  down (or snapshot+note) so VMs don't leak on the host. If a run crashed and left
  VMs behind, `bin/vm-reap` destroys every leaked `hola-test*` clone (never
  templates); `--dry-run` first to see what it would remove.

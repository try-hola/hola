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
   MCP/infra env, not a Hola config. For DNS, use the creds-free `sslip.io` setup
   and leave `ACME_DNS_PROVIDER` unset so no AWS/provider creds are ever written to
   `hola.env` (self-signed TLS; the verify uses `curl -k`). See "DNS & TLS" in
   docs/MCP_VM_TESTING.md.

   **`VM_IPCONFIG0` is optional — DHCP works fine.** `vm-create` only sends
   `ipconfig0` when the var is set, so leaving it empty just means the VM takes a
   DHCP lease, and `vm-wait-ssh` resolves the address from the guest agent and

   **"SSH not ready after 180s" on a REUSED VMID is usually a stale host key,
   not a slow boot.** `bin/vm-create` picks the lowest free id, so destroying
   VM 102 and creating another hands you 102 again — with a different host key.
   `.devcontainer/.vm-keys/known_hosts` still has the old one, every `ssh` fails
   the host-key check, and `vm-wait-ssh` reports it as a timeout. Check whether
   port 22 is actually open (`/dev/tcp/<ip>/22`) and try the key by hand; if that
   works, the wait is lying to you. Clear the entry and retry:
   ```bash
   ssh-keygen -R <ip> -f .devcontainer/.vm-keys/known_hosts
   ```
   prints it. A static IP is convenient (you can pre-render `hola.env` once and
   reuse it), not required.

   **The domain must match whatever address the VM actually got, and `hola.env`
   carries FOUR domain keys, not one.** Rewriting only `HOLA_BASE_DOMAIN` leaves
   the dashboard, Traefik and Authentik pointing at the old address and every
   route answers 404 — with no error that names the cause. Rewrite all of them:

   ```bash
   # after vm-wait-ssh reports the IP
   sed -E "s/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\.sslip\.io/${IP}.sslip.io/g" \
     .devcontainer/hola.env > /tmp/hola-vm.env    # HOLA_DOMAIN, HOLA_BASE_DOMAIN,
   chmod 600 /tmp/hola-vm.env                     # TRAEFIK_DASHBOARD_DOMAIN,
                                                  # HOLA_AUTHENTIK_PUBLIC_URL
   ```

   The API lives at `HOLA_DOMAIN` (`apps.<base>`), **not** at the bare
   `HOLA_BASE_DOMAIN` — that one is the suffix for installed apps
   (`<app>.<HOLA_BASE_DOMAIN>`). Probing the base domain for `/api/...` returns
   404 even on a perfectly healthy stack.
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
   It prints the resolved IP — capture it for the domain rewrite in Preflight 2.
   **SSH can go refused again shortly after this succeeds** (cloud-init reboots on
   first boot). If the next step fails with `ssh exit 255`, just re-run
   `bin/vm-wait-ssh` rather than debugging it; anything already `docker load`ed
   survives the reboot.
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

   **Expect `install.sh` to fail on an `HOLA_AUTH_MODE=authentik` VM**, with
   nothing more specific than `Install failed. / install.sh failed (exit 1)`. It is
   usually a health-wait timeout on Authentik's first boot (image pull + database
   migrations), not a real failure. Before treating it as one, SSH in and bring the
   stack up by hand — it normally succeeds:
   ```bash
   bin/vm-ssh --vmid "$VMID" -- 'cd /opt/hola && sudo ./scripts/up.sh'
   ```
   Only investigate if *that* fails too. On `mode=none` VMs (e.g.
   `bin/vm-e2e-suite`) there is no Authentik and this does not arise.
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

1. **Build locally, tagged the way compose expects.** The compose file references
   `ghcr.io/try-hola/{server,web}:${HOLA_VERSION}`, so tag under that exact
   repository — a bare `hola-server:vX` will never be found:
   ```bash
   docker build -f packages/server/Dockerfile -t ghcr.io/try-hola/server:vX .
   docker build -f packages/web/Dockerfile    -t ghcr.io/try-hola/web:vX .
   ```
2. Get them onto the VM without a registry — do this **before** bootstrap, so the
   images are already present when you switch to them:
   ```bash
   docker save ghcr.io/try-hola/server:vX ghcr.io/try-hola/web:vX \
     | bin/vm-ssh --vmid "$VMID" -- 'docker load'
   ```
3. Bootstrap as usual (it pulls the *published* images — that's fine and expected;
   you are about to replace them), then switch the stack onto yours.

   **Setting `HOLA_VERSION` in `/opt/hola/.env` does NOT work.**
   `scripts/_common.sh` reads the `VERSION` file into `HOLA_VERSION` *before*
   compose ever looks at `.env`, so the bundle's own version keeps winning and you
   get the published images with no sign anything was ignored. Write the `VERSION`
   file (and/or pass it in the environment, which always wins):
   ```bash
   bin/vm-ssh --vmid "$VMID" -- \
     'cd /opt/hola && echo vX | sudo tee VERSION >/dev/null &&
      sudo HOLA_VERSION=vX docker compose up -d --force-recreate'
   ```
   **`--force-recreate` is required**, not tidiness: Traefik's routing labels are
   baked onto the containers at creation, so a plain `up -d` that decides nothing
   changed leaves both the old image *and* stale routing labels in place.

   **And every later recreate has to carry `HOLA_VERSION` too.** This is the trap
   that actually bites, because it bites *mid-test*, after you have already
   confirmed you were on your build. Editing `.env` (to flip `HOLA_USE_AUTH`, say)
   and running a bare `sudo docker compose up -d --force-recreate server` resolves
   `${HOLA_VERSION:-latest}` to `latest` and **pulls the published image over your
   build**, silently. The symptom is not an error — it is routes that answered
   correctly ten minutes ago now returning clean 404s in 0-2ms with nothing in the
   log, because you are talking to a release that predates the feature. Diagnosing
   that from the API end is a dead end; the answer is always
   `docker inspect -f '{{.Config.Image}}' hola-server`. Either go through
   `./scripts/up.sh` (which exports `HOLA_VERSION` from the `VERSION` file for you,
   and accepts `--force-recreate` and a service name as arguments) or pass the
   variable explicitly, every single time.

4. **Confirm you are actually running your build** before drawing any conclusion
   from the test — and re-confirm after *every* recreate, not just the first (see
   the trap above). This is the step that makes the whole exercise meaningful:
   ```bash
   bin/vm-ssh --vmid "$VMID" -- \
     'cd /opt/hola && sudo docker compose ps --format "{{.Service}} {{.Image}}"'
   ```
   Run it from `/opt/hola` rather than passing `-f`: the rendered `.env` sets
   `COMPOSE_FILE` (and `COMPOSE_PROFILES`), so an explicit `-f` drops the Authentik
   overlay and reports a different stack than the one running.

Only do this when the user explicitly wants to validate server/web changes on the
VM; for CLI/bootstrap testing, the normal `--local` flow above is enough.

**This path is worth the cost.** It is the only way to exercise server code against
a real catalog, real containers and a real database — and it has caught a defect
that the full unit suite, an adversarial review and green CI all missed, because
unit tests construct manifests directly and never traverse the catalog read path.

## Guardrails

- Never expose Proxmox publicly; it rides the private network. Use a
  least-privilege Proxmox API token.
- `bin/vm-destroy` is destructive and asks for confirmation unless `FORCE=1`/
  `--yes`. Every state change is logged to `logs/vm-actions.log`.
- VMs are disposable — prefer recreating over reusing a dirty VM. Always tear
  down (or snapshot+note) so VMs don't leak on the host. If a run crashed and left
  VMs behind, `bin/vm-reap` destroys every leaked `hola-test*` clone (never
  templates); `--dry-run` first to see what it would remove.

# CLAUDE.md

Guidance for working in this repository.

## What Hola is

Hola is a self-hosted app-deployment platform: a browsable **catalog** of apps that
install as **Docker Compose** stacks, orchestrated by a server and routed by
**Traefik**. Apps become reachable at `<app>.<HOLA_BASE_DOMAIN>`. Optional **SSO**
(Authentik) auto-provisions per-app auth on install.

## Monorepo layout (Bun workspaces, `packages/*`)

- **`server`** — the orchestrator API (Bun). Owns the deploy lifecycle, catalog,
  drafts, Traefik routing, and the auth provisioner. Most logic lives here.
- **`web`** — the SPA dashboard (Vite/React). Single origin: nginx serves it and
  proxies `/api` to the server.
- **`shared`** — types + the compose validator (`@hola/shared/compose-validate`)
  shared across packages.
- **`sdk`** / **`cli`** — typed client and CLI against the server API. The CLI is
  the only thing released as a binary (`cli-release.yml`, on `cli-v*` tags).
- **`compose`** — the production Docker Compose stack (Traefik + web + server,
  plus an optional Authentik profile) and `scripts/install.sh`.

## Commands

- `bun run typecheck` · `bun run lint` · `bun run build` — across all packages.
- `bun run test` — server unit suite + web tests. `bun --cwd packages/server test`
  for server only.
- **Integration tests** (`*.it.ts`) are **excluded** from the default suite and
  **gated on a reachable Docker daemon** (`describe.skipIf(!dockerOk)`). Run via
  `bun run test:integration`. Some boot real Authentik (slow: image pull +
  migrations).
- Always run typecheck + lint + test + build before opening a PR. Note: CI's
  typecheck has caught issues the local run missed after a lint auto-fix — re-run
  typecheck after lint fixes.

## Architecture notes that matter

- **Traefik-only ingress.** Apps have **no host ports**; the server emits Traefik
  file-provider config (`/data/runtime/traefik/dynamic.yml`) and joins each app's
  ingress service to the external `hola` network. The compose **validator rejects
  host ports** and requires pinned image tags.
- **Deploy lifecycle is async.** `createFromDraft`/`promote`/`rollback` enqueue a
  job; the actual `docker compose up` runs later in `RealDeploymentService.runLifecycleJob`.
  Per-deploy work (auth provisioning, env injection) belongs there, not at create time.
- **Services use a Real/Mock pair** registered in `services/simple-factory.ts`
  (test/dev → Mock, production → Real). Follow that convention for new services.
- **Catalog → deploy.** The **only** catalog is the remote one at
  [`try-hola/apps`](https://github.com/try-hola/apps) (the default
  `HOLA_CATALOG_URL`). There is **no bundled/built-in catalog** in this repo —
  `RealCatalogService` fetches the remote `catalog.json`; app compose/manifest
  live in OCI bundles pulled via `oras`. Per-app metadata (incl. the `auth`
  block) comes from the bundle `manifest.json`, not `catalog.json`. The catalog
  is empty when `HOLA_CATALOG_URL` is unset/unreachable (no fake-app fallback).
  `MockCatalogService` (test env) is an empty catalog; tests inject their own
  stub when they need catalog data.
- **Cross-app integration (ADR 0002).** An app declares capabilities in its
  manifest `consumes` array and the server reconciles a generic primitive at
  deploy time — never per-app/format-specific logic. `app-registry` → the server
  writes `registry.json` (installed apps) into the app's data root on app-set
  change (a bundle bolt-on renders it, e.g. Homepage's dashboard). `apps-data` →
  the server injects a **read-only** identity mount of the apps root
  (`materializeCompose` → `compose-mounts.ts`), granting a trusted app (e.g. the
  `backrest` backup app) read access to all app data. `apps-data` is privileged;
  reserve it for trusted catalog apps.
- **Auth/SSO (Authentik).** `ProvisionerService` (`services/core/provisioner.ts`)
  provisions per-app auth at deploy time for three modes declared in the app
  manifest's `auth` block: `native-oidc` (env injection and/or a post-deploy setup
  command for CLI/DB-configured apps like Gitea), `forward-auth` (Traefik gate via
  Authentik's embedded outpost), and `native-ldap` (per-app bind accounts). The
  interface is platform-agnostic (an Authelia+LLDAP backend is tracked in #88). The
  server self-bootstraps a least-privilege scoped token from an admin bootstrap
  token. Authentik is the **default** — `hola init` always sets
  `HOLA_AUTH_MODE=authentik` (a compose profile); `none` remains an internal
  dev/test mode, not an install-time choice.

## Conventions

- **Branch + PR for changes** (don't push to `main`). PRs squash-merge; CI runs on
  PRs targeting `main` only. For stacked work, rebase each branch onto `main` after
  the parent merges (the repo squashes, so stacked branches need `git rebase --onto`).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- PR bodies end with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- Versions across published packages are kept in sync (`web` is intentionally
  `0.0.0`/unversioned).

## Disposable-VM testing (Proxmox)

For end-to-end testing you can drive a **throwaway Proxmox VM** from inside the
devcontainer. VM lifecycle goes through the Proxmox REST API (the `bin/vm-*`
helpers); an optional `proxmox` MCP server is wired in `.mcp.json` but the scripts
cover everything. Use them like this:

- **Lifecycle** — prefer the `bin/` helpers (they also work for CI and have a
  `--dry-run` mode): `bin/vm-create` → `bin/vm-wait-ssh` → run tests →
  `bin/vm-destroy`. `bin/vm-test` runs the whole create→test→teardown loop.
- **SSH for on-VM work** — for setup/installs/CLI bootstrap/tests use `bin/vm-ssh
  -- <cmd>` (and `bin/vm-wait-ssh`). `vm-create` injects an ephemeral per-VM key
  via cloud-init and `vm-wait-ssh` writes a `~/.ssh/config` alias.
- **UI testing is headless** — `bin/vm-web-check` drives Chromium (Playwright)
  from the container against the dashboard URL (login + render assertions +
  screenshots). No in-VM desktop or VNC.
- **Full e2e (CLI + browser)** — the **`vm-e2e` skill** (`.claude/skills/vm-e2e/`)
  runs the whole loop: create VM → `hola bootstrap --host hola-vm-<id>` (the CLI's
  own SSH installer) → verify the stack → `bin/vm-web-check` →
  snapshot-on-fail / destroy-on-pass. Prefer it over hand-stitching the steps.
- **Snapshot, don't lose a failure** — `bin/vm-snapshot` (or `bin/vm-test
  --keep-on-fail`) before destroying when a run fails and you want to inspect it.
- **Destroy is confirmed** — `bin/vm-destroy` requires interactive `yes` (or
  `--yes`/`FORCE=1`); every state change is audited to `logs/vm-actions.log`.
- **Secrets** come from `.devcontainer/mcp.env` (gitignored) or host env — never
  hard-code them; use a least-privilege Proxmox API token. Run `bin/mcp-setup`
  first to scaffold/validate the env and confirm the servers connect.

Full guide: `docs/MCP_VM_TESTING.md`.

## Where to read more

- `docs/MCP_VM_TESTING.md` — disposable-VM (Proxmox) e2e testing workflow.
- `docs/ARCHITECTURE.md` — system design and deployment lifecycle.
- `docs/OPERATIONS.md` — install, recovery, backup, SSO.
- `packages/compose/README.md` — the production stack, catalog, and Authentik setup.
- `docs/adr/` — architecture decision records (e.g. authentication).

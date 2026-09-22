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
- `bun run test` — server, web AND cli suites (`test:server` / `test:web` /
  `test:cli` run one each). The CLI was missing from this gate until #505: it is
  the only package released as a binary, so it was the one with no CI coverage.
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
- **Compose policy is enforced twice (F02).** The validator refuses
  privilege-bearing service keys (host/foreign namespaces, `devices`, `cap_add`,
  `group_add`, widening `security_opt`, `env_file`, `extends`, `volumes_from`,
  `userns_mode`, `sysctls`, `cgroup_parent`, `runtime`, file-backed top-level
  `secrets`/`configs`) and requires bind sources to be **literal** paths under
  `${HOLA_APP_DATA}` — containment is proved against literal segments, so an
  interpolated suffix is unprovable and refused. `privileged` only WARNS: two
  shipped catalog apps (gitea, running-man) run dind sidecars. Then
  `materializeCompose` → `assertResolvedMountsContained` re-checks the
  configuration Compose actually resolved (`composeConfig`) against the app's
  data root plus the platform's own granted mounts, before `composePull`, and
  fails the deploy rather than creating containers. The platform's own
  injections (`hola-docker-proxy`, apps-data, restore-staging) are added
  **after** validation, so validator rules never apply to them — the
  deploy-time gate allows them only when the matching grant was consented to.
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
- **Capability contracts (ADR 0004; cardinality + container-logs in spec 004).**
  A contract names a two-sided integration: a **provider** performs it
  (`provides`), **acceptors** opt in to being a subject (`accepts`). Acceptor
  participation is a **list** — an app with two stateful services declares two
  participations, each with its own `id` and hooks (`backupParticipations()` in
  `@hola/shared/contracts` is the one reader; a legacy singular `backup` block
  normalises to one participation named `default`). A contract has **one
  provider per host**, enforced at `createFromDraft` before any state is
  created (`assertProviderAllowed`); a second install providing an
  already-provided contract is refused (`PROVIDER_EXISTS`), and a legacy pair
  is flagged (`providerConflict`) rather than auto-resolved. Every contract
  declares a **participation mode** — `declared` (`auth@1`, `backup@1`,
  `push@1`) or `implicit` (`container-logs@1`: every non-provider install is a
  subject by virtue of running, nothing to accept). `container-logs@1` is the
  first app-provided **provisioned** contract: on consent, materialisation
  injects a redacting Docker-API proxy sidecar (`hola-docker-proxy`, run from
  the server's own image) plus `DOCKER_HOST` into the provider's compose,
  exposing container list/logs/events and a field-redacted inspect only — never
  the raw socket. Every app container also carries `sh.hola.app`,
  `sh.hola.deployment`, `sh.hola.name` labels (`applyPlatformDefaults`) so a
  collector groups logs by app with no per-app configuration.
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
- **Release channels (ADR 0005).** A catalog `versions[]` entry may carry a
  `channel` (default `stable`) — a catalog-index attribute, not a manifest one.
  A version is eligible on channel `c` iff its own channel is `c` or `stable`
  (`stable` is the floor every channel includes). The channel enters at draft
  creation and rides the finalized manifest onto the deployment; the
  single-instance guard (#246) is per app **and** channel, with the permitting
  reason (`channel` vs `operator-override`) recorded and shown. **Operator
  model (spec 005, ADR 0005 §7).** Discovery of non-stable channels (catalog
  pill, wizard radio, list filter) is gated by a host setting,
  `settings.channels.showPrerelease` (default off), read through one shared
  fail-closed web hook — turning it off never changes what channel an
  installed copy follows. A copy's followed `channel` (the track) and its
  running build's `versionChannel` (derived on read, not persisted) are
  distinct facts shown together; Join/Leave are just the existing `PATCH
  { channel }` behind a confirm dialog (Join requires enrolment, Leave never
  does). A same-app conflict at install time returns a structured
  `ALREADY_INSTALLED` (`details.code`, same `CONFLICT` top-level shape as
  `PROVIDER_EXISTS`) so the wizard/CLI render a choice instead of a
  surface-neutral message the caller has to parse.
- **Restore-on-install (spec 007).** At install, an operator may name an
  existing deployment of the same app on this host as a restore source
  (`CreateDraftRequest.restoreFrom`, catalog path only — install-by-ref
  refuses it, `RESTORE_NOT_SUPPORTED`, since there's no catalog upgrade
  metadata to judge the candidate's version against). The choice is resolved
  and validated once at draft creation (seeding `appEnv` via the existing
  `mergeUpgradeAppEnv` three-case rule when configuration is carried) and
  re-validated at `createFromDraft`, because the candidate may have changed
  since. The restore itself runs inside `runLifecycleJob`, after
  `composePull` and before `composeUp` — never at create time (Constitution
  III): assert the target data root is empty, quiesce and capture the source
  with the existing `backup@1` pre/post hooks, extract into the target
  (root-relative, no intermediate copy), assert the payload landed (a
  post-condition, not a subtree search — this codebase's archives are
  root-relative on both ends), apply the app's declared `discard` paths,
  rewrite the install-identity marker, write pending OIDC credentials (moved
  here from its usual pre-restore position so extraction can't destroy it),
  start only the declared hook's service with `composeUp({ services, wait:
  true })`, and run the restore hook fail-closed. A failed restore fails the
  whole install — no partial-success start. An app declares how it wants to
  be restored per **backup participation** (`restore` block in the bundle
  manifest, reusing `AppBackupHook` verbatim — no second hook format): no
  `restore@1` in `accepts` means not offered; `accepts: ["restore@1"]` with no
  block means a plain file copy is sufficient; a block adds `discard` paths
  (a live database's file-level copy is a smear across the capture window,
  not a snapshot) and a reload hook. `hola install --restore-from <id|latest>`,
  with `--restore-list` reading the same candidates route with no draft
  created; the non-interactive default is always **no restore** — a candidate
  existing is never itself consent to use it. Spec 007 shipped `restore@1` as
  a participation marker with no provider, grant or broker endpoint
  (`CONTRACTS` unchanged) — **superseded by spec 008** below, which promotes
  it to a real, brokered contract now that a provider role and its grant
  machinery exist to act on one.
- **restore@1, the provider half (spec 008).** `restore@1` is a real,
  brokered, app-provided `CONTRACTS` entry (`providerKind: 'app'`): the
  acceptor side is unchanged from spec 007 (the `restore` block, byte-for-byte
  the same manifests), and a new provider side lets a backup provider (e.g.
  Backrest) serve captures of apps that no longer exist on this host — the
  actual disaster-recovery case a local-only restore can't cover. The
  provider consents to a **new, sibling privilege** — `restore-staging`, a
  writable mount of ONE platform-owned scratch directory
  (`HOLA_RESTORE_STAGING_ROOT`, sibling of the apps root, never a descendant)
  — deliberately a new contract ref rather than a second grant bolted onto
  `backup@1`, because a grant's *kind* resolves live from `CONTRACTS` while
  consent is recorded per *ref*: widening an existing ref's grant would
  silently re-privilege every already-consented install (ADR 0006). All
  communication is provider-initiated (the server never calls an app): the
  provider publishes a metadata-only snapshot index
  (`POST /api/contracts/restore/index`, replaced wholesale each publish,
  discarded on uninstall or consent revocation) and polls
  (`GET .../requests`) for restore requests the server queues — each with a
  server-minted destination under the staging root, claimable exactly once
  (`POST .../requests/:id/claim`) and reported complete or failed
  (`POST .../requests/:id/complete`); a claimed-but-unreported request expires
  on a persisted deadline (default 30 min), failing the install rather than
  hanging. `performRestoreOnInstall` splits into **acquisition** (steps 1-4,
  origin-specific: the local path is unchanged; the provider path creates and
  awaits the request, then must LOCATE the app root inside the delivered
  tree — a repository restore tool reproduces absolute paths, unlike this
  codebase's own root-relative archives, so a bounded search refuses
  (`RESTORE_SOURCE_UNLOCATABLE`) rather than guesses on zero or multiple
  matches — and rename-or-copy it into place) and **application** (steps
  5-10, origin-agnostic, reused verbatim from spec 007 — no second restore
  sequence). Candidates gain an origin-independent `candidateId` (a local
  deployment id, or `<providerDeploymentId>:<captureId>`), a `source`
  (`'deployment' | 'provider'`) and a `confidence` (`'marker'` from a read
  identity record, `'path'` inferred from the capture's location) — an
  inferred identity names the **installation** directory, never a catalog app
  id, requires its own acknowledgement, carries no configuration to restore,
  and is never auto-selected even as the only candidate. Restore coverage
  (`judgeRestoreCoverage`) is reported with its **own** vocabulary
  (`'undeclared' | 'copy-back' | 'incomplete' | 'restorable'`), independent of
  and never derived from backup coverage.

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
- **Deterministic regression suites** — `bin/vm-e2e-suite` asserts the whole
  single-app product flow on a `mode=none` VM. `bin/vm-catalog-test` installs
  **every** catalog app on one Authentik VM and verifies each comes up, using the
  shared per-app test in `bin/lib/app-test.sh` (the single source of truth for
  install→verify→[restart→stop]→uninstall). Both emit terse PASS/FAIL to stdout and
  capture per-app detail under `logs/` for drill-down.
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

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/008-restore-provider/plan.md`
<!-- SPECKIT END -->

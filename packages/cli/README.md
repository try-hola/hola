# @hola/cli

Developer- and operator-facing command-line interface (built on [Sade](https://github.com/lukeed/sade)). The CLI talks to the Hola Server over the same REST API used by the web app and SDK — via the typed `@hola/sdk` client and shared route constants/types from `@hola/shared`. It’s optimized for fast iteration on deployment flows, logs, and contract testing.

## How It Fits
- Role: Local tool for developers/operators to interact with the Hola platform from a terminal.
- Interfaces: Calls the Hola Server HTTP API using shared route constants and types from `@hola/shared` (and lightweight helpers in `src/lib/`).
- Use Cases: Quick health checks, listing deployments, triggering actions, tailing logs, and validating drafts.

## Install
Install the standalone `hola` binary (downloads a prebuilt release binary, or builds one with Bun if no release is published yet):

```bash
curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/cli-install.sh | sh
```

To install the latest **pre-release** (e.g. an `-rc.N` build) instead of the latest stable release, pass `--prerelease`:

```bash
curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/cli-install.sh | sh -s -- --prerelease
```

Other selectors: `HOLA_VERSION=cli-v0.7.6-rc.2` pins an exact tag (overrides `--prerelease`); `HOLA_PRERELEASE=true` is equivalent to the flag.

Then point it at your server:
```bash
export HOLA_API_URL=https://<your-hola-domain>   # web origin; proxies /api to the server
export HOLA_TOKEN=<admin-api-key>
hola --help
```

## Usage
- From repo root: `bun --filter @hola/cli dev` (interactive dev)
- Directly in package: `bun --cwd packages/cli dev`
- Built standalone binary: `bun build packages/cli/src/index.ts --compile --outfile hola`

Commands are registered in `src/index.ts` with lazy loaders and implemented under `src/commands/`. Run `hola --help` (or `hola <command> --help`) for the authoritative, always-current list.

## Commands

### Setup
- `hola bootstrap --host user@vm` — **the one-step install.** Walks the setup wizard and installs Hola on the host over SSH. This is all most people need. While the stack comes up it shows a single live progress line, then a table of the running containers (no scrolling compose noise). After install it hands you your credentials: it saves the generated admin API key to a local `hola-<host>.env` (`source` it to use the CLI), and for the dashboard (when you configured a named admin) it **waits for** and prints your one-time SSO password-setup link, or offers to reveal the `akadmin` password once (fallback). SSO provisioning can take several minutes, so it prints the disclaimer and the resume command up front and then waits **indefinitely** — press Ctrl-C anytime and finish later with `hola credentials`. The run's SSH steps share **one multiplexed connection** (OpenSSH `ControlMaster`), so with password auth you're prompted **once** rather than per step (keys/agent remain the recommended, non-interactive path; multiplexing can't help headless/`--json` runs, which have no TTY to prompt on). It falls back to per-step connections automatically where multiplexing isn't available.
- `hola credentials --host user@vm` — retrieve those same credentials later, idempotently: re-save the local `hola-<host>.env` and wait for the SSO password-setup link. Like `bootstrap`, it does **not** time out — it keeps waiting until provisioning completes (Ctrl-C and re-run to resume), and degrades to the akadmin fallback only if the server reports it couldn't provision the link. This is the supported "come back later" path — the CLI never tells you to SSH in and grep logs yourself. Options: `--host`, `--dir`, `--show-password` (reveal the akadmin fallback password when there's no named admin), `--json`.
- `hola init` — *optional.* Just generate a validated `.env` locally (no server/SSH) — for reviewing/editing config before install, keeping it in a secrets manager, reusing it across hosts, or CI. It then offers to hand off to `bootstrap`, and `bootstrap` reuses an init-produced `.env` rather than re-asking. Options: `--out`, `--compose-dir`, `--force`, `--keep-env`, `--skip-checks`, `--json`.
- `hola teardown --host user@vm` — the inverse of `bootstrap`. **Destructive**: stops/removes the platform + app containers, the `hola` network, named volumes (incl. the Authentik DB), and the data/install directories. Requires typing the host to confirm (unless `--yes`). `--keep-data` stops containers but preserves volumes and directories; `--images` also removes the `ghcr.io/try-hola/*` images. The Let's Encrypt cert store (`traefik/acme/`) is **kept by default** so a teardown→bootstrap cycle reuses the existing wildcard cert instead of re-requesting it (which quickly hits LE rate limits); pass `--include-certs` to wipe it too. Options: `--host`, `--dir`, `--keep-data`, `--images`, `--include-certs`, `--yes`/`-y`, `--dry-run`, `--json`.

### Catalog & install
- `hola catalog [query]` — browse/search the app catalog. Options: `--category`, `--limit`, `--json`.
- `hola install <appId>` — install a catalog app (draft from catalog → validate → finalize → deploy → watch). Pin a version with `--app-version` or inline as `hola install <appId>@<version>` (defaults to the newest release). `--name` sets the deployment name **and** its subdomain (the app is served at `<name>.<base>`; default `<appId>.<base>`). Most apps are single-instance — a second install is rejected unless the catalog marks the app multi-instance; pass `--allow-multiple` with a distinct `--name` to run a second copy on purpose (e.g. `hola install webtop --name desk-2 --allow-multiple`). Enable an optional service the app declares with `--profile <key>` (repeatable, or comma-separated — e.g. `hola install postiz --profile elasticsearch`); unknown keys are ignored and, when omitted, the app's default profiles apply. A few apps declare a **capability contract role** that needs privileged access across app boundaries — a backup app has to read every other app's data. Those installs are refused until you consent with `--grant <contract@version>` (repeatable, or comma-separated — e.g. `hola install backrest --grant backup@1`); the error names the exact flag to re-run with. Silence is a refusal, never an implied yes, so a scripted install of such an app must pass the flag explicitly. Options: `--app-version`, `--name`, `--set KEY=VALUE` (repeatable), `--profile <key>` (repeatable), `--grant <contract@version>` (repeatable), `--allow-multiple`, `--strict`, `--no-stream`, `--json`.

### Deployments
- `hola deployments` — list deployments. Options: `--status`, `--json`.
- `hola logs <deploymentId>` — print recent logs, or live-tail with `--follow`/`-f` (streams over SSE until Ctrl-C). Options: `--follow`, `--json`.
- `hola stop <deploymentId>` — stop a deployment. Options: `--no-stream`, `--json`.
- `hola restart <deploymentId>` — restart a deployment. Options: `--no-stream`, `--json`.
- `hola rollback <deploymentId>` — roll back to a previous release. Options: `--to <releaseId>` (defaults to the previous release), `--reason <text>`, `--no-stream`, `--json`.
- `hola uninstall <deploymentId>` — **destructive**: stop the deployment and remove its containers, data, and auth. Prompts for confirmation unless `--yes`/`-y`. Options: `--yes`, `--json`.
- `hola app data push <deploymentId> [target] [localPath]` — push a local directory into one of the app's **declared push targets** (its manifest's `push` block), for bulk data too big or too structured for the app's own upload (an ebook library, a media tree, a document archive). Run it with `--list` (or with no target) to see what an app declares. The transfer is **rsync over SSH**, so a re-push after editing a few files locally only sends the delta — that's the whole point of the command. The server resolves the target to an absolute path inside the deployment's data root (the client never guesses Hola's on-disk layout), stops the app if the target declares `quiesce: stop`, and runs the app's declared post-push hook afterwards. A `mode: mirror` target uses rsync `--delete` and **prompts for confirmation** unless `--yes`. Ownership is matched to whatever already owns the target directory, which requires passwordless `sudo` (`sudo -n`) for the SSH user. Options: `--list`, `--host user@server` (required for a push), `--dry-run`, `--yes`/`-y`, `--json`.

Lifecycle commands (`install`/`stop`/`restart`/`rollback`) watch the resulting job and stream its progress unless `--no-stream` is passed, and exit non-zero if the job fails.

## Environment
- `HOLA_API_URL`: API base (default `http://localhost:3001`)
- `HOLA_TOKEN`: Bearer token (optional; adds `Authorization: Bearer <token>`) 

## Development
- Build: `bun --cwd packages/cli build`
- Typecheck: `bun --cwd packages/cli typecheck`

When running against a local server, prefer starting the server in the background and verifying health before testing CLI flows.

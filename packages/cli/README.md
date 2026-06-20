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

Then point it at your server:
```bash
export HOLA_API_URL=https://<your-hola-domain>   # web origin; proxies /api to the server
export HOLA_TOKEN=<admin-api-key>
hola --help
```

## Usage
- From repo root: `bun --filter @hola/cli dev` (interactive dev)
- Directly in package: `bun --cwd packages/cli dev`
- Built standalone binary: `bun build packages/cli/src/index.tsx --compile --external react-devtools-core --outfile hola`

Commands are registered in `src/index.tsx` with lazy loaders and implemented under `src/commands/`. Run `hola --help` (or `hola <command> --help`) for the authoritative, always-current list.

## Commands

### Setup
- `hola bootstrap --host user@vm` — **the one-step install.** Walks the setup wizard and installs Hola on the host over SSH. This is all most people need.
- `hola init` — *optional.* Just generate a validated `.env` locally (no server/SSH) — for reviewing/editing config before install, keeping it in a secrets manager, reusing it across hosts, or CI. It then offers to hand off to `bootstrap`, and `bootstrap` reuses an init-produced `.env` rather than re-asking. Options: `--out`, `--compose-dir`, `--force`, `--keep-env`, `--skip-checks`, `--json`.

### Catalog & install
- `hola catalog [query]` — browse/search the app catalog. Options: `--category`, `--limit`, `--json`.
- `hola install <appId>` — install a catalog app (draft from catalog → validate → finalize → deploy → watch). Options: `--version`, `--name`, `--set KEY=VALUE` (repeatable), `--strict`, `--no-stream`, `--json`.

### Deployments
- `hola deployments` — list deployments. Options: `--status`, `--json`.
- `hola logs <deploymentId>` — print recent logs, or live-tail with `--follow`/`-f` (streams over SSE until Ctrl-C). Options: `--follow`, `--json`.
- `hola stop <deploymentId>` — stop a deployment. Options: `--no-stream`, `--json`.
- `hola restart <deploymentId>` — restart a deployment. Options: `--no-stream`, `--json`.
- `hola rollback <deploymentId>` — roll back to a previous release. Options: `--to <releaseId>` (defaults to the previous release), `--reason <text>`, `--no-stream`, `--json`.
- `hola uninstall <deploymentId>` — **destructive**: stop the deployment and remove its containers, data, and auth. Prompts for confirmation unless `--yes`/`-y`. Options: `--yes`, `--json`.

Lifecycle commands (`install`/`stop`/`restart`/`rollback`) watch the resulting job and stream its progress unless `--no-stream` is passed, and exit non-zero if the job fails.

## Environment
- `HOLA_API_URL`: API base (default `http://localhost:3001`)
- `HOLA_TOKEN`: Bearer token (optional; adds `Authorization: Bearer <token>`) 

## Development
- Build: `bun --cwd packages/cli build`
- Typecheck: `bun --cwd packages/cli typecheck`

When running against a local server, prefer starting the server in the background and verifying health before testing CLI flows.

# @hola/cli

Developer-facing command-line interface built with React + Ink. The CLI talks to the Hola Server over the same REST API used by the web app and SDK. It’s optimized for fast iteration on deployment flows, logs, and contract testing.

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

Commands are organized under `src/commands/` (e.g., `bundle`, `deploy`). The CLI renders TUI screens via Ink components defined in `src/`.

## Environment
- `HOLA_API_URL`: API base (default `http://localhost:3001`)
- `HOLA_TOKEN`: Bearer token (optional; adds `Authorization: Bearer <token>`) 

## Development
- Build: `bun --cwd packages/cli build`
- Typecheck: `bun --cwd packages/cli typecheck`

When running against a local server, prefer starting the server in the background and verifying health before testing CLI flows.

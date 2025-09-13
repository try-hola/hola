# Hola CLI — Design

A React + Ink command-line client for repeated deployments and API testing. This CLI will evolve to cover most web app features while remaining fast and scriptable.

## Goals and requirements

- New monorepo package: `@hola/cli` built with TypeScript, React, and Ink. (implemented)
- Use `@hola/sdk` for API calls (isomorphic, small surface) and reuse `@hola/shared` for API routes, types, and contracts.
- First focus: deployment flows to track Phase 7 server work (draft → validate → finalize → deploy → watch).
- Bun-friendly development; Node-compatible build for `bin` usage. (implemented)
- Clear, scriptable UX with colored output and non-zero exit codes on failure.
- No React/Vite assumptions; CLI is standalone and scriptable.

## Monorepo integration

- Location: `packages/cli`
- Depends on `@hola/shared` and `@hola/sdk` (workspace:*).
- Root scripts (optional follow-up):
  - `dev:cli`: run CLI in dev mode
  - future combined dev runners if useful

## Package scaffold

- package.json (high-level)
  - name: `@hola/cli`
  - type: `module`
  - bin: `{ "hola": "./bin/hola" }`
  - scripts:
    - `dev`: `bun src/index.tsx`
    - `build`: `bun build src/index.tsx --outdir=dist --target=node --format=esm --sourcemap --splitting`
    - `typecheck`: `tsc --noEmit`
    - `lint`: `eslint .`
    - `test`: `vitest run` (later)
  - notes:
    - The bin wrapper (`bin/hola`) applies small Node shims and sets `DEV=false` before importing `dist/index.js` to avoid `react-devtools-core` auto-imports.
    - We externalize `react-devtools-core` and disable DevTools in CLI runtime for stability.
- tsconfig
  - `module`: ESNext, `moduleResolution`: NodeNext, `jsx`: react-jsx, `strict`: true
- Entry points
  - `src/index.tsx` — bootstrap + argv parsing via `sade`; lazy-loads command handlers to avoid loading Ink for `--help`
  - `src/commands/bundle/dev.impl.tsx` — Ink UI for dev session; streams SSE events
  - `src/commands/bundle/validate.ts` — compose/env validation via server ValidationService
  - `src/commands/bundle/deploy.ts` — one-shot deploy skeleton (draft → validate → preflight → finalize)
  - `src/lib/sse.ts` — SSE streaming utilities (dev-session events implemented; job logs planned)
  - (planned) `src/app.tsx` — top-level Ink layout/container
  - (optional) `src/lib/api.ts` — wrapper around `@hola/sdk` (currently using SDK directly)

## Key dependencies

- Runtime: `ink`, `react`, `@hola/sdk` (API), `@hola/shared` (types/constants)
- HTTP: Node fetch (Bun provides `fetch`; for Node, add `undici` if needed)
- CLI parsing: `sade`
- SSE: `eventsource-parser` (for streaming job output)
- Nice-to-haves later: `ink-spinner`, `ink-table`, `ink-text-input`

Ink references (from official README):
- Install: `npm install ink react`
- Render: `render(<App />)`
- Input handling: `useInput`
- Persistent logs: `<Static>`

## Command design (phase 1: deployments)

High-level verb: `deploy`

- `hola deploy run --app-id <id> --version <v> [--env KEY=VALUE ...] [--override <path>] [--no-stream]`
  - Happy path:
    1) Create draft → `POST /api/drafts`
    2) Patch draft → `PATCH /api/drafts/:draftId` (env/overrides)
    3) Validate → `POST /api/drafts/:draftId/validate` (fail fast on errors)
    4) Finalize → `POST /api/drafts/:draftId/finalize`
    5) Deploy/apply/start → per server contract
    6) Stream job logs via SSE until success/failure
  - Output: colored status lines; non-zero exit on failure

Granular (to evolve later):
- `hola deploy draft create|patch|validate|finalize`
- `hola deploy start|restart|stop|rollback`
- `hola deploy watch --job-id <id>`

## UI/UX patterns (Ink)

- Top area: concise status and current step (color-coded `Text`)
- While waiting on network or jobs: optional `ink-spinner`
- Logs: `<Static items={...}>` to render immutable lines above live area
- Keyboard: `useInput` to allow `q`/Ctrl+C to exit; `useApp().exit()` for clean shutdown

## API integration

- Base URL: `HOLA_API_URL` (default `http://localhost:3001`)
- Auth: `HOLA_TOKEN` → `Authorization: Bearer <token>` if set
- SDK-first: call the server using `@hola/sdk`; use `@hola/shared` for route constants and types
- Error model: map unified API errors to terse CLI messages with remediation hints when available

## SSE/job streaming

- Use `eventsource-parser` to read server-sent events line-by-line
- Render each event/log line via `<Static>`
- Fallback plan (later): polling if SSE not available (`--no-stream`)
  - Status: dev-session event streaming implemented in `bundle dev`; job log streaming planned for deploy/watch/logs.

## Build and distribution

- Dev: `bun src/index.tsx` (Bun can run TS directly)
- Build: `bun build` to ESM Node target in `dist/` with `--splitting` to keep Ink/React chunks separate until invoked
- Bin: `bin/hola` wrapper with minimal Node shims (`globalThis.self/window`) and `DEV=false` safeguard; then imports `dist/index.js`
- DevTools: `react-devtools-core` is externalized/disabled by default to avoid runtime issues in pure Node
- Publish: internal workspace usage; optional global install later

## Testing strategy

- Unit: command parsing, API wrappers (mock fetch)
- Ink UI: `ink-testing-library` snapshots of key states (success/error)
- Contract: run against mock server first; later against real flags per docs

## Edge cases & errors

- Server unreachable / health bad → clear message and tip to start server
- Auth required but token missing → instruct to set `HOLA_TOKEN`
- Validation failures → print errors, exit 1
- SSE stream drops → retry brief or fallback to polling (later)

## Milestones

1) Scaffold package + hello Ink app; wire monorepo scripts
2) Implement `deploy run` happy path using mock endpoints; minimal UI
3) Add SSE job streaming with `<Static>` and spinners
4) Expand granular subcommands + tests; refine errors and exit codes

## Acceptance criteria (phase 1)

- `@hola/cli` builds and typechecks in monorepo
- `hola bundle validate` performs server-side validation (`--strict`, `--json` supported)
- `hola bundle dev` creates a dev session and streams events when server feature flag is enabled
- Uses `@hola/shared` for routes and types and `@hola/sdk` for calls
- Clear CLI output with correct exit codes

## Environment variables

- `HOLA_API_URL` (default: `http://localhost:3001`)
- `HOLA_TOKEN` (optional auth)
- `DEBUG` (optional Ink/SDK logs)
- `DEV` is intentionally disabled by the bin wrapper to prevent accidental React DevTools activation in Node CLI

## Current status (Aug 2025)

Implemented:
- CLI package, build pipeline, and bin wrapper with stability shims
- Commands: `bundle validate` (strict/json), `bundle dev` (session + SSE), `bundle deploy` (skeleton)
- SSE helper for dev-session events
- Shared and SDK: additive Phase 7 endpoints (validation.compose, dev sessions, bundles import/register)

In progress / next:
- Deploy job streaming and finalized server-side deploy wiring
- Additional commands (`init`, `pack`, `push`, `logs`, `watch`, `clean`)
- Consistent colorized output and exit codes; richer Ink UI components
- Unit/UI/contract tests

## Future enhancements

- Rich components (tables, progress bars), interactive forms
- Config profiles (YAML) to avoid long flags
- React DevTools integration for Ink (`react-devtools-core`)
- Wider command surface: catalog, jobs, backups, notifications

## Phase 2: bundle developer workflow (fast inner loop)

Purpose: speed up repeated bundle iteration by minimizing round-trips and automating the draft → validate → finalize → deploy cycle with file watching and streaming logs.

New commands (additive; do not break existing):

- `hola bundle init [--path <dir>]`
  - Scaffold a bundle skeleton (compose, env, labels, metadata). Creates deterministic defaults and helpful comments.

- `hola bundle dev [--path <dir>] [--app-id <id>] [--version <v>] [--watch <glob>] [--traefik] [--no-deploy] [--no-stream]`
  - Creates a short-lived “dev session” on the server, watches local files, syncs changes, validates, and (optionally) redeploys automatically.
  - Behavior:
    1) Start dev session → server prepares ephemeral draft area
    2) Initial sync of `--dir` (default cwd) respecting ignore rules (see notes)
    3) Validate draft; if deploy enabled, finalize + deploy and stream events
    4) Watch for file changes; on change: sync delta → revalidate → (re)deploy
    5) Ctrl+C triggers graceful cleanup (server session + local state)
  - Hotkeys during the session: `r`=redeploy, `l`=toggle logs, `o`=open app URL (Traefik), `c`=clear screen, `q`=quit
  - Dev-mode behavior: always perform atomic promote on each change; on health failure auto-rollback to last good release. Where feasible, restart only impacted services (compose diff heuristic) to shorten cycles.

- `hola bundle validate [--path <dir>] [--strict] [--json]`
  - Runs validation using server ValidationService (schema + compose/env/ports/image checks). `--strict` upgrades warnings to failures. `--json` prints the raw validation payload.

- `hola bundle pack [--path <dir>] [--out <file>]`
  - Produces a deterministic bundle artifact compatible with Phase 6. Canonicalizes content and prints the SHA256 digest on success. If implemented server-side, this command can upload sources and request packing on the server.

- `hola bundle push --ref <registryRef> <bundle.tgz>`
  - Pushes the bundle via an ORAS subprocess to a registry (e.g., `ghcr.io/org/app:dev`). Prints the digest and ref on success.

- `hola bundle deploy [--path <dir>] [--app-id <id>] [--version <v>] [--traefik] [--no-stream]`
  - One-shot import → draft → validate → finalize → deploy → watch job. In Traefik mode, validates labels and avoids host ports. Streams job/SSE unless `--no-stream`.

- `hola bundle logs [--deployment-id <id>] [--follow] [--since <duration>]`
  - Streams container/job logs via SSE using the same rendering as `deploy run`.

- `hola bundle watch [--deployment-id <id> | --job-id <id> | --session-id <id>] [--since <duration>] [--no-events] [--no-logs]`
  - Standardized watcher for real-time updates. Subscribes to SSE sources and renders colorized status lines.
  - Defaults to show both deployment/job events and logs; flags can narrow output. Exits non-zero if the watched target ends in failure.

- `hola bundle clean [--session-id <id>] [--all] [--ttl <duration>]`
  - Cleans server-side dev sessions and temp artifacts. `--ttl` specifies retention window for dev artifacts (e.g., `4h`).

Implementation notes:
- File watching: prefer `chokidar` with sane defaults. Ignore: `.git`, `node_modules`, `dist`, `*.log`, and support optional `.holaignore` file.
- SSE: use `eventsource-parser` to stream job and dev-session events; render via `<Static>` for immutable lines plus a small live status area.
- Fallbacks: if developer endpoints are disabled on the server, `bundle dev` degrades to local watch + periodic calls to the Draft/Deployment endpoints.

Server alignment (feature-flagged):
- When available, CLI will call additive dev endpoints (see Phase 7 design):
  - `POST /api/dev/sessions` → create dev session
  - `PATCH /api/dev/sessions/:id/sync` → delta sync (supports full or delta uploads)
  - `POST /api/dev/sessions/:id/deploy` → validate/finalize/deploy; returns jobId
  - `GET /api/dev/sessions/:id/status` and `DELETE /api/dev/sessions/:id`
  - `GET /api/dev/sessions/:id/events` (SSE)
  - Ad-hoc helpers (non-dev): `POST /api/validation/compose`, `POST /api/bundles/import`

Dependencies to add (when implementing):
- `chokidar` for watch, `picomatch` for globs (if needed). Keep runtime small.

Environment variables (CLI):
- `HOLA_API_URL`, `HOLA_TOKEN` (existing)
- `HOLA_DEV_WATCH_GLOB` optional override for default watch patterns
- `HOLA_DEV_IGNORE` additional comma-separated ignore patterns
- `HOLA_ENABLE_DEV_API` feature flag for dev endpoints (server-side)

Acceptance criteria (phase 2):
- `hola bundle dev` creates a session, syncs initial files, validates, and (optionally) deploys, then hot-reloads on file changes.
- Works even when dev endpoints are disabled by falling back to standard Draft/Deployment APIs.
- Clear, colorized output and correct exit codes for validation/deploy failures.

## Examples

```bash
# Scaffold a new bundle skeleton
hola bundle init --path ./bundle

# Validate strictly and print machine-readable output
hola bundle validate --path ./bundle --strict --json

# Pack deterministically and capture the artifact
hola bundle pack --path ./bundle --out ./bundle.tgz

# Push to a registry using ORAS and print digest/ref
hola bundle push --ref ghcr.io/org/app:dev ./bundle.tgz

# One-shot deploy with Traefik validation enabled
hola bundle deploy --path ./bundle --app-id app123 --version 1.2.3 --traefik

# Start a dev session with watch, Traefik, and hotkeys (r/l/o/c/q)
hola bundle dev --path ./bundle --app-id app123 --version dev --watch "src/**" --traefik

# Watch a deployment’s events/logs until it completes
hola bundle watch --deployment-id dep_123

# Tail logs explicitly with since filter
hola bundle logs --deployment-id dep_123 --follow --since 10m

# Clean up all dev sessions older than a TTL
hola bundle clean --all --ttl 4h
```

# Contributing to Hola

Welcome! Hola is a TypeScript monorepo managed with **Bun workspaces**. This
guide covers the development setup, commands, and conventions.

For the system design see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); for
running a deployment see [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Project structure

```
packages/
├── web/       # Vite + React SPA dashboard
├── server/    # Bun HTTP API (owns deployment state, Docker + Traefik)
├── shared/    # API route constants, shared types, Compose validator
├── cli/       # React + Ink CLI (over the SDK)
├── sdk/       # Typed API client
└── compose/   # Production single-host Docker Compose stack
```

## Setting up

Prerequisites: **Bun** matching `.bun-version` (1.3.14).

```bash
git clone https://github.com/try-hola/hola.git
cd hola
bun install
```

## Common commands

All commands run from the repo root unless noted. Root scripts fan out across
workspaces.

```bash
# Run web + server in watch mode
bun run dev
#   web:    http://localhost:5173
#   server: http://localhost:3001 (base path /api)

# Run one side
bun run dev:web
bun run dev:server

# Quality gates (run all before opening a PR)
bun run typecheck     # tsc --noEmit across packages
bun run lint          # eslint across packages
bun run test          # server (bun test) + web (vitest)
bun run build         # build all packages
```

Run a command in a single package with `bun --cwd`:

```bash
bun --cwd packages/server test
bun --cwd packages/web run build
```

> Note: run the test suites via `bun run test` (or the per-package scripts
> below). A bare `bun test` from the repo root would try to collect the web
> package's jsdom/Vitest tests under Bun's runner and fail.

### Testing

```bash
bun run test:server                       # server suite (Bun) — hermetic, mock services
bun run test:web                          # web suite (Vitest)
bun --cwd packages/server test path/to/file.test.ts   # a single server file

# Real-Docker integration + end-to-end smoke (requires a Docker daemon)
bun --cwd packages/server run test:integration
```

Tests are organized by domain under `packages/server/src/__tests__/`
(`auth/`, `deployments/`, `drafts/`, `jobs/`, `routing/`, `contract/`,
`smoke/`, `integration/`, …). Integration tests are named `*.it.ts` and are
**not** collected by the default suite — they run only via the
`test:integration` script and skip explicitly when Docker is unavailable. See
[`packages/server/README-TESTING.md`](packages/server/README-TESTING.md) for the
test tiers and the in-process server harness.

When writing real-service tests, reuse the helpers in
`packages/server/src/__tests__/helpers/` (e.g. `makeRealSystem`,
`setupTestEnvironment`) rather than standing up servers or temp dirs by hand.

## Development workflow

1. Branch: `git checkout -b feat/short-description` (or `fix/…`, `chore/…`,
   `docs/…`).
2. Make focused changes; keep related functionality together and prefer the
   shared types in `@hola/shared` so the API contract stays consistent across
   server, web, SDK, and CLI.
3. Run the full gate: `bun run typecheck && bun run lint && bun run test && bun run build`.
   Linting and type errors must be clean before committing — zero tolerance.
4. Commit with a descriptive, conventional-style message
   (`feat(server): …`, `fix(web): …`, `chore(tests): …`).
5. Push and open a pull request with a clear summary and any verification notes.

## Conventions

- **TypeScript everywhere**, `moduleResolution: bundler` for Vite/Bun
  compatibility.
- **Comments explain _why_**, not _what_. Match the density and style of the
  surrounding code.
- **Shared contract first** — when changing a server endpoint, update the
  `@hola/shared` types in the same change.
- The server exposes OpenAPI at `/api/openapi.json` with interactive docs at
  `/docs`; keep endpoint docs in sync when adding routes.

## Code review

Automated CodeRabbit reviews are currently **disabled** (`.coderabbit.yaml`). If
re-enabled, it auto-reviews PRs and can be summoned on demand with an
`@coderabbitai review` comment. Review configuration lives in `.coderabbit.yaml`.

## Getting help

- Check existing docs and code for patterns.
- Open an issue for larger discussions or design questions.

Thank you for contributing to Hola!

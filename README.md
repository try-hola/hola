# Hola

A modern home lab app deployment platform. Hola helps enthusiasts discover, install, and manage self‑hosted applications on their personal servers with a guided UX, safe customization, and lifecycle management—all from a web dashboard.

This repository is a TypeScript-first monorepo powered by Bun workspaces containing:
- **Web UI**: Vite + React + TypeScript
- **Server API**: Bun + TypeScript with REST API and real-time features
- **Shared**: TypeScript configs and shared types
- **CLI**: Command-line interface for deployment workflows
- **SDK**: TypeScript client library for server API
- **Compose**: Docker Compose stack for local deployment

**Current Status**: Hola runs the supported workflow end to end — catalog →
draft → validate → finalize → deploy → manage — through real Docker Compose
orchestration and Traefik routing, with state that survives restarts. Some
features remain on the roadmap (see [What Hola Does](#what-hola-does)).

## Install the CLI

Install the `hola` command with one line (downloads the prebuilt binary for your
platform from the latest release; builds from source with Bun if none is published):

```bash
curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/cli-install.sh | sh
```

Then set up a server with `hola bootstrap --host user@your-vm`, or point the CLI at an
existing one (`HOLA_API_URL` + `HOLA_TOKEN`). See
[Install (production)](#install-production-single-host) and
[CLI on another machine](#cli-on-another-machine) for details.

Available documentation:
- Architecture overview: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Operations guide (install, deploy, recover): [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- Authentication ADR: [`docs/adr/0001-authentication.md`](docs/adr/0001-authentication.md)
- Production stack: [`packages/compose/README.md`](packages/compose/README.md)
- Contributing guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- UX specification (pre-recovery, historical): [`docs/UX_SPEC.md`](docs/UX_SPEC.md)
- Implementation review (pre-recovery, historical): [`docs/HOLA_REVIEW.md`](docs/HOLA_REVIEW.md)

## What Hola Does

Hola streamlines self‑hosted app deployments for home lab hobbyists, tinkerers, and power users.

**Implemented today:**
- App catalog browsing with search and details
- A guided install wizard: environment-variable editing, optional Docker Compose
  override + additional config/secret file uploads, with strict Compose
  validation and preflight checks
- Deployment lifecycle controls: start / stop / restart / delete, plus rollback
- Traefik-based routing for deployed apps (no host-port publishing)
- Health, logs (live job/log streaming), and status views
- Durable state: drafts, deployments, releases, and routing survive restarts
- Control-plane authentication via an admin API key (see the auth ADR)

**Roadmap (not yet implemented):**
- Notifications for updates/errors/backups
- Scheduled backups and UI-driven restores
- Application SSO via an external identity provider (Traefik forward-auth)

Non-goals (see full PRD for details):
- Not a hosted SaaS; focuses on local/self-hosted environments
- Not targeting enterprise or multi-tenant use cases

## Monorepo Structure

```
.
├── packages/
│   ├── web/       # Vite + React + TS frontend
│   ├── server/    # Bun + TS server (API) with REST and SSE
│   ├── shared/    # Shared TS configs/types  
│   ├── cli/       # Command-line interface
│   ├── sdk/       # TypeScript client library
│   └── compose/   # Docker Compose stack
├── docs/          # architecture, operations, ADRs (+ historical UX spec/review)
├── .bun-version   # Bun version pin
├── package.json   # Bun workspaces root
└── tsconfig.json  # TS project references
```

Key entry points:
- Web entry: [`packages/web/src/main.tsx`](packages/web/src/main.tsx)
- Web app shell: [`packages/web/src/App.tsx`](packages/web/src/App.tsx)
- Server entry: [`packages/server/src/server.ts`](packages/server/src/server.ts)
- Shared types: [`packages/shared/src/index.ts`](packages/shared/src/index.ts)
- CLI entry: [`packages/cli/src/index.tsx`](packages/cli/src/index.tsx)
- SDK entry: [`packages/sdk/src/index.ts`](packages/sdk/src/index.ts)

## Packages Index

- **@hola/web**: React + TypeScript SPA dashboard for managing deployments, jobs/logs, catalog, and settings. See `packages/web` → [README](packages/web/README.md).
- **@hola/server**: Bun-based HTTP API implementing the shared contract, health/readiness, SSE streams, and docs at `/docs`/`/redoc`. See `packages/server` → [README](packages/server/README.md).
- **@hola/shared**: Centralized API route constants and TypeScript models used across server, web, CLI, and SDK. See `packages/shared` → [README](packages/shared/README.md).
- **@hola/cli**: Developer-focused React + Ink CLI for common workflows (deployments, drafts, logs). See `packages/cli` → [README](packages/cli/README.md).
- **@hola/sdk**: Lightweight typed client for programmatic access to the Hola API (Node/scripts/integrations). See `packages/sdk` → [README](packages/sdk/README.md).
- **@hola/compose**: Docker Compose stack wiring Traefik, web, and server for local or single-host setups. See `packages/compose` → [README](packages/compose/README.md).

## Tech Stack

- Runtime/tooling: Bun 1.3.14 (see `.bun-version`)
- Language: TypeScript 6.x
- Frontend: Vite, React, TailwindCSS, React Router
- Server: Bun-native HTTP with real-time SSE
- Linting: ESLint (flat config)
- CI: GitHub Actions with oven-sh/setup-bun

## Environment and Configuration

Web (Vite):
- Dev server: http://localhost:5173
- Proxy: `/api` -> `http://localhost:3001` (config in [`packages/web/vite.config.ts`](packages/web/vite.config.ts))
- Override API base (optional): `VITE_API_BASE_URL`

Server (Bun):
- Default port: 3001
- Base path: `/api`

## Install (production, single host)

Run the server on a host with **Docker + Docker Compose v2 + git** (images build from
source — no registry needed). One command:

```bash
curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/install.sh | sh
```

The installer clones Hola, prompts for your domain settings (or reads `HOLA_DOMAIN`,
`HOLA_BASE_DOMAIN`, `LETSENCRYPT_EMAIL` from the environment), builds and starts the
production stack (Traefik + web + server), and prints the generated admin API key.
Re-running it upgrades an existing install. Full details and operations in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) and [`packages/compose/README.md`](packages/compose/README.md).

Non-interactive example:

```bash
HOLA_DOMAIN=app.example.com HOLA_BASE_DOMAIN=example.com LETSENCRYPT_EMAIL=you@example.com \
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/install.sh)"
```

Point `HOLA_DOMAIN` (and app subdomains under `HOLA_BASE_DOMAIN`) at the host; Traefik
obtains Let's Encrypt certificates automatically. The API is reached through the web
origin (`https://<HOLA_DOMAIN>`); the server port is not published directly.

### CLI on another machine

Install the `hola` command with one line (downloads a prebuilt binary, or builds one with
Bun if no release is published yet):

```bash
curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/cli-install.sh | sh
export HOLA_API_URL=https://<HOLA_DOMAIN>     # the web origin (proxies /api to the server)
export HOLA_TOKEN=<admin-api-key>             # printed by the server installer
hola --help
```

## Getting Started

> For local development. For deploying a real instance see
> [Install (production, single host)](#install-production-single-host) above.

Prerequisites
- Bun installed matching `.bun-version` (1.3.14)
  - Linux/macOS: `curl -fsSL https://bun.sh/install | bash`
  - Windows (PowerShell): `powershell -c "irm bun.com/install.ps1 | iex"`

Install all workspace deps:
```bash
bun install
```

Run both dev servers (root scripts orchestrate workspaces):
```bash
bun run dev
# web:    http://localhost:5173
# server: http://localhost:3001 (base path /api)
```

Run individually:
```bash
# Web
bun run dev:web

# Server  
bun run dev:server
```

Type-check and lint all packages:
```bash
bun run typecheck
bun run lint
```

Run tests:
```bash
bun run test                # Server (Bun) + web (Vitest) suites
bun run test:web            # Web tests only
bun run test:server         # Server tests only

# Real-Docker integration + end-to-end smoke (requires a Docker daemon)
bun --cwd packages/server run test:integration
```

Build:
```bash
bun run build
# or per package:
bun --cwd packages/web run build
```

## Scripts Overview

Root workspace scripts orchestrate common flows:
- `dev`: run web and server in watch mode
- `build`: build all packages
- `typecheck`: tsc --noEmit across packages
- `lint`: eslint across packages
- `test`: run all tests across packages
- `test:web`: web tests using Vitest
- `test:server`: server tests using Bun
- `test:all`: run tests in all packages
- `clean`: clean workspace and reset

Testing utilities:
- `test:env:setup`: start Docker test environment
- `test:env:teardown`: stop Docker test environment  
- `test:env:integration`: run full integration test suite

CI tools:
- `ci:local`: run GitHub Actions locally with act
- `ci:local:dryrun`: dry run of local CI
- `ci:local:full`: full CI suite locally

See per-package scripts:
- Web: [`packages/web/package.json`](packages/web/package.json)
- Server: [`packages/server/package.json`](packages/server/package.json)
- Shared: [`packages/shared/package.json`](packages/shared/package.json)
- CLI: [`packages/cli/package.json`](packages/cli/package.json)
- SDK: [`packages/sdk/package.json`](packages/sdk/package.json)
- Compose: [`packages/compose/package.json`](packages/compose/package.json)


## Development Notes

- TypeScript uses bundler module resolution for Vite/Bun compatibility
- Shared types in `@hola/shared` maintain API contract consistency between web and server
- When changing server endpoints, update shared DTOs to maintain type safety
- Server provides OpenAPI documentation at `/api/openapi.json` with interactive docs at `/docs`
- Use standardized test environment from `helpers/test-environment` for reliable testing
- All linting errors must be fixed before committing - zero tolerance for linting issues

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for workflow, linting, and commit conventions.

## License

See [`LICENSE`](LICENSE).

---

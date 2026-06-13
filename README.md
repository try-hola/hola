# Hola

A modern home lab app deployment platform. Hola helps enthusiasts discover, install, and manage self‑hosted applications on their personal servers with a guided UX, safe customization, and lifecycle management—all from a web dashboard.

This repository is a TypeScript-first monorepo powered by Bun workspaces containing:
- **Web UI**: Vite + React + TypeScript
- **Server API**: Bun + TypeScript with REST API and real-time features
- **Shared**: TypeScript configs and shared types
- **CLI**: Command-line interface for deployment workflows
- **SDK**: TypeScript client library for server API
- **Compose**: Docker Compose stack for local deployment

**Current Status**: 🚀 Core server implementation complete with deployment management, job tracking, and real-time updates.

Available documentation:
- UX specification: [`docs/UX_SPEC.md`](docs/UX_SPEC.md)
- Implementation review: [`docs/HOLA_REVIEW.md`](docs/HOLA_REVIEW.md)
- Contributing guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)

## What Hola Does

Hola streamlines self‑hosted app deployments for home lab hobbyists, tinkerers, and power users. The dashboard provides:
- App catalog browsing with search and details
- A guided install wizard with:
  - Environment variables editing
  - Optional Docker Compose override upload
  - Additional file uploads for config/secrets
  - Advanced options (ports, volumes)
- Deployment lifecycle controls: start/stop/restart/update/uninstall
- Health, logs, and status views
- Notifications for updates/errors/backups
- Backups and restores

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
├── docs/          # UX spec and implementation review
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

## Getting Started

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
bun test                    # All tests
bun run test:web           # Web tests only
bun run test:server        # Server tests only
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

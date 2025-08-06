# Hola

A modern home lab app deployment platform. Hola helps enthusiasts discover, install, and manage self‑hosted applications on their personal servers with a guided UX, safe customization, and lifecycle management—all from a web dashboard.

This repository is a TypeScript-first monorepo powered by Bun workspaces containing:
- Web UI: Vite + React + TypeScript
- Server API: Bun + TypeScript
- Shared: TypeScript configs and shared types

More docs:
- Monorepo guide: [`docs/monorepo.declaration()`](docs/monorepo.md)
- Server plan: [`docs/SERVER_ARCHITECTURE.declaration()`](docs/SERVER_ARCHITECTURE.md)
- Product overview (PRD): [`docs/PRD.declaration()`](docs/PRD.md)
- High-level architecture: [`docs/ARCHITECTURE.declaration()`](docs/ARCHITECTURE.md)

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
│   ├── server/    # Bun + TS server (API)
│   └── shared/    # Shared TS configs/types
├── docs/          # Architecture, server plan, product docs
├── .bun-version   # Bun version pin
├── package.json   # Bun workspaces root
└── tsconfig.json  # TS project references
```

Key entry points:
- Web entry: [`packages/web/src/main.declaration()`](packages/web/src/main.tsx)
- Web app shell: [`packages/web/src/App.declaration()`](packages/web/src/App.tsx)
- Server entry: [`packages/server/src/server.declaration()`](packages/server/src/server.ts)
- Shared types: [`packages/shared/src/index.declaration()`](packages/shared/src/index.ts)

## Tech Stack

- Runtime/tooling: Bun 1.x (see `.bun-version`)
- Language: TypeScript 5.x
- Frontend: Vite, React, TailwindCSS, React Router
- Server: Bun-native HTTP
- Linting: ESLint (flat config)
- CI: GitHub Actions with oven-sh/setup-bun

## Environment and Configuration

Web (Vite):
- Dev server: http://localhost:5173
- Proxy: `/api` -> `http://localhost:3001` (config in [`packages/web/vite.config.declaration()`](packages/web/vite.config.ts))
- Override API base (optional): `VITE_API_BASE_URL`

Server (Bun):
- Default port: 3001
- Base path: `/api`

## Getting Started

Prerequisites
- Bun installed matching `.bun-version`
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
bun --cwd packages/web run dev

# Server
bun --cwd packages/server run dev
```

Type-check and lint all packages:
```bash
bun run typecheck
bun run lint
```

Build:
```bash
bun run build
# or per package:
bun --cwd packages/web run build
```

## Scripts Overview

Root workspace scripts orchestrate common flows:
- dev: run web and server in watch mode
- build: build all
- typecheck: tsc --noEmit across packages
- lint: eslint across packages

See per-package scripts:
- Web: [`packages/web/package.declaration()`](packages/web/package.json)
- Server: [`packages/server/package.declaration()`](packages/server/package.json)
- Shared: [`packages/shared/package.declaration()`](packages/shared/package.json)


## Development Notes

- TypeScript uses bundler module resolution where appropriate for Vite/Bun compatibility.
- Prefer shared types in `@hola/shared` to keep API contracts consistent between web and server.
- When changing server endpoints, update shared DTOs and regenerate types if applicable.
- Align server evolution to the Hono/OpenAPI plan; expose `/openapi.json` and add contract tests in CI as the API grows.

## Contributing

Read [`CONTRIBUTING.declaration()`](CONTRIBUTING.md) for workflow, linting, and commit conventions.

## License

See [`LICENSE.declaration()`](LICENSE).

---

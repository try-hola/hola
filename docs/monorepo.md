# Monorepo (Bun Workspaces)

This repository is organized as a Bun workspaces monorepo.

Structure:
- packages/
  - web/ — Vite + React app (frontend)
  - server/ — Bun REST API (backend)
  - shared/ — shared TypeScript config and types (optional utilities)

Root:
- package.json — Bun workspace root with scripts to build/typecheck/lint all packages
- tsconfig.json — TypeScript project references to packages/web and packages/server
- .bun-version — Bun version pin for local dev
- .github/workflows/ci-bun.yml — CI pipeline (uses oven-sh/setup-bun)

Development

Install dependencies (root):
- bun install

Run both dev servers:
- bun run dev
This runs:
- packages/server on http://localhost:3001
- packages/web (Vite dev) on http://localhost:5173 with a proxy for /api -> http://localhost:3001

Run individually:
- Web: bun --cwd packages/web run dev
- Server: bun --cwd packages/server run dev

Build, Lint, Typecheck (all packages):
- Build: bun run build
- Lint: bun run lint
- Typecheck: bun run typecheck

Web (Frontend)

Start (dev):
- bun --cwd packages/web run dev

Build:
- bun --cwd packages/web run build

Preview:
- bun --cwd packages/web run preview

Vite dev proxy:
- /api -> http://localhost:3001

Server (Backend)

Start (dev):
- bun --cwd packages/server run dev

Base URL and Port:
- http://localhost:3001 with base path /api
- Example endpoints:
  - GET /api/health — Health check
  - GET /api/hello — Example stub

Shared

Contains:
- Base TypeScript config(s)
- Example shared types used by web/server

CI

Workflow:
- Installs Bun
- bun install at root
- Runs lint/typecheck/build across all packages using bun --filter

Local Notes

- Ensure Bun is installed (see .bun-version for the pinned version)
- Environment-specific values for the web can be provided via Vite env files (e.g., VITE_API_BASE_URL), but by default calls go to /api which the dev proxy forwards to the server
- For production, serve the built web dist/ via any static hosting; deploy server separately or together behind a reverse proxy as needed
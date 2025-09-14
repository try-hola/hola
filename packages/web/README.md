# @hola/web

React + TypeScript single-page app (SPA) for the Hola platform. It consumes the REST API defined in `@hola/shared` and implemented by `@hola/server`, providing a modern dashboard for deployments, jobs, logs, catalog browsing, and settings.

## How It Fits
- Role: Primary user interface for operators to manage apps and deployments.
- Contract-first: Uses shared API constants/types to align with the backend.
- Hooks: StrictMode-compatible data-fetching patterns with caching as documented in the workspace guide.

## Development
- Start dev server: `bun --filter @hola/web dev` (or `bun --cwd packages/web dev`)
- Typecheck: `bun --cwd packages/web typecheck`
- Lint: `bun --cwd packages/web lint`
- Tests: `bun --cwd packages/web test`

The app expects the Hola server at `http://localhost:3001` by default. You can override with `VITE_API_BASE_URL`.

## Notable Conventions
- API layer: Import `API` and types from `@hola/shared`.
- Hooks: Follow the StrictMode-safe patterns (stable callbacks, memoized cache keys, SSE handling).
- UI: Tailwind CSS, React Router, and Lucide icons for a consistent, responsive interface.

This package focuses on presentation and UX; all business contracts live in `@hola/shared` and are enforced by the server.

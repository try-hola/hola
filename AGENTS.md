# Repository Guidelines

## Project Structure & Module Organization
- Monorepo managed by Bun workspaces; primary code lives under `packages/`:
  - `web` (Vite + React + TS), `server` (Bun HTTP + TS), `shared` (types/config), `cli` (Ink CLI), `sdk` (typed client), `compose` (Docker Compose stack).
- Docs live in `docs/`. Build artifacts go to each package’s `dist/`.
- Prefer colocating domain code by feature; reuse contracts from `@hola/shared`.

## Build, Test, and Development Commands
- Install: `bun install` (uses `.bun-version`).
- Dev (web + server): `bun run dev`.
- Package dev: `bun --cwd packages/web run dev` or `bun --cwd packages/server run dev`.
- Build all: `bun run build`; per package: `bun --cwd packages/web run build`.
- Lint: `bun run lint`; Type-check: `bun run typecheck`.
- Tests (all): `bun run test`.
  - Web: `bun run test:web` or `cd packages/web && npx vitest`.
  - Server: `cd packages/server && bun test`.

## Coding Style & Naming Conventions
- Language: TypeScript. Indent 2 spaces; include semicolons; prefer single quotes.
- React components: PascalCase files (e.g., `JobTracker.tsx`); hooks `useThing.ts`.
- Server/shared files: kebab-case (e.g., `error-mapping.ts`, `file-logger.ts`).
- Keep public contracts in `@hola/shared`; update consumers when routes/types change.
- Linting: ESLint (flat config in `eslint.config.js`). Fix issues before pushing.

## Testing Guidelines
- Frameworks: Vitest for `web` and `cli`; Bun’s test runner for `server`.
- Organize tests by feature domain (see `packages/*/src/__tests__`).
- Name tests descriptively, assert behavior not implementation. Aim to cover new/changed code.
- Run focused tests locally, e.g.: `bun test packages/server/src/__tests__/health/`.

## Commit & Pull Request Guidelines
- Commits: imperative mood, concise, scoped when helpful (e.g., `server: add SSE retry`).
- Reference issues (`Fixes #123`) and include rationale when non-obvious.
- PRs: clear description, linked issues, test plan/output; screenshots for UI changes; note config or migration impacts.

## Security & Configuration Tips
- Do not commit secrets. Use `.env` files (see `packages/compose/.env.example`).
- Local API base is `/api` on port 3001; override via `VITE_API_BASE_URL` for web when needed.

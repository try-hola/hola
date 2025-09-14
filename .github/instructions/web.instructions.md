---
applyTo: "/packages/web/src/**"
---

# Web Package Instructions

## Purpose
React + TypeScript SPA using Tailwind. Consume APIs via `@hola/shared` with StrictMode-safe hooks and resilient SSE handling.

## Core Rules
- Use shared routes/types from `@hola/shared`; no hardcoded paths.
- Hooks must be StrictMode-compatible: stable `useCallback([])` fetchers, `useMemo` cache keys, and global cache when applicable.
- No `any`; maintain strict typing and separate type imports (`import type { ... }`).
- Tailwind for styles; avoid ad-hoc inline styles except dynamic cases.

## Hook Pattern
- Empty dependency fetcher for simple loads; parameterized hooks derive a stable `cacheKey` with `useMemo` and include it in dependencies.
- Error handling populates `{ loading, error, data }` with friendly messages; never throw from render.
- SSE utilities should expose connection state and implement auto-reconnect with backoff.

## React 18 Testing Environment
- **jsdom Configuration**: Ensure `vitest.config.ts` includes `environment: 'jsdom'` and proper setup files.
- **Async Rendering**: Use `await waitFor()` for component state changes; React 18 renders asynchronously.
- **StrictMode Effects**: Design hooks with stable dependencies; effects execute twice in development.
- **Multiple React Copies**: Workspace dependencies can cause hook failures - ensure single React instance.

## Do
- Centralize API calls in `src/utils` and hooks in `src/hooks`.
- Keep components presentational; pages orchestrate data and actions.
- Use React Testing Library; cover loading/error/empty states.

## Don't
- Put unstable refs in dependency arrays causing loops.
- Duplicate models or bypass shared types.
- Leave `console.log` in production code.

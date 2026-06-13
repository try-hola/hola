---
applyTo: "/packages/web/src/**"
---

# Web Package Instructions

## 🚨 CRITICAL QUALITY GATES - NEVER IGNORE 🚨

**Work is NEVER complete until ALL THREE quality gates pass 100% clean:**

1. **🔴 MANDATORY LINT**: `bun run lint` must pass with ZERO errors/warnings
2. **🔴 MANDATORY TYPECHECK**: `bun run typecheck` must pass with ZERO type errors
3. **🔴 MANDATORY TESTS**: `bun run test` must pass with ZERO failing tests

**Failure to meet these gates will cause CI/CD failures and block deployments. NO EXCEPTIONS.**

## Purpose
React + TypeScript SPA using Tailwind. Consume APIs via `@hola/shared` with StrictMode-safe hooks and resilient SSE handling.

## Core Rules
- Use shared routes/types from `@hola/shared`; no hardcoded paths.
- Hooks must be StrictMode-compatible: stable `useCallback([])` fetchers, `useMemo` cache keys, and global cache when applicable.
- No `any`; maintain strict typing and separate type imports (`import type { ... }`).
- Tailwind for styles; avoid ad-hoc inline styles except dynamic cases.
- **NO DEV API REFERENCES**: Never reference `/api/dev/*` endpoints or `API.dev` routes - these are permanently removed.

## Hook Pattern
- Empty dependency fetcher for simple loads; parameterized hooks derive a stable `cacheKey` with `useMemo` and include it in dependencies.
- Error handling populates `{ loading, error, data }` with friendly messages; never throw from render.
- SSE utilities should expose connection state and implement auto-reconnect with backoff.

## React Testing Environment
- **jsdom Configuration**: Ensure `vitest.config.ts` includes `environment: 'jsdom'` and proper setup files.
- **Async Rendering**: Use `await waitFor()` for component state changes; React renders asynchronously.
- **StrictMode Effects**: Design hooks with stable dependencies; effects execute twice in development.
- **Multiple React Copies**: Workspace dependencies can cause hook failures - ensure single React instance.

## Component & Test Cleanup
- **Deprecated API Cleanup**: When removing API endpoints, delete all related: page components, test files, SSE event handlers.
- **Development Components**: Remove development-specific dashboards and debug pages when APIs are simplified.
- **Test File Removal**: Don't leave orphaned test files testing removed functionality - delete completely.
- **SSE Event Cleanup**: Update SSE event type unions and remove handlers for deprecated event types.

## Do
- Centralize API calls in `src/utils` and hooks in `src/hooks`.
- Keep components presentational; pages orchestrate data and actions.
- Use React Testing Library; cover loading/error/empty states.

## Don't
- Put unstable refs in dependency arrays causing loops.
- Duplicate models or bypass shared types.
- Leave `console.log` in production code.
- **Create development-specific UI components**: Use feature flags on standard components instead.
- **Hardcode `/api/dev/*` endpoints**: All development functionality must use standard API patterns.
- **Test removed API endpoints**: When APIs are deprecated, remove associated tests completely.

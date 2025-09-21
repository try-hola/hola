---
applyTo: "/packages/shared/src/**"
---

# Shared Package Instructions

## 🚨 CRITICAL QUALITY GATES - NEVER IGNORE 🚨

**Work is NEVER complete until ALL THREE quality gates pass 100% clean:**

1. **🔴 MANDATORY LINT**: `bun run lint` must pass with ZERO errors/warnings
2. **🔴 MANDATORY TYPECHECK**: `bun run typecheck` must pass with ZERO type errors
3. **🔴 MANDATORY TESTS**: `bun run test` must pass with ZERO failing tests

**Failure to meet these gates will cause CI/CD failures and block deployments. NO EXCEPTIONS.**

## Purpose
Type-only shared library: API route constants, request/response types, and documentation utilities. Must remain runtime-free and framework-agnostic to keep server and web in lockstep.

## Core Rules
- Types only: no side effects, I/O, timers, or globals. Keep all functions pure and deterministic.
- Zero runtime deps: do not import Node/Bun/browser libs. Use standard TypeScript only.
- API constants: use `as const`; path builders must `encodeURIComponent` dynamic segments and never include undefined values.
- Stability: only additive changes; breaking changes require a migration note in docs exports.
- Exports: separate type exports from values to optimize treeshaking.

## Patterns To Follow
- Route constants live under a single exported `API` object. New endpoints go under the correct namespace (`deployments`, `jobs`, `system`, etc.).
- Prefer string literal unions over `enum` for cross-package compatibility.
- Reuse common helpers: `PageRequest`, `PageResponse<T>`, `ErrorResponse` instead of redefining.
- Error shapes: `{ error: { code: string; message: string; details?: unknown } }` only.
- Docs helpers (OpenAPI/Swagger/ReDoc generators) must be pure and not fetch or read files.
- **API Evolution**: When removing endpoints, delete ALL references: routes, types, SSE events, request/response models.

## Anti-Patterns
- Importing from `@hola/server` or `@hola/web`.
- Adding environment-specific logic or referencing `process` or `Bun`.
- Using `any`; prefer concrete types or `unknown` with type guards.
- **Creating `API.dev` namespace**: Development endpoints are permanently deprecated.
- **Leaving orphaned types**: When removing API endpoints, clean up all associated request/response types and SSE events.

## Quality Gates
- Must compile under strict TS in all packages.
- No references to Node/Bun/DOM globals.
- Keep public surface stable; mark new types and routes as additive.

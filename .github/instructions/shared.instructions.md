---
applyTo: "/packages/shared/src/**"
---

# Shared Package Instructions

## Purpose
Type-only shared library: API route constants, request/response types, and documentation utilities. Must remain runtime-free and framework-agnostic to keep server and web in lockstep.

## Core Rules
- Types only: no side effects, I/O, timers, or globals. Keep all functions pure and deterministic.
- Zero runtime deps: do not import Node/Bun/browser libs. Use standard TypeScript only.
- API constants: use `as const`; path builders must `encodeURIComponent` dynamic segments and never include undefined values.
- Stability: only additive changes; breaking changes require a migration note in docs exports.
- Exports: separate type exports from values to optimize treeshaking.

## Patterns To Follow
- Route constants live under a single exported `API` object. New endpoints go under the correct namespace (`deployments`, `jobs`, `dev`, etc.).
- Prefer string literal unions over `enum` for cross-package compatibility.
- Reuse common helpers: `PageRequest`, `PageResponse<T>`, `ErrorResponse` instead of redefining.
- Error shapes: `{ error: { code: string; message: string; details?: unknown } }` only.
- Docs helpers (OpenAPI/Swagger/ReDoc generators) must be pure and not fetch or read files.

## Anti-Patterns
- Importing from `@hola/server` or `@hola/web`.
- Adding environment-specific logic or referencing `process` or `Bun`.
- Using `any`; prefer concrete types or `unknown` with type guards.

## Quality Gates
- Must compile under strict TS in all packages.
- No references to Node/Bun/DOM globals.
- Keep public surface stable; mark new types and routes as additive.

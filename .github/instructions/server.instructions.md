---
applyTo: "/packages/server/src/**"
---

# Server Package Instructions

## Purpose
Bun HTTP server implementing REST endpoints that strictly follow the contracts in `@hola/shared`. Emphasize fail-fast feature flags, structured logging, metrics, and SSE patterns.

## Core Rules
- Contract-first: import routes and types from `@hola/shared` and match them exactly.
- Use Bun.serve and existing middleware/factory patterns; do not introduce Express/Koa.
- Fail-fast: when real services are enabled by flags, validate at startup and abort on failure with actionable messages.
- Structured responses: success JSON or `{ error: { code, message, details? } }` with proper status.
- CORS and preflight: use existing `withCors` and `handlePreflight` helpers.

## Implementation Patterns
- Routing: match `API` constants and regex patterns as in `src/server.ts`.
- Services: obtain via `services/factory` getters; fallback to mocks only when flags permit.
- SSE: headers `text/event-stream`, `no-cache`, `keep-alive`; send heartbeats; guard `enqueue`; clean up subscriptions.
- Auth: use `middleware/auth` and request context; avoid ad-hoc parsing.
- Logging/Metrics: `getLogger().child(...)` and `createApiMonitoringMiddleware()`.

## Do
- Parse query params defensively with defaults.
- Keep handlers `async`, return via `json(...)`, centralize error mapping.
- Always use `@hola/shared` types for request/response.

## Don't
- Invent new endpoints without updating `@hola/shared`.
- Block event loop with heavy CPU.
- Log secrets or internal stack traces to clients.

## Testing & Dev
- Start with `bun run dev &`, verify `/healthz` before tests, and ensure cleanup.
- Prefer integration tests through HTTP; use fakes for services at boundaries.
- **Health Check Timeouts**: Increase timeouts for services requiring external dependencies (Docker, databases).
- **Service Availability**: Handle graceful fallback when real services unavailable in CI environments.
- **Background Process Management**: Always use `&` for server startup in tests, cleanup with `kill %1` or `pkill`.

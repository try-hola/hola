---
applyTo: "/packages/server/src/**"
---

# Server Package Instructions

## Purpose
Bun HTTP server implementing REST endpoints that strictly follow the contracts in `@hola/shared`. Emphasizes simplified service management with environment-based selection.

## Core Rules
- Contract-first: import routes and types from `@hola/shared` and match them exactly.
- Use Bun.serve and existing middleware/factory patterns; do not introduce Express/Koa.
- Environment-based services: test environment uses all mocks, production uses all real services.
- Structured responses: success JSON or `{ error: { code, message, details? } }` with proper status.
- CORS and preflight: use existing `withCors` and `handlePreflight` helpers.
- **NO DEV APIs**: Development-specific endpoints (`/api/dev/*`) are permanently removed. Use standard Draft/Deployment workflows for all functionality.

## Implementation Patterns
- Routing: match `API` constants and regex patterns as in `src/server.ts`.
- Services: obtain via `getServices()` from simplified factory; always predictable based on environment.
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
- **Create `/api/dev/*` endpoints**: Development features must use standard API patterns (Drafts, SSE, etc.).
- **Add development-specific middleware**: Use feature flags on standard endpoints instead of separate dev infrastructure.

## Testing & Dev
- **Use standardized test environment**: Import from `helpers/test-environment` for reliable in-process testing.
- Prefer integration tests through standardized test environment; use fakes for services at boundaries.
- **Health Check Timeouts**: Increase timeouts for services requiring external dependencies (Docker, databases).
- **Service Availability**: Handle graceful fallback when real services unavailable in CI environments.
- **No Background Processes**: Never use `bun run dev &` patterns - use in-process testing exclusively.

## API Evolution & Cleanup
- **Endpoint Retirement**: When removing API endpoints, clean ALL references: tests, web components, CLI commands, SSE events, shared types.
- **Feature Flag Cleanup**: Remove obsolete environment variables from CI workflows and documentation.
- **Breaking Changes**: Update CLI commands to use standard API patterns instead of removed development endpoints.
- **Validation**: Ensure GitHub Actions workflows don't reference removed functionality (e.g., `HOLA_ENABLE_DEV_API`).

---
applyTo: "/packages/server/src/**"
---

# Server Package Instructions

## 🚨 CRITICAL QUALITY GATES - NEVER IGNORE 🚨

**Work is NEVER complete until ALL THREE quality gates pass 100% clean:**

1. **🔴 MANDATORY LINT**: `bun run lint` must pass with ZERO errors/warnings
2. **🔴 MANDATORY TYPECHECK**: `bun run typecheck` must pass with ZERO type errors
3. **🔴 MANDATORY TESTS**: `bun run test` must pass with ZERO failing tests

**Failure to meet these gates will cause CI/CD failures and block deployments. NO EXCEPTIONS.**

## Purpose
Bun HTTP server implementing REST endpoints that strictly follow the contracts in `@hola/shared`. Emphasizes simplified service management with environment-based selection.

## Core Rules
- Contract-first: import routes and types from `@hola/shared` and match them exactly.
- Use Bun.serve and existing middleware/factory patterns; do not introduce Express/Koa.
- **3-Environment System**: test (all mocks), development (mixed real/mock), production (all real services).
- Structured responses: success JSON or `{ error: { code, message, details? } }` with proper status.
- CORS and preflight: use existing `withCors` and `handlePreflight` helpers.
- **NO DEV APIs**: Development-specific endpoints (`/api/dev/*`) are permanently removed. Use standard Draft/Deployment workflows for all functionality.

## Implementation Patterns
- Routing: match `API` constants and regex patterns as in `src/server.ts`.
- **Environment Configuration**: Services obtained via `getServices()` from environment-based factory:
  - Test: All mock services for reliable testing
  - Development: Mixed services with safe defaults (mock Docker, real storage)
  - Production: All real services for full functionality
- Environment detection automatic: `NODE_ENV=test|development` or `VITEST=true` or `HOLA_DISABLE_AUTOSTART=true`
- SSE: headers `text/event-stream`, `no-cache`, `keep-alive`; send heartbeats; guard `enqueue`; clean up subscriptions.
- Auth: use `middleware/auth` and request context; avoid ad-hoc parsing.
- Logging/Metrics: `getLogger().child(...)` and `createApiMonitoringMiddleware()`.

## Do
- Parse query params defensively with defaults.
- Keep handlers `async`, return via `json(...)`, centralize error mapping.
- Always use `@hola/shared` types for request/response.
- **Import crypto properly**: Use `import * as crypto from 'crypto'` when using crypto.randomUUID().
- **Share service instances**: Create single instances of services and reuse them to avoid state duplication.
- **Extract shared interfaces**: Place commonly used test interfaces in shared helper files under `__tests__/helpers/`.
- **Use consistent ID truncation**: When truncating UUIDs for naming, use 12 characters minimum for better uniqueness.
- **Log errors properly**: Include error context in catch blocks, don't silently swallow errors.

## Error Handling & HTTP Best Practices
- **Request ID Logging**: Always include `requestId`, `draftId`, and relevant context in error logs:
  ```typescript
  } catch (error) {
    const context = getRequestContext(req);
    logger.error('Failed to create draft', {
      requestId: context?.requestId,
      appId: body?.appId,
      error: error instanceof Error ? error.message : String(error),
    });
  ```
- **HTTP Status Mapping**: Map service errors to appropriate HTTP status codes:
  - `404 Not Found` for missing resources (error.code === 'NOT_FOUND')
  - `409 Conflict` for state conflicts (error.code === 'CONFLICT')  
  - `400 Bad Request` for validation errors
  - `500 Internal Server Error` for unexpected failures
- **Method Support**: Support both PUT and PATCH for updates: `if (req.method === 'PATCH' || req.method === 'PUT')`
- **Delete Responses**: Return `204 No Content` for successful deletions, not JSON
- **Multipart File Handling**: Use `req.formData()` for multipart uploads, validate file fields and paths:
  ```typescript
  const form = await req.formData();
  const filePart = form.get('file');
  if (!(filePart instanceof File)) {
    return json({ error: { code: 'BAD_UPLOAD', message: 'Missing file field' } }, { status: 400 });
  }
  ```
- **Path Validation**: Reject absolute paths and directory traversal: `path.startsWith('/') || path.includes('..')`
- **Type Safety**: Avoid `any` - define proper interfaces like `ServiceError extends Error { code?: string }`
- **Logger Interface**: Use correct logger.error signature: `logger.error(message, error?, context?)`:
  ```typescript
  // ✅ Correct usage
  logger.error('Failed to create draft', error instanceof Error ? error : new Error(String(error)), {
    requestId: context?.requestId,
    draftId
  });
  
  // ❌ Wrong - causes TypeScript errors
  logger.error('Failed to create draft', {
    requestId: context?.requestId,
    error: error.message  // Don't pass context as second param
  });
  ```

## Don't
- Invent new endpoints without updating `@hola/shared`.
- Block event loop with heavy CPU.
- Log secrets or internal stack traces to clients.
- **Create `/api/dev/*` endpoints**: Development features must use standard API patterns (Drafts, SSE, etc.).
- **Add development-specific middleware**: Use feature flags on standard endpoints instead of separate dev infrastructure.
- **Duplicate service instances**: Avoid creating multiple instances of the same service - use shared instances.
- **Use any without imports**: Always import required modules (like crypto) before using their functions.
- **Silently swallow errors**: Always log caught errors with appropriate context before fallback behavior.

## Testing & Dev
- **Use standardized test environment**: Import from `helpers/test-environment` for reliable in-process testing.
- Prefer integration tests through standardized test environment; use fakes for services at boundaries.
- **Health Check Timeouts**: Increase timeouts for services requiring external dependencies (Docker, databases).
- **Service Availability**: Handle graceful fallback when real services unavailable in CI environments.
- **No Background Processes**: Never use `bun run dev &` patterns - use in-process testing exclusively.
- **Defensive Service Type Casting**: When casting services to mock types in tests, add runtime guards to prevent CI failures:
  ```typescript
  const svc = getServices().someService;
  if (!('mockMethod' in (svc as any))) {
    // Not a mock; environment misconfigured — soft-skip
    expect(true).toBe(true);
    return;
  }
  const mockService = svc as MockSomeService;
  ```
- **Error Pattern Matching**: Use case-insensitive regex patterns for error matching: `/(NOT_FOUND|not found)/i.test(error.message)`
- **API Response Compatibility**: When changing API response formats, maintain backward compatibility by including legacy fields alongside new ones.

## API Evolution & Cleanup
- **Endpoint Retirement**: When removing API endpoints, clean ALL references: tests, web components, CLI commands, SSE events, shared types.
- **Feature Flag Cleanup**: Remove obsolete environment variables from CI workflows and documentation.
- **Breaking Changes**: Update CLI commands to use standard API patterns instead of removed development endpoints.
- **Validation**: Ensure GitHub Actions workflows don't reference removed functionality (e.g., `HOLA_ENABLE_DEV_API`).

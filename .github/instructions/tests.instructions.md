---
applyTo: "/packages/**/__tests__/**"
---

# Tests Instructions

## 🚨 CRITICAL QUALITY GATES - NEVER IGNORE 🚨

**Work is NEVER complete until ALL THREE quality gates pass 100% clean:**

1. **🔴 MANDATORY LINT**: `bun run lint` must pass with ZERO errors/warnings
2. **🔴 MANDATORY TYPECHECK**: `bun run typecheck` must pass with ZERO type errors  
3. **🔴 MANDATORY TESTS**: `bun run test` must pass with ZERO failing tests

**Failure to meet these gates will cause CI/CD failures and block deployments. NO EXCEPTIONS.**

## Purpose
Reliable, isolated tests with fakes-first strategy and simplified service management.

## Core Rules  
- Fakes over mocks: simple in-memory fakes implementing same interface in `__tests__/fakes/`.
- Organize by feature; only import `@hola/shared` across packages.
- **Use standardized test environment**: Import from `helpers/test-environment` for reliable in-process testing.
- **Environment-based testing**: Test environment automatically uses all mock services via environment detection.
- **3-Environment System**: test (all mocks), development (mixed), production (all real) - tests always run in test mode.
- No external network calls or background processes.

## React Testing Environment (Web Package)

### Critical Setup Requirements
- **jsdom Environment**: Must be properly configured in `vitest.config.ts` with `environment: 'jsdom'`
- **Setup Files**: Use `setupFiles: ['./src/setupTests.ts']` to configure test environment
- **React Plugin**: Include `@vitejs/plugin-react` with explicit JSX configuration
- **DOM Globals**: Ensure `document` and `window` are available via jsdom setup

### React StrictMode Compatibility
- **Async Rendering**: Use `await waitFor()` for component updates, not synchronous expectations
- **Double Execution**: Effects run twice in StrictMode - design hooks with stable dependencies
- **Hook Dependencies**: Empty `[]` dependencies for basic fetchers, `useMemo` for cache keys with params

### Common React Test Patterns
```typescript
// ✅ Correct async pattern
test('should render component', async () => {
  render(<MyComponent />);
  await waitFor(() => {
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});

// ❌ Incorrect synchronous expectation
test('should render component', () => {
  render(<MyComponent />);
  expect(screen.getByText('Expected Text')).toBeInTheDocument(); // May fail
});
```

## Server Testing Patterns

### Service Health and Startup
- **Health Check Timeouts**: Increase timeout for services that need external dependencies
- **Service Mocking**: Use fakes when real services (Docker, databases) unavailable in CI
- **Fail-Fast Testing**: Test that servers fail appropriately when real services enabled but unavailable
- **Background Servers**: Always use `&` for server startup in tests, cleanup with `kill` or `pkill`

### Environmental Dependencies
- **Docker Tests**: May fail in CI without Docker daemon - ensure graceful fallback to mocks
- **External Commands**: Mock system commands (`df`, `/proc/meminfo`) for consistent CI behavior
- **Feature Flags**: Test both real and mock service configurations

### Standardized Test Environment

**Use the standardized test environment for all server tests:**

```typescript
import { setupTestEnvironment, teardownTestEnvironment } from '../helpers/test-environment';

describe('My Tests', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      env: { NODE_ENV: 'test' }
    });
  });

  afterAll(async () => {
    await teardownTestEnvironment();
  });
  
  // Tests run in-process with no background servers
});
```

## Do
- Test error handling and edge cases.
- Use realistic sample data aligned with `@hola/shared` types.
- Keep tests deterministic; avoid arbitrary sleeps.
- Configure jsdom properly for React component tests.
- Use `await waitFor()` for React async rendering.
- **Use standardized test environment**: Always import from `helpers/test-environment` for server tests.
- **Remove tests for deprecated APIs**: When endpoints are removed, delete all associated test files completely.
- **Clean imports**: Only import types and functions that are actually used in tests to avoid linting errors.
- **Use defensive service casting**: Add runtime guards when casting to mock types:
  ```typescript
  const svc = getServices().someService;
  if (!('mockMethod' in (svc as any))) {
    expect(true).toBe(true); // soft-skip
    return;
  }
  const mockService = svc as MockSomeService;
  ```
- **Handle 204 No Content responses**: Update test helpers to handle empty response bodies:
  ```typescript
  // In makeRequest helper
  if (response.status === 204) {
    return { success: response.ok, data: {} as T };
  }
  ```
- **Test relative paths**: Use relative paths in file upload tests: `'config/file.yml'` not `'/config/file.yml'`
- **Use robust error matching**: `/(ERROR_CODE|fallback text)/i.test(error.message)` for case-insensitive patterns.
- **Run linting before committing**: Always run `bun run lint` to catch unused imports and other issues.
- **Extract shared test interfaces**: Place commonly used mock interfaces in `__tests__/helpers/` to avoid duplication.
- **Use proper typing**: Import shared types and interfaces instead of defining locally in each test file.

## Don't
- Mock deep internals; test public APIs.
- Introduce flaky timers; poll for readiness.
- Do not assume synchronous DOM updates in React.
- Use `document` or `window` without proper jsdom setup.
- **Use background processes**: No `bun run dev &`, `kill %1`, or `pkill` patterns.
- **Test removed API endpoints**: Delete tests for `/api/dev/*` and other deprecated endpoints completely.
- **Leave orphaned test files**: When cleaning up APIs, remove ALL related test files, not just failing assertions.
- **Test deprecated SSE events**: Remove SSE test helpers and event handlers for removed functionality.
- **Import unused types**: Avoid importing types that aren't used in tests (causes linting errors).
- **Duplicate test interfaces**: Don't define the same mock interface in multiple test files - extract to shared helpers.
- **Use direct property assignment**: Avoid `(service as any).property = value` - use proper DI or shared instances.

---
applyTo: "/packages/**/__tests__/**"
---

# Tests Instructions

## Purpose
Reliable, isolated tests with fakes-first strategy and consistent structure.

## Core Rules  
- Fakes over mocks: simple in-memory fakes implementing same interface in `__tests__/fakes/`.
- Organize by feature; only import `@hola/shared` across packages.
- **Use standardized test environment**: Import from `helpers/test-environment` for reliable in-process testing.
- No external network calls or background processes.

## React Testing Environment (Web Package)

### Critical Setup Requirements
- **jsdom Environment**: Must be properly configured in `vitest.config.ts` with `environment: 'jsdom'`
- **Setup Files**: Use `setupFiles: ['./src/setupTests.ts']` to configure test environment
- **React Plugin**: Include `@vitejs/plugin-react` with explicit JSX configuration
- **DOM Globals**: Ensure `document` and `window` are available via jsdom setup

### React 18 StrictMode Compatibility
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
      env: { HOLA_USE_REAL_DOCKER: 'false' }
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
- Use `await waitFor()` for React 18 async rendering.
- **Use standardized test environment**: Always import from `helpers/test-environment` for server tests.
- **Remove tests for deprecated APIs**: When endpoints are removed, delete all associated test files completely.

## Don't
- Mock deep internals; test public APIs.
- Introduce flaky timers; poll for readiness.
- Expect synchronous DOM updates in React 18.
- Use `document` or `window` without proper jsdom setup.
- **Use background processes**: No `bun run dev &`, `kill %1`, or `pkill` patterns.
- **Test removed API endpoints**: Delete tests for `/api/dev/*` and other deprecated endpoints completely.
- **Leave orphaned test files**: When cleaning up APIs, remove ALL related test files, not just failing assertions.
- **Test deprecated SSE events**: Remove SSE test helpers and event handlers for removed functionality.

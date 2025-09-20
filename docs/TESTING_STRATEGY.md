# Testing Strategy - Standardized Test Environment

## Overview

The Hola platform uses a **standardized in-process test environment** that eliminates brittle background process management and provides reliable, fast tests across all components.

## Key Principles

### ✅ Reliable Testing
- **In-Process Execution**: Tests run directly within the test process, eliminating external dependencies
- **No Background Processes**: No `bun run dev &`, `kill %1`, or `pkill` patterns
- **Port Conflict Prevention**: No real network ports used during testing
- **Isolated Environment**: Each test file gets fresh, predictable state (server state is reset between tests)

### ✅ Performance Optimized
- **Fast Startup**: < 100ms test environment initialization
- **Concurrent Safe**: Multiple test files can run in parallel
- **Memory Efficient**: Shared server instance per worker, with state reset between tests
- **No Network Overhead**: Direct function calls instead of HTTP round-trips

### ✅ Developer Experience
- **Simple Setup**: `bun test` works out of the box
- **Clear Patterns**: Standardized helpers in `helpers/test-environment`
- **Feature Environments**: Pre-configured setups for common scenarios
- **Reliable Cleanup**: Automatic cleanup prevents test interference

## Implementation

### Test Environment Architecture

```typescript
// Standard test setup pattern
import { setupTestEnvironment, teardownTestEnvironment, makeTestRequest } from '../helpers/test-environment';

describe('Feature Tests', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      env: { HOLA_USE_REAL_DOCKER: 'false' }
    });
  });

  afterAll(async () => {
    await teardownTestEnvironment();
  });
  
  test('should work reliably', async () => {
    const response = await makeTestRequest('/api/health');
    expect(response.status).toBe(200);
  });
});
```

### Feature-Specific Environments

Pre-configured test environments for common scenarios:

- `setupFeatureTestEnvironment('drafts')` - Draft creation and validation
- `setupFeatureTestEnvironment('deployments')` - Deployment management  
- `setupFeatureTestEnvironment('docker')` - Docker integration testing
- `setupFeatureTestEnvironment('auth')` - Authentication testing
- `setupFeatureTestEnvironment('system')` - System monitoring testing

### Test Execution Commands

```bash
# Standard test execution (all components)
bun test

# Server tests only
bun run test:server

# Web tests only  
bun run test:web

# Watch mode for development
bun run test:server:watch
bun run test:web:watch

# Integration testing with Docker Compose (special scenarios only)
bun run test:env:integration
```

## Test Organization

### Directory Structure

```text
packages/
├── server/src/__tests__/
│   ├── helpers/
│   │   └── test-environment.ts    # Standardized test utilities
│   ├── auth/                      # Authentication tests
│   ├── deployments/               # Deployment management tests
│   ├── docker/                    # Docker integration tests
│   └── ...
├── web/src/__tests__/             # React component tests
└── shared/__tests__/              # Type and utility tests
```

### Integration Testing

For scenarios requiring actual service dependencies, Docker Compose is available:

```yaml
# packages/server/test-docker-compose.yml
services:
  test-server:
    ports: ["0:3001"]  # Dynamic port allocation
    environment:
      - NODE_ENV=test
      - HOLA_TEST_MODE=true
```

**Note**: Docker Compose testing should only be used for special integration scenarios. The in-process approach is preferred for most tests.

If Docker is unavailable, either skip these tests (e.g., `it.skip`/tag filters) or rely on helpers that auto‑detect and skip when `HOLA_USE_REAL_DOCKER` is `false`.

## CI/CD Integration

GitHub Actions workflow uses the standardized environment:

```yaml
- name: Test
  env:
    HOLA_USE_REAL_DOCKER: "false"
  run: bun test
```

All tests use the same in-process environment locally and in CI, ensuring consistent behavior.

## Migration from Legacy Patterns

### Legacy Pattern (Deprecated)
```bash
# ❌ Old brittle pattern - DO NOT USE
cd packages/server && bun run dev &
sleep 3
curl http://localhost:3001/healthz
bun test
kill %1
```

### Standardized Pattern (Current)
```typescript
// ✅ New reliable pattern
import { setupTestEnvironment, teardownTestEnvironment } from '../helpers/test-environment';

beforeAll(() => setupTestEnvironment());
afterAll(() => teardownTestEnvironment());
// Tests run in-process with no external dependencies
```

## Benefits Achieved

- ✅ **Zero Background Processes**: No brittle server startup/cleanup patterns
- ✅ **Fast Test Execution**: 73 tests complete in ~150ms
- ✅ **Reliable CI/CD**: Consistent behavior between local and CI environments
- ✅ **Simple Onboarding**: `bun test` works immediately for new developers
- ✅ **Parallel Safety**: Tests can run concurrently without conflicts
- ✅ **Clear Documentation**: Standardized patterns documented and enforced

## Quality Gates

All tests must follow the standardized environment:

1. **Import from helpers**: Use `helpers/test-environment` utilities
2. **No background processes**: Never use `&`, `kill`, or `pkill` patterns
3. **Proper cleanup**: Always call `teardownTestEnvironment()`
4. **Feature flags in setup**: Configure environment variables in test setup
5. **Error handling**: Test both success and error scenarios

This standardized approach ensures reliable, maintainable tests that support the long-term success of the Hola platform.
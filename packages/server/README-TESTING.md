# Server Testing Guide

## Standardized Test Environment

The server uses a **standardized in-process test environment** that eliminates brittle background process management and provides reliable, fast tests.

### Key Benefits

- ✅ **No Background Processes**: Tests run in-process without external servers
- ✅ **No Port Conflicts**: No real network ports used, preventing conflicts  
- ✅ **Fast Execution**: Direct function calls instead of HTTP round-trips
- ✅ **Reliable Cleanup**: Automatic cleanup prevents test interference
- ✅ **Isolated Environment**: Each test gets fresh, predictable state

## Test Environment Setup

All tests should use the standardized test environment helper:

```typescript
import { setupTestEnvironment, teardownTestEnvironment } from '../helpers/test-environment';

describe('My Feature Tests', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      env: {
        NODE_ENV: 'test',
      }
    });
  });

  afterAll(async () => {
    await teardownTestEnvironment();
  });

  test('should work reliably', async () => {
    const response = await fetch('/api/health');
    expect(response.status).toBe(200);
  });
});
```

### Feature-Specific Test Environments

For common testing scenarios, use pre-configured environments:

```typescript
import { setupFeatureTestEnvironment, teardownTestEnvironment } from '../helpers/test-environment';

describe('Draft Management Tests', () => {
  beforeAll(async () => {
    // Pre-configured for draft testing with proper feature flags
    await setupFeatureTestEnvironment('drafts');
  });

  afterAll(async () => {
    await teardownTestEnvironment();
  });
  
  // Your tests here...
});
```

Available feature environments:
- `'drafts'` - Draft creation and validation
- `'deployments'` - Deployment management
- `'docker'` - Docker integration testing  
- `'auth'` - Authentication testing
- `'system'` - System monitoring testing

## Running Tests

### Standard Test Execution

```bash
# Run all tests
cd packages/server
bun test

# Run specific test files
bun test src/__tests__/drafts/management.test.ts

# Run with custom timeout for complex tests
bun test --timeout=30000
```

### Environment Testing

The standard suite uses `NODE_ENV=test`. Real-service integration tests should
instantiate the required service with a temporary `HOLA_DATA_DIR` and skip
explicitly when an external dependency such as Docker is unavailable.

```bash
NODE_ENV=test bun test
```

## Test Organization

### Directory Structure

```text
packages/server/src/__tests__/
├── helpers/
│   └── test-environment.ts      # Standardized test environment
├── auth/                        # Authentication tests
├── deployments/                 # Deployment management tests
├── docker/                      # Docker integration tests
├── drafts/                      # Draft lifecycle tests
├── jobs/                        # Job management tests
└── system/                      # System monitoring tests
```

### Test Patterns

#### Unit Tests
Test individual functions and components:

```typescript
import { someFunction } from '../../services/my-service';

describe('MyService', () => {
  test('should process data correctly', () => {
    const result = someFunction(testData);
    expect(result).toEqual(expectedResult);
  });
});
```

#### Integration Tests  
Test API endpoints and service interactions:

```typescript
import { setupTestEnvironment, teardownTestEnvironment, makeTestRequest } from '../helpers/test-environment';

describe('API Integration', () => {
  beforeAll(async () => { await setupTestEnvironment(); });
  afterAll(async () => { await teardownTestEnvironment(); });

  test('should handle POST requests', async () => {
    const response = await makeTestRequest('/api/deployments', {
      method: 'POST',
      body: JSON.stringify(requestData),
      headers: { 'Content-Type': 'application/json' }
    });
    
    expect(response.status).toBe(201);
  });
});
```

## Advanced Testing Scenarios

### Docker Compose for Integration Testing

For scenarios requiring actual service dependencies, use the test Docker Compose:

```bash
# Start isolated test environment
cd packages/server
docker compose -f test-docker-compose.yml up -d

# Run integration tests
bun test src/__tests__/integration/

# Cleanup
docker compose -f test-docker-compose.yml down -v
```

**Note**: This should only be used for special integration scenarios. The in-process approach is preferred for most tests.

If Docker is unavailable, integration tests must skip explicitly. The standard test environment always uses mock services.

### CI/CD Integration

The GitHub Actions workflow automatically runs tests:

```yaml
- name: Test
  env:
    NODE_ENV: "test"
  run: bun run test
```

All tests use the standardized in-process environment, ensuring consistent behavior between local development and CI.

## Best Practices

### Do ✅

1. **Always use standardized test environment** - Import from `helpers/test-environment`
2. **Set appropriate timeouts** - Use 30+ seconds for complex integration tests
3. **Clean up properly** - Always call `teardownTestEnvironment()` in `afterAll`
4. **Test both success and error cases** - Verify error handling works correctly
5. **Use feature-specific environments** - Leverage pre-configured setups when possible

### Don't ❌

1. **❌ NEVER use background processes** - No `bun run dev &` or `kill %1` patterns
2. **❌ Don't rely on external ports** - Use in-process testing exclusively
3. **❌ Don't skip cleanup** - Always teardown test environment to prevent leaks
4. **❌ Don't hardcode URLs** - Use relative paths that work with test environment
5. **❌ Don't test removed functionality** - Remove tests for deprecated APIs completely

### Error Handling

All test utilities include proper error handling:

```typescript
test('should handle service errors gracefully', async () => {
  // Test error responses
  const response = await makeTestRequest('/api/invalid-endpoint');
  expect(response.status).toBe(404);
  
  const error = await response.json();
  expect(error).toHaveProperty('error');
  expect(error.error).toHaveProperty('code');
  expect(error.error).toHaveProperty('message');
});
```

### Performance Considerations

The in-process test environment provides excellent performance:

- **Fast startup**: No external process spawning (< 100ms)
- **Concurrent safe**: Multiple test files can run in parallel
- **Memory efficient**: Shared server instance across tests
- **No network overhead**: Direct function calls instead of HTTP

## Troubleshooting

### Common Issues

#### Tests fail with "Test server not started"
**Solution**: Ensure `setupTestEnvironment()` is called in `beforeAll()`

#### Port already in use errors
**Solution**: This shouldn't happen with in-process testing. Check for background processes.

#### Tests fail in CI but pass locally
**Solution**: Verify environment variables are consistent and use `NODE_ENV=test` for the standard suite.

#### Memory leaks between tests
**Solution**: Always call `teardownTestEnvironment()` and check for hanging promises.

### Debugging

Enable debug logging for test troubleshooting:

```bash
DEBUG=hola:test bun test
```

### Migration from Old Patterns

If you find tests using old patterns, update them:

```typescript
// ❌ Old brittle pattern
cd packages/server && bun run dev &
sleep 3
curl http://localhost:3001/healthz
bun test
kill %1

// ✅ New standardized pattern  
import { setupTestEnvironment, teardownTestEnvironment } from '../helpers/test-environment';

beforeAll(() => setupTestEnvironment());
afterAll(() => teardownTestEnvironment());
```

## Migration Guide

### Updating Existing Tests

1. **Replace imports**:
   ```typescript
   // Old
   import { setupTestServer, teardownTestServer } from '../utils/bun-server';
   
   // New  
   import { setupTestEnvironment, teardownTestEnvironment } from '../helpers/test-environment';
   ```

2. **Update setup calls**:
   ```typescript
   // Old
   await setupTestServer(3001, { NODE_ENV: 'test' });
   
   // New
   await setupTestEnvironment({ env: { NODE_ENV: 'test' } });
   ```

3. **Use feature environments when possible**:
   ```typescript
   // Instead of manual env setup
   await setupTestEnvironment({ 
     env: { 
       NODE_ENV: 'test'
     } 
   });
   
   // Use pre-configured feature environment
   await setupFeatureTestEnvironment('drafts');
   ```

The standardized test environment ensures reliable, fast tests that work consistently across all development and CI environments.

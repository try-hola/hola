# Server Testing Guide

## Contract Tests

Contract tests verify that the server API matches the expected interface and behavior across different phases of development. These tests run against a real server instance to ensure end-to-end functionality.

### Running Contract Tests

#### Local Development

Contract tests automatically start and stop the server as needed:

```bash
# Run all contract tests
cd packages/server
bun test src/__tests__/phase*.test.ts

# Run specific phase tests
bun test src/__tests__/phase4-contract.test.ts
bun test src/__tests__/phase0-contract.test.ts

# Run with timeout for slower systems
bun test --timeout=60000 src/__tests__/phase*.test.ts
```

#### CI/CD Environment

In CI, the server is started in the background before tests run:

```bash
# Server is started by CI workflow
cd packages/server 
nohup bun run dev > server.log 2>&1 & echo $! > server.pid

# Wait for health check
for i in {1..60}; do
  if curl -sSf http://localhost:3001/healthz > /dev/null; then
    echo "Server is healthy"
    exit 0
  fi
  sleep 1
done

# Run tests
bun test
```

### Test Server Management

Contract tests use the `test-server.ts` utility which provides:

#### Automatic Server Detection
- Tests check if a server is already running on port 3001
- If found, tests use the existing server (common in CI)
- If not found, tests start their own server instance

#### Background Server Management
- Servers are started in background using `Bun.spawn`
- Health checks ensure server is ready before tests proceed
- Automatic cleanup stops servers after tests complete

#### Example Usage

```typescript
import { createTestServer, isServerRunning } from '../utils/test-server';

describe('My Contract Tests', () => {
  let testServer: TestServerManager | null = null;

  beforeAll(async () => {
    // Check if server is already running (e.g., in CI)
    if (await isServerRunning()) {
      console.log('Using existing server for contract tests');
      return;
    }

    // Start server for local testing
    console.log('Starting test server for contract tests');
    testServer = createTestServer();
    await testServer.start();
  }, 30000);

  afterAll(async () => {
    if (testServer) {
      await testServer.stop();
      testServer = null;
    }
  });

  // Your tests here...
});
```

### Environment Variables

Contract tests support feature flags for testing different configurations:

```bash
# Test with real Docker integration
HOLA_USE_REAL_DOCKER=true bun test phase4-contract.test.ts

# Test with development API enabled
HOLA_ENABLE_DEV_API=true bun test phase0-contract.test.ts
```

### Troubleshooting

#### Server Won't Start
1. Check if port 3001 is already in use: `lsof -i :3001`
2. Increase timeout in test configuration
3. Check server logs for startup errors

#### Tests Timeout
1. Ensure server is healthy: `curl http://localhost:3001/healthz`
2. Increase test timeout: `bun test --timeout=60000`
3. Check network connectivity and firewall settings

#### Server Not Cleaning Up
1. Check for hanging processes: `ps aux | grep bun`
2. Kill manually if needed: `pkill -f "bun run dev"`
3. Verify cleanup logic in test afterAll hooks

### Best Practices

1. **Always use the test-server utility** for contract tests that need a server
2. **Set appropriate timeouts** for test suites (30+ seconds for contract tests)
3. **Check server health** before running test assertions
4. **Clean up properly** in afterAll hooks to prevent resource leaks
5. **Test both CI and local scenarios** to ensure compatibility

### Local Development Workflow

```bash
# Standard development workflow
cd packages/server

# Start development server (optional - tests can start their own)
bun run dev &

# Run contract tests (will detect existing server)
bun test src/__tests__/phase4-contract.test.ts

# Stop development server
kill %1
```

### Integration with CI

The CI workflow in `.github/workflows/test.yml` demonstrates the recommended pattern:

1. Start server in background with logging
2. Wait for health check to pass
3. Run all tests including contract tests
4. Upload logs on failure
5. Clean up server process

This ensures consistent behavior between local development and CI environments.
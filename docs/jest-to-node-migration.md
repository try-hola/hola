# Jest to Node.js Test Runner Migration Guide

This document outlines the process for migrating tests from Jest to the built-in Node.js Test Runner.

## Why Migrate?

- **Reduced Dependencies**: The Node.js test runner is built into Node.js v18+, eliminating the need for external testing libraries.
- **Faster Execution**: Native test runner is typically faster than Jest for most test scenarios.
- **Simplified Setup**: No need for complex configuration files or transformers.
- **ECMAScript Modules Support**: Better support for ESM without requiring additional plugins.
- **Reduced Bundle Size**: Removing Jest reduces the overall package size.

## Migration Strategy

1. **Incremental migration**: Convert test files one at a time while maintaining compatibility with both test runners during the transition.
2. **Parallel test execution**: Configure the system to run both Jest and Node.js tests in parallel, ensuring nothing breaks during migration.
3. **File naming convention**: Use `.node.test.ts` extension for tests migrated to Node's test runner, keeping `.test.ts` for Jest tests.

## Setup Environment

1. Create a `test-register.js` file in your project root:

```javascript
// test-register.js
// This file is required to load any necessary hooks before tests run
// For TypeScript support
require('ts-node/register/transpile-only');

// Add global config for tests
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
```

2. Create a `node-test-utils.ts` file to provide properly typed test utilities:

```typescript
/**
 * Test utilities for Node.js test runner
 * 
 * This module provides properly typed test utilities for the Node.js test runner
 * to make migration from Jest easier.
 */
import * as nodeTest from 'node:test';
import * as assert from 'node:assert';

// Re-export Node.js test functions with proper typing
export const describe = nodeTest.describe;
export const it = nodeTest.it;
export const beforeEach = nodeTest.beforeEach;
export const afterEach = nodeTest.afterEach;
export const before = nodeTest.before;
export const after = nodeTest.after;

// Helper functions for Jest-like functionality
export function trackCalls<T extends (...args: any[]) => any>(fn?: T) {
  const calls: any[][] = [];
  const tracked = function(this: any, ...args: any[]) {
    calls.push([...args]);
    return fn ? fn.apply(this, args) : undefined;
  } as unknown as T & { calls: any[][] };
  
  tracked.calls = calls;
  return tracked;
}

/**
 * Helper function to mock a module in the require cache
 */
export function mockModule(modulePath: string, mockImplementation: any) {
  const fullPath = require.resolve(modulePath);
  require.cache[fullPath] = {
    exports: mockImplementation,
    id: fullPath,
    filename: fullPath,
    loaded: true,
    children: [],
    paths: [],
  };
}

/**
 * Helper function to clear all mocks from the require cache
 */
export function clearMocks(pattern = "/utils/") {
  Object.keys(require.cache).forEach((key) => {
    if (key.includes(pattern) && !key.includes("node_modules")) {
      delete require.cache[key];
    }
  });
}

// Export Node.js assert functions for easier usage
export { assert };
```

3. Update your package.json scripts:

```json
"scripts": {
  "test": "yarn run test:node && jest --bail",
  "test:node": "node --require ./test-register.js --test \"src/**/*.node.test.ts\"",
  "test:jest": "jest --bail"
}
```

This allows running both Node.js tests and Jest tests during transition.

## Convert Test Files

For each Jest test file:

1. Create a new file with `.node.test.ts` extension
2. Import test utilities from the node-test-utils file:
   ```typescript
   import { describe, it, beforeEach, afterEach, assert } from "../../../test/node-test-utils";
   ```

## Convert Basic Test Structure

| Jest | Node.js Test Runner |
|------|---------------------|
| `describe()` | `describe()` from node-test-utils |
| `it()` or `test()` | `it()` from node-test-utils |
| `beforeEach()` | `beforeEach()` from node-test-utils |
| `afterEach()` | `afterEach()` from node-test-utils |
| `beforeAll()` | `before()` from node-test-utils |
| `afterAll()` | `after()` from node-test-utils |

Example:

```typescript
// Jest
describe('My Test Suite', () => {
  it('should do something', () => {
    expect(1 + 1).toBe(2);
  });
});

// Node.js Test Runner
import { describe, it, assert } from "../../../test/node-test-utils";

describe('My Test Suite', async () => {
  it('should do something', async () => {
    assert.strictEqual(1 + 1, 2);
  });
});
```

## Replace Jest Assertions with Node.js Assertions

| Jest | Node.js Assert |
|------|---------------|
| `expect(x).toBe(y)` | `assert.strictEqual(x, y)` |
| `expect(x).toEqual(y)` | `assert.deepStrictEqual(x, y)` |
| `expect(x).toBeTruthy()` | `assert.ok(x)` |
| `expect(x).toBeFalsy()` | `assert.ok(!x)` |
| `expect(() => fn()).toThrow()` | `assert.throws(() => fn())` |
| `expect(fn).toHaveBeenCalled()` | Use `trackCalls()` and check `.calls` property |
| `expect(x).toContain(y)` | `assert.ok(x.includes(y))` |
| `expect(obj).toHaveProperty("prop")` | `assert.ok(obj.hasOwnProperty("prop"))` |
| `expect(arr).toHaveLength(n)` | `assert.strictEqual(arr.length, n)` |

## HTTP Requests with Supertest

For HTTP requests with supertest, explicitly set content type headers:

```typescript
// Jest
await request(app)
  .post("/api/endpoint")
  .send(data)
  .expect(200);

// Node.js Test Runner
await request(app)
  .post("/api/endpoint")
  .set('Accept', 'application/json')
  .set('Content-Type', 'application/json')
  .send(data)
  .expect(200);
```

This prevents "UnsupportedMediaTypeError: unsupported charset" errors.

## Function Mocking and Spies

Use the `trackCalls` function from node-test-utils:

```typescript
// Jest
const mockFn = jest.fn();
mockFn('arg1', 'arg2');
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');

// Node.js Test Runner
import { trackCalls, assert } from "../../../test/node-test-utils";

const mockFn = trackCalls();
mockFn('arg1', 'arg2');
assert.deepStrictEqual(mockFn.calls[0], ['arg1', 'arg2']);
```

## Module Mocking

Use the `mockModule` function from node-test-utils:

```typescript
// Jest
jest.mock('../../utils/api-client', () => ({
  get: jest.fn().mockResolvedValue({ data: { result: 'success' } }),
}));

// Node.js Test Runner
import { mockModule, trackCalls, assert } from "../../../test/node-test-utils";

mockModule('../../utils/api-client', {
  get: trackCalls(async () => ({ data: { result: 'success' } })),
});
```

## Important Node.js Test Runner Patterns

### Module Cache Management

The Node.js test runner doesn't automatically reset modules between tests like Jest. Always clear the cache for modules under test:

```typescript
import { clearMocks, mockModule } from "../../../test/node-test-utils";

beforeEach(async () => {
  // Clear the module under test from cache
  if (require.cache[require.resolve('../module-under-test')]) {
    delete require.cache[require.resolve('../module-under-test')];
  }
  
  // Clear dependency modules
  clearMocks();
  
  // Setup mocks before requiring the module under test
  mockModule('../../utils/dependency', { mockImplementation });
  
  // Now import the module (after mocks are setup)
  const moduleUnderTest = require('../module-under-test');
});
```

### Testing Side Effects

For testing side effects like process.exit, save the original function and restore it after tests:

```typescript
import { trackCalls } from "../../../test/node-test-utils";

const originalExit = process.exit;

beforeEach(async () => {
  process.exit = trackCalls(() => {}) as any;
});

after(async () => {
  process.exit = originalExit;
});
```

### Asynchronous Tests

Both Jest and Node.js test runner handle async tests with async/await:

```typescript
// Both work similarly
it('async test', async () => {
  const result = await someAsyncFunction();
  assert.strictEqual(result, expectedValue);
});
```

### Testing Error Cases

```typescript
// Jest
await expect(asyncFunction()).rejects.toThrow('Error message');

// Node.js Test Runner
try {
  await asyncFunction();
  assert.fail('Should have thrown an error');
} catch (error) {
  assert.strictEqual(error.message, 'Error message');
}
```

## Handling Common Challenges

### Mocking FS Operations

```typescript
import fs from 'fs-extra';

let originalExistsSync: typeof fs.existsSync;

beforeEach(async () => {
  originalExistsSync = fs.existsSync;
  fs.existsSync = (() => true) as typeof fs.existsSync; // Mock implementation
});

after(async () => {
  fs.existsSync = originalExistsSync; // Restore original
});
```

### Testing Output (Console.log)

```typescript
import { assert } from "../../../test/node-test-utils";

const originalConsoleLog = console.log;
const consoleOutput: any[] = [];

beforeEach(async () => {
  console.log = (...args: any[]) => { consoleOutput.push(args) };
});

after(async () => {
  console.log = originalConsoleLog;
});

it('should log correctly', async () => {
  functionThatLogs();
  assert.deepStrictEqual(consoleOutput[0], ['Expected output']);
});
```

## Known Issues and Solutions

### Content-Type issues with POST requests

- Always explicitly set 'Content-Type' and 'Accept' headers to 'application/json'
- This prevents "UnsupportedMediaTypeError: unsupported charset" errors

### Memory leaks with multiple test servers

- Watch for MaxListenersExceededWarning
- Make sure to properly close servers in afterEach hooks
- Consider increasing default max listeners if necessary:
  ```typescript
  // In test-register.js or test setup
  require('events').defaultMaxListeners = 20;
  ```

## Tips for Successful Migration

1. **Convert One Test Suite at a Time**: Start with simpler tests and gradually work towards more complex ones.

2. **Create Utility Functions**: Build a library of utility functions for common operations like mocking and assertions.

3. **Run Both Test Frameworks**: During migration, run both Jest and Node.js tests to ensure functionality is maintained.

4. **Update CI Pipeline**: Ensure your CI pipeline runs both types of tests until migration is complete.

5. **Use File Naming Convention**: Use `.node.test.ts` for Node.js tests to distinguish them from Jest tests.

6. **Import Mocking Before Module Under Test**: Always set up mocks before importing the module under test to ensure the module uses the mocked dependencies.

7. **Clear Module Cache Between Tests**: The Node.js test runner doesn't automatically reset modules between tests like Jest does, so manually clear the cache.

## Troubleshooting Common Issues

### Module Not Mocked

**Issue**: Your mock isn't being used by the module under test.  
**Solution**: Ensure you're clearing the module cache and setting up mocks before importing the module under test.

### Test State Leaking

**Issue**: Changes made in one test affect other tests.  
**Solution**: Clear module cache between tests and properly restore any global objects that were modified.

### Assertion Differences

**Issue**: Assertions behave differently between Jest and Node.js assert.  
**Solution**: Pay special attention to equality checks. Jest uses loose equality by default while Node.js assert uses strict equality.

### Mock Functions Not Recording Calls

**Issue**: Custom spy implementations not tracking calls correctly.  
**Solution**: Ensure you're using the trackCalls pattern correctly and accessing `.calls` property for assertions.

## Next Steps after Migration

1. Remove Jest dependencies from package.json once all tests are migrated.
2. Update documentation and README to reflect new test commands.
3. Create shared utility files for common testing patterns to maintain consistency.
4. Consider standardizing on a single format for all tests once migration is complete.

By following this guide, you should be able to successfully migrate your tests from Jest to the built-in Node.js test runner.
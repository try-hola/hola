# Jest to Node.js Test Runner Migration Guide

This document outlines the process for migrating tests from Jest to the built-in Node.js Test Runner.

## Why Migrate?

- **Reduced Dependencies**: The Node.js test runner is built into Node.js v18+, eliminating the need for external testing libraries.
- **Faster Execution**: Native test runner is typically faster than Jest for most test scenarios.
- **Simplified Setup**: No need for complex configuration files or transformers.
- **ECMAScript Modules Support**: Better support for ESM without requiring additional plugins.
- **Reduced Bundle Size**: Removing Jest reduces the overall package size.

## Migration Process

### 1. Setup Environment

1. Create a test-register.js file in your project root:

```javascript
// test-register.js
// This file is required to load any necessary hooks before tests run
// For example, to handle TypeScript files
require('ts-node/register');
```

2. Update your package.json scripts:

```json
"scripts": {
  "test": "node --require ./test-register.js --test \"src/**/*.node.test.ts\" && jest"
}
```

This allows running both Node.js tests and Jest tests during transition.

### 2. Convert Test Files

For each Jest test file, create a new file with `.node.test.ts` extension.

### 3. Convert Basic Test Structure

| Jest | Node.js Test Runner |
|------|---------------------|
| `describe()` | `require('node:test').describe()` |
| `it()` or `test()` | `require('node:test').it()` |
| `beforeEach()` | `require('node:test').beforeEach()` |
| `afterEach()` | `require('node:test').afterEach()` |
| `beforeAll()` | `require('node:test').before()` |
| `afterAll()` | `require('node:test').after()` |

Example:

```typescript
// Jest
describe('My Test Suite', () => {
  it('should do something', () => {
    expect(1 + 1).toBe(2);
  });
});

// Node.js Test Runner
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('My Test Suite', () => {
  it('should do something', () => {
    assert.strictEqual(1 + 1, 2);
  });
});
```

### 4. Replace Jest Assertions with Node.js Assertions

| Jest | Node.js Assert |
|------|---------------|
| `expect(x).toBe(y)` | `assert.strictEqual(x, y)` |
| `expect(x).toEqual(y)` | `assert.deepStrictEqual(x, y)` |
| `expect(x).toBeTruthy()` | `assert.ok(x)` |
| `expect(x).toBeFalsy()` | `assert.ok(!x)` |
| `expect(() => fn()).toThrow()` | `assert.throws(() => fn())` |
| `expect(fn).toHaveBeenCalled()` | Custom implementation needed (see Function Mocking) |
| `expect(x).toContain(y)` | `assert.ok(x.includes(y))` |

### 5. Function Mocking and Spies

Jest provides built-in mocking capabilities with `jest.fn()` and `jest.spyOn()`. For Node.js test runner, create a helper function:

```typescript
/**
 * Helper function for tracking function calls (similar to Jest spies)
 */
function trackCalls(fn) {
  const calls = [];
  const tracked = function (...args) {
    calls.push([...args]);
    return fn ? fn.apply(this, args) : undefined;
  };
  tracked.calls = calls;
  return tracked;
}
```

Usage:

```typescript
// Jest
const mockFn = jest.fn();
mockFn('arg1', 'arg2');
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');

// Node.js Test Runner
const mockFn = trackCalls();
mockFn('arg1', 'arg2');
assert.deepStrictEqual(mockFn.calls[0], ['arg1', 'arg2']);
```

### 6. Module Mocking

Jest offers `jest.mock()` to automatically mock modules. For Node.js test runner, manually manipulate the require cache:

```typescript
/**
 * Helper function to mock a module in the require cache
 */
function mockModule(modulePath, mockImplementation) {
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
function clearMocks(pattern = "/utils/") {
  Object.keys(require.cache).forEach((key) => {
    if (key.includes(pattern) && !key.includes("node_modules")) {
      delete require.cache[key];
    }
  });
}
```

Usage:

```typescript
// Jest
jest.mock('../../utils/api-client', () => ({
  get: jest.fn().mockResolvedValue({ data: { result: 'success' } }),
}));

// Node.js Test Runner
mockModule('../../utils/api-client', {
  get: trackCalls(async () => ({ data: { result: 'success' } })),
});
```

### 7. Important Node.js Test Runner Patterns

#### Module Cache Management

The Node.js test runner doesn't automatically reset modules between tests like Jest. Always clear the cache for modules under test:

```typescript
beforeEach(() => {
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

#### Testing Side Effects

For testing side effects like process.exit, save the original function and restore it after tests:

```typescript
const originalExit = process.exit;

beforeEach(() => {
  process.exit = trackCalls(() => {});
});

after(() => {
  process.exit = originalExit;
});
```

#### Asynchronous Tests

Both Jest and Node.js test runner handle async tests with async/await or by returning promises:

```typescript
// Both work similarly
it('async test', async () => {
  const result = await someAsyncFunction();
  assert.strictEqual(result, expectedValue);
});
```

#### Testing Error Cases

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

### 8. Handling Common Challenges

#### Mocking FS Operations

```typescript
let originalExistsSync;

beforeEach(() => {
  originalExistsSync = fs.existsSync;
  fs.existsSync = () => true; // Mock implementation
});

after(() => {
  fs.existsSync = originalExistsSync; // Restore original
});
```

#### Testing Output (Console.log)

```typescript
const originalConsoleLog = console.log;
const consoleOutput = [];

beforeEach(() => {
  console.log = (...args) => { consoleOutput.push(args) };
});

after(() => {
  console.log = originalConsoleLog;
});

it('should log correctly', () => {
  functionThatLogs();
  assert.deepStrictEqual(consoleOutput[0], ['Expected output']);
});
```

### 9. Tips for Smooth Migration

1. **Convert One Test Suite at a Time**: Start with simpler tests and gradually work towards more complex ones.

2. **Create Utility Functions**: Build a library of utility functions for common operations like mocking and assertions.

3. **Run Both Test Frameworks**: During migration, run both Jest and Node.js tests to ensure functionality is maintained.

4. **Update CI Pipeline**: Ensure your CI pipeline runs both types of tests until migration is complete.

5. **Use File Naming Convention**: Use `.node.test.ts` for Node.js tests to distinguish them from Jest tests.

6. **Import Mocking Before Module Under Test**: Always set up mocks before importing the module under test to ensure the module uses the mocked dependencies.

7. **Clear Module Cache Between Tests**: The Node.js test runner doesn't automatically reset modules between tests like Jest does, so manually clear the cache.

### 10. Troubleshooting Common Issues

#### Module Not Mocked

**Issue**: Your mock isn't being used by the module under test.  
**Solution**: Ensure you're clearing the module cache and setting up mocks before importing the module under test.

#### Test State Leaking

**Issue**: Changes made in one test affect other tests.  
**Solution**: Clear module cache between tests and properly restore any global objects that were modified.

#### Assertion Differences

**Issue**: Assertions behave differently between Jest and Node.js assert.  
**Solution**: Pay special attention to equality checks. Jest uses loose equality by default while Node.js assert uses strict equality.

#### Mock Functions Not Recording Calls

**Issue**: Custom spy implementations not tracking calls correctly.  
**Solution**: Ensure you're using the trackCalls pattern correctly and accessing `.calls` property for assertions.

### 11. Next Steps after Migration

1. Remove Jest dependencies from package.json once all tests are migrated.
2. Update documentation and README to reflect new test commands.
3. Create shared utility files for common testing patterns to maintain consistency.
4. Consider standardizing on a single format for all tests once migration is complete.

By following this guide, you should be able to successfully migrate your tests from Jest to the built-in Node.js test runner.
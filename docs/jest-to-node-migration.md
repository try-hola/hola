# Migrating from Jest to Node.js Built-in Test Runner

This document outlines the progress and next steps for migrating our client package tests from Jest to Node's built-in test runner.

## Progress So Far

We have successfully migrated the following test files:

- `app-info.test.ts` → `app-info.node.test.ts`
- `app-deploy.test.ts` → `app-deploy.node.test.ts`
- `app-start.test.ts` → `app-start.node.test.ts` (includes tests for start, stop, and restart commands)
- `auth-manager.test.ts` → `auth-manager.node.test.ts`
- `config-manager.test.ts` → `config-manager.node.test.ts`
- `app-commands.test.ts` → `app-commands.node.test.ts`
- `server/add.test.ts` → `server/add.node.test.ts`
- `app/delete.test.ts` → `app/delete.node.test.ts`

## Migration Strategy

We're using an incremental approach that allows both Jest and Node.js test runner to coexist:

1. Create `.node.test.ts` versions of existing test files
2. Update package.json to run both test frameworks
3. Use common utilities for consistent testing patterns
4. Gradually migrate all tests to Node.js test runner
5. When all tests are migrated, remove Jest dependencies

## Setup and Configuration

The following files have been created to support the migration:

- `test-register.js` - Enables TypeScript support for Node.js tests
- `src/test-utils/assertions.ts` - Provides Jest-like assertion helpers
- `src/test-utils/mocks.ts` - Provides mocking utilities
- `src/test-utils/node-test-template.ts` - Template for new test files
- `src/types/node-test-globals.d.ts` - TypeScript declarations for Node.js test APIs

## Key Structural Patterns for Reliable Tests

Based on our successful migrations, we've identified these five critical patterns for reliable Node.js tests:

1. **Clear module cache for each test** - Begin each test by clearing the entire module cache for any paths that match your module patterns (like `/utils/`). This ensures each test starts with a clean state.

2. **Track function calls with a helper function** - Use the `trackCalls` helper function to create Jest spy-like functionality for tracking function calls, arguments, and controlling return values.

3. **Set up mocks by directly manipulating the require cache** - For consistent behavior, directly manipulate the `require.cache` object rather than using helper functions. This approach works more reliably across different test scenarios.

4. **Import modules under test AFTER mocking** - Always import the module being tested after all mocks are set up, never before. This ensures the module uses your mock implementations.

5. **Use Node.js native assertion library** - Use Node's built-in `assert` module for verifications rather than trying to replicate Jest's expect API. This leads to clearer, more maintainable tests that follow Node.js conventions.

Example of these patterns in action:

```typescript
// 1. Clear module cache at beginning of each test
Object.keys(require.cache).forEach((key) => {
  if (key.includes("/utils/") && !key.includes("node_modules")) {
    delete require.cache[key];
  }
});

// 2. Track function calls with a helper function
function trackCalls(fn) {
  const calls = [];
  const tracked = function (...args) {
    calls.push([...args]);
    return fn ? fn.apply(this, args) : undefined;
  };
  tracked.calls = calls;
  return tracked;
}

const mockGet = trackCalls(async () => ({ data: { value: "test" } }));

// 3. Set up mocks by directly manipulating require.cache
require.cache[require.resolve("../../utils/api-client")] = {
  exports: {
    get: mockGet,
    post: () => {},
    delete: () => {},
  },
  id: require.resolve("../../utils/api-client"),
  filename: require.resolve("../../utils/api-client"),
  loaded: true,
  children: [],
  paths: [],
};

// 4. Import the module under test AFTER setting up mocks
const moduleUnderTest = require("../path/to/module");

// 5. Use Node.js native assertion library
it("should make an API call", async () => {
  const result = await moduleUnderTest.doSomething();
  assert.strictEqual(mockGet.calls.length, 1, "API get should be called once");
  assert.strictEqual(mockGet.calls[0][0], "/api/endpoint", "API endpoint should be correct");
  assert.deepStrictEqual(result, { value: "test" }, "Result should match expected structure");
});
```

## How to Migrate a Test File

Follow these steps to migrate a Jest test file to the Node.js test runner:

1. Create a new file with the same name but using `.node.test.ts` extension
2. Use the template from `src/test-utils/node-test-template.ts`
3. Import the necessary test functions from `node:test`
4. Use `assert` from `node:assert` or our custom assertion helpers
5. Set up mocks using the require cache manipulation pattern
6. Import modules under test after setting up mocks
7. Update assertions to use Node.js assertions or our Jest-like helpers

### Example Migration

Here's a simplified example of what the migration looks like:

```typescript
// Before (Jest)
jest.mock("../../utils/api-client");
const apiClient = require("../../utils/api-client");

describe("My Test Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test("should do something", async () => {
    apiClient.get.mockResolvedValue({ data: { value: "test" } });
    const result = await myModule.doSomething();
    expect(result).toBe("test");
  });
});

// After (Node.js test runner)
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function mockModule(modulePath, implementation) {
  const fullPath = require.resolve(modulePath);
  require.cache[fullPath] = {
    exports: implementation,
    id: fullPath,
    filename: fullPath,
    loaded: true,
    children: [],
    paths: []
  };
}

describe("My Test Suite", () => {
  beforeEach(() => {
    // Clear mocks
    Object.keys(require.cache).forEach(key => {
      if (key.includes('/utils/') && !key.includes('node_modules')) {
        delete require.cache[key];
      }
    });
    
    // Setup mocks
    mockModule('../../utils/api-client', {
      get: async () => ({ data: { value: "test" } })
    });
  });
  
  it("should do something", async () => {
    const myModule = require('../path/to/module');
    const result = await myModule.doSomething();
    assert.strictEqual(result, "test");
  });
});
```

## Common Patterns

1. **Mocking modules**: Use the `mockModule` function to add mock implementations to the require cache
2. **Clearing mocks**: Use `clearMocks` before each test to ensure a fresh state
3. **Tracking calls**: Use the `trackCalls` helper to create spy-like functions
4. **Assertions**: Use either Node's `assert` module directly or the helpers in `assertions.ts`

## Next Steps in Migration

1. Choose additional test files to migrate based on priority or complexity
2. Follow the migration pattern established in the initial migrations
3. Update common utility functions as needed for more complex test cases
4. After migrating all tests, consider removing Jest dependencies
5. Run both test frameworks until confident in full migration

## Running Tests

- To run just the Node.js tests: `yarn test:node`
- To run just the Jest tests: `yarn test:jest`
- To run all tests: `yarn test`
- To run Node.js tests with watch mode: `yarn test:node:watch`
- To run Node.js tests with coverage: `yarn test:node:coverage` (experimental)

## Tips for Successful Migration

1. Start with simpler test files before tackling complex ones
2. Test each migration thoroughly before moving to the next file
3. Don't try to migrate all tests at once; use the incremental approach
4. Add new tests directly using the Node.js test runner
5. Keep utility functions updated as you encounter new testing patterns
6. Consistent mocking is key for reliable tests

## Resources

- [Node.js Test Runner Documentation](https://nodejs.org/api/test.html)
- [Node.js Assert Documentation](https://nodejs.org/api/assert.html)
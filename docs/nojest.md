# Migration Plan: Jest to Node.js Built-in Test Runner

## Overview

This document outlines a methodical approach to migrating from Jest to Node.js built-in test runner while ensuring continuous test coverage throughout the transition. The migration will follow an incremental path where tests are migrated one at a time, allowing both testing frameworks to coexist during the process.

## Prerequisites

- Node.js v18.0.0 or later (Node.js built-in test runner requires v18+)
- Understanding of the current Jest test structure
- Familiarity with Node's test runner API

## Phase 1: Setup and Configuration

### 1.1 Update package.json

First, we'll modify the client package.json to support both test frameworks:

```json
{
  "scripts": {
    "test": "node --test \"src/**/*.node.test.ts\" && jest",
    "test:node": "node --test \"src/**/*.node.test.ts\"",
    "test:jest": "jest",
    "test:watch": "node --test --watch \"src/**/*.node.test.ts\"",
    "test:node:coverage": "node --test --experimental-test-coverage \"src/**/*.node.test.ts\""
  },
  "devDependencies": {
    "ts-node": "^10.9.1",  // For TypeScript support with node test
    "jest": "^29.0.0",     // Keep during migration
    "@types/node": "^18.0.0" // Ensure we have type definitions
  }
}
```

### 1.2 Configure TypeScript for Node.js Test Runner

Create a register file for TypeScript support with Node's test runner:

```typescript
// test-register.js
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'CommonJS'
  }
});
```

Update the test script to use this register:

```json
{
  "scripts": {
    "test:node": "node --require ./test-register.js --test \"src/**/*.node.test.ts\""
  }
}
```

## Phase 2: Create Test Utilities and Adapters

### 2.1 Create Node Test Assertion Helpers

To make the transition smoother, create utilities that provide Jest-like syntax for Node:

```typescript
// src/test-utils/assertions.ts
import assert from 'node:assert';

export function expect(actual: any) {
  return {
    toBe: (expected: any) => assert.strictEqual(actual, expected),
    toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
    toContain: (item: any) => {
      if (typeof actual === 'string') {
        assert.ok(actual.includes(item), `Expected "${actual}" to contain "${item}"`);
      } else {
        assert.ok(actual.includes(item), `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`);
      }
    },
    toBeDefined: () => assert.notStrictEqual(actual, undefined),
    toBeNull: () => assert.strictEqual(actual, null),
    // Add more assertion methods as needed
  };
}
```

### 2.2 Create Mock Utilities

```typescript
// src/test-utils/mocks.ts
import { mock } from 'node:test/mock';

export function createMock<T extends object>(implementation?: Partial<T>): T {
  return mock.fn(implementation) as unknown as T;
}

export function mockModule<T>(modulePath: string, mocks: Partial<T> = {}): T {
  return mock.module(modulePath, { mock: mocks });
}

export function resetAllMocks(): void {
  mock.reset();
}
```

## Phase 3: Incremental Test Migration

### 3.1 Select Initial Test Files

Start with simple tests that don't use complex Jest features. For each test:

1. Create a new file with `.node.test.ts` extension
2. Keep the original Jest test file until migration is complete

### 3.2 Migrate First Test File

Example migration of a simple test:

**Before (Jest):**
```typescript
// src/__tests__/utils/formatter.test.ts
import { formatOutput } from '../../utils/formatter';

describe('formatOutput', () => {
  it('should format simple output correctly', () => {
    const result = formatOutput('test');
    expect(result).toBe('test');
  });
});
```

**After (Node.js test):**
```typescript
// src/__tests__/utils/formatter.node.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatOutput } from '../../utils/formatter';

describe('formatOutput', () => {
  it('should format simple output correctly', () => {
    const result = formatOutput('test');
    assert.strictEqual(result, 'test');
  });
});
```

### 3.3 Verify Both Test Suites

Run both test suites to ensure they both pass:

```bash
yarn test
```

## Phase 4: Mock Migration Pattern

### 4.1 Simple Function Mock

**Before (Jest):**
```typescript
// src/__tests__/services/apiClient.test.ts
import { apiClient } from '../../services/apiClient';

jest.mock('../../services/apiClient', () => ({
  get: jest.fn().mockResolvedValue({ data: 'success' })
}));

describe('API Client', () => {
  it('should mock API call', async () => {
    const result = await apiClient.get('/test');
    expect(result).toEqual({ data: 'success' });
    expect(apiClient.get).toHaveBeenCalledWith('/test');
  });
});
```

**After (Node.js test):**
```typescript
// src/__tests__/services/apiClient.node.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mock } from 'node:test/mock';

// Mock the module before importing
const mockClient = {
  get: mock.fn(() => Promise.resolve({ data: 'success' }))
};

// Use mock.module to mock the module
mock.module('../../services/apiClient', () => ({
  apiClient: mockClient
}));

// Import after mocking
import { apiClient } from '../../services/apiClient;

describe('API Client', () => {
  it('should mock API call', async () => {
    const result = await apiClient.get('/test');
    assert.deepStrictEqual(result, { data: 'success' });
    assert.deepStrictEqual(mockClient.get.mock.calls[0].arguments, ['/test']);
  });
});
```

### 4.2 Complex Module Mock

For complex mocking scenarios, use the `__mocks__` directory and the Node.js mock API:

**Before (Jest with __mocks__):**
```typescript
// src/__mocks__/fs.ts
const fs = jest.createMockFromModule('fs');
fs.readFileSync = jest.fn().mockReturnValue('mocked content');
module.exports = fs;

// src/__tests__/fileReader.test.ts
jest.mock('fs');
import fs from 'fs';
import { readConfig } from '../fileReader';

describe('File Reader', () => {
  it('should read config file', () => {
    const content = readConfig('config.json');
    expect(content).toBe('mocked content');
    expect(fs.readFileSync).toHaveBeenCalledWith('config.json', 'utf8');
  });
});
```

**After (Node.js test):**
```typescript
// src/__tests__/fileReader.node.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mock } from 'node:test/mock';

// Create mocks
const mockFs = {
  readFileSync: mock.fn(() => 'mocked content')
};

// Mock the fs module
mock.module('fs', () => mockFs);

// Import after mocking
import { readConfig } from '../fileReader';

describe('File Reader', () => {
  it('should read config file', () => {
    const content = readConfig('config.json');
    assert.strictEqual(content, 'mocked content');
    assert.deepStrictEqual(
      mockFs.readFileSync.mock.calls[0].arguments, 
      ['config.json', 'utf8']
    );
  });
});
```

## Phase 5: Handling Jest-Specific Features

### 5.1 Snapshot Testing

Node.js test runner doesn't have built-in snapshot testing. Consider:

1. Using a third-party snapshot library compatible with Node.js test
2. Creating a simple snapshot utility using file system operations
3. Reimplementing tests to use explicit assertions

### 5.2 Test Lifecycle Hooks

Migrate `beforeEach`, `afterEach`, `beforeAll`, and `afterAll` to Node.js test runner equivalents:

**Before (Jest):**
```typescript
describe('Test Suite', () => {
  beforeAll(() => {
    // Setup before all tests
  });
  
  beforeEach(() => {
    // Setup before each test
  });
  
  afterEach(() => {
    // Cleanup after each test
  });
  
  afterAll(() => {
    // Cleanup after all tests
  });
  
  it('should test something', () => {
    // Test code
  });
});
```

**After (Node.js test):**
```typescript
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';

describe('Test Suite', () => {
  before(() => {
    // Setup before all tests
  });
  
  beforeEach(() => {
    // Setup before each test
  });
  
  afterEach(() => {
    // Cleanup after each test
  });
  
  after(() => {
    // Cleanup after all tests
  });
  
  it('should test something', () => {
    // Test code
  });
});
```

## Phase 6: Complete Migration

### 6.1 Verify All Tests Pass with Node.js Test Runner

Run the full test suite using only Node's test runner:

```bash
yarn test:node
```

### 6.2 Update package.json

Remove Jest dependencies and update scripts:

```json
{
  "scripts": {
    "test": "node --require ./test-register.js --test \"src/**/*.test.ts\"",
    "test:watch": "node --require ./test-register.js --test --watch \"src/**/*.test.ts\""
  },
  "devDependencies": {
    "ts-node": "^10.9.1",
    "@types/node": "^18.0.0"
  }
}
```

### 6.3 Rename Test Files

Rename all `.node.test.ts` files to `.test.ts` (removing the `.node` part):

```bash
for file in src/**/*.node.test.ts; do
  mv "$file" "${file/.node.test.ts/.test.ts}"
done
```

## Best Practices and Tips

1. **Take It Slow**: Migrate one test file at a time and ensure existing functionality remains intact.
2. **Run Both Frameworks**: During migration, run both Jest and Node.js tests to ensure coverage.
3. **Start Simple**: Begin with simpler tests that don't use advanced Jest features.
4. **Documentation**: Update documentation to reflect the use of Node.js test runner.
5. **Consistent Style**: Maintain a consistent testing style throughout the codebase.
6. **Re-evaluate Complex Tests**: Some complex test scenarios might benefit from being refactored during migration.
7. **Module Mocking Strategy**: Use the require cache manipulation pattern for mocking modules in CommonJS:
   ```typescript
   function mockModule(modulePath, mockImplementation) {
     const fullPath = require.resolve(modulePath);
     require.cache[fullPath] = {
       exports: mockImplementation,
       id: fullPath,
       filename: fullPath,
       loaded: true,
       children: [],
       paths: []
     };
   }
   ```
8. **Fresh Module Import**: Always import the module under test _after_ mocking its dependencies to ensure mocks are applied.
9. **Clear Mocks Between Tests**: Clear the require cache for mocked modules between tests:
   ```typescript
   function clearMocks(pattern = '/utils/') {
     Object.keys(require.cache).forEach(key => {
       if (key.includes(pattern) && !key.includes('node_modules')) {
         delete require.cache[key];
       }
     });
   }
   ```
10. **Tracking Function Calls**: Use a simple tracking function to monitor function calls instead of Jest spies:
    ```typescript
    function trackCalls(fn) {
      const calls = [];
      const tracked = function(...args) {
        calls.push([...args]);
        return fn ? fn.apply(this, args) : undefined;
      };
      tracked.calls = calls;
      return tracked;
    }
    ```
11. **Provide Server Context**: When testing commands that require a server context, mock the `getCurrentServer` method:
    ```typescript
    mockModule('../../utils/api-client', {
      // Other mock methods...
      getCurrentServer: () => ({
        url: 'http://localhost:3000',
        name: 'local'
      })
    });
    ```
12. **Test Utilities Directory**: Keep all shared test utilities in `src/test-utils/` for easy reuse across test files.
13. **Test Template File**: Use the provided template file (`node-test-template.ts`) for new test migrations to ensure consistency.
14. **One Change at a Time**: Make only one change at a time and run tests after each change to isolate issues.
15. **Keep Original Jest Tests**: Maintain the original Jest tests until migration is complete and verified.

## Established Migration Patterns

Based on our experience migrating the first set of tests, we've established these essential patterns:

### CommonJS Module Mocking

For proper mocking in a CommonJS environment, follow this pattern:

```typescript
// Clear module cache first
clearMocks();

// Setup mocks
mockModule('../../utils/api-client', {
  get: async (url) => { /* mock implementation */ },
  // other methods...
});

// Import AFTER mocking
const moduleUnderTest = require('../path/to/module');

// Run test with mocked dependencies
const result = await moduleUnderTest.someFunction();
```

### Assertion Pattern

Use Node.js assert directly or create helper functions to maintain readability:

```typescript
// Direct Node.js assert usage
assert.strictEqual(actual, expected, "Optional message");
assert.deepStrictEqual(complexObject, expectedObject);
assert.ok(booleanCondition, "Optional failure message");

// Using helper functions for more Jest-like syntax
expect(result.success).toBe(true);
expect(result.data).toEqual(expectedData);
```

### Test Organization

Organize tests with similar structure to Jest for consistency:

```typescript
describe('Module or Feature Name', () => {
  beforeEach(() => {
    // Setup for all tests in this describe block
    clearMocks();
    setupCommonMocks();
  });
  
  it('should perform specific behavior', async () => {
    // Setup specific to this test
    const result = await functionUnderTest();
    // Assertions
  });
});
```

### Test Suite Refactoring

When migrating complex test suites with repeated patterns, consider refactoring to reduce duplication:

```typescript
// For similar command tests (like start, stop, restart)
function testAppCommand(commandName, handlerModulePath, endpoint) {
  describe(`App ${commandName} Command`, () => {
    // Common beforeEach setup
    
    it(`should ${commandName} an application successfully`, async () => {
      // Specific test implementation
    });
    
    // Other test cases...
  });
}

// Usage
testAppCommand('start', '../app/start', 'start');
testAppCommand('stop', '../app/stop', 'stop');
testAppCommand('restart', '../app/restart', 'restart');
```

## References

- [Node.js Test Runner Documentation](https://nodejs.org/api/test.html)
- [Node.js Assert Documentation](https://nodejs.org/api/assert.html)
- [Node.js Mock API Documentation](https://nodejs.org/api/test.html#mocking)
- [Our Migration Guide](../packages/client/jest-to-node-migration.md)
/**
 * Test utilities for Node.js test runner
 *
 * This module provides properly typed test utilities for the Node.js test runner
 * to make migration from Jest easier.
 */
import * as nodeTest from "node:test";
import * as assert from "node:assert";

// Re-export Node.js test functions with proper typing
export const describe = nodeTest.describe;
export const it = nodeTest.it;
export const beforeEach = nodeTest.beforeEach;
export const afterEach = nodeTest.afterEach;
export const before = nodeTest.before;
export const after = nodeTest.after;

/**
 * Helper function for tracking function calls (similar to Jest spies)
 */
export function trackCalls<T extends (...args: any[]) => any>(fn?: T) {
  const calls: any[][] = [];
  const tracked = function (this: any, ...args: any[]) {
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

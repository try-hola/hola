/**
 * Assertion helpers for Node.js test runner that provide a Jest-like API
 */
import assert from "node:assert";

/**
 * Creates an assertion object with Jest-like matchers
 * @param actual - The value to test
 * @returns Object with Jest-like assertion methods
 */
export function expect(actual: any) {
  return {
    toBe: (expected: any) => assert.strictEqual(actual, expected),
    toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
    toContain: (item: any) => {
      if (typeof actual === "string") {
        assert.ok(
          actual.includes(item),
          `Expected "${actual}" to contain "${item}"`,
        );
      } else {
        assert.ok(
          actual.includes(item),
          `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`,
        );
      }
    },
    toBeUndefined: () => assert.strictEqual(actual, undefined),
    toBeDefined: () => assert.notStrictEqual(actual, undefined),
    toBeNull: () => assert.strictEqual(actual, null),
    toBeTruthy: () => assert.ok(actual),
    toBeFalsy: () => assert.ok(!actual),
    toHaveProperty: (propertyPath: string) => {
      const pathParts = propertyPath.split(".");
      let value = actual;
      for (const part of pathParts) {
        assert.ok(
          value !== null && value !== undefined,
          `Expected object to have property "${propertyPath}" but it's null or undefined at "${part}"`,
        );
        value = value[part];
      }
      assert.ok(
        value !== undefined,
        `Expected object to have property "${propertyPath}"`,
      );
    },
    toThrow: () => {
      assert.throws(actual);
    },
    toMatch: (pattern: RegExp | string) => {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
      assert.ok(
        regex.test(String(actual)),
        `Expected "${actual}" to match ${pattern}`,
      );
    },
    // Add more assertion methods as needed
  };
}

/**
 * Creates a jest-like mock function
 * @returns A mock function with jest-like interface
 */
export function fn() {
  const mockCalls: any[][] = [];

  const mockFn: any = function (...args: any[]) {
    mockCalls.push([...args]);
    return mockFn._returnValue;
  };

  // Setup mock structure to match Jest's mock functions
  mockFn.mock = {
    calls: mockCalls,
    instances: [],
    invocationCallOrder: [],
    results: [],
  };

  // Add Jest-like mock methods
  mockFn.mockReturnValue = function (value: any) {
    mockFn._returnValue = value;
    return mockFn;
  };

  mockFn.mockResolvedValue = function (value: any) {
    mockFn._returnValue = Promise.resolve(value);
    return mockFn;
  };

  mockFn.mockRejectedValue = function (value: any) {
    mockFn._returnValue = Promise.reject(value);
    return mockFn;
  };

  mockFn.mockImplementation = function (implementation: Function) {
    const original = mockFn;
    const newMockFn = function (...args: any[]) {
      mockCalls.push([...args]);
      return implementation.apply(this, args);
    };

    // Copy over all properties from the original mock
    Object.assign(newMockFn, original);
    newMockFn.mock = original.mock;

    return newMockFn;
  };

  mockFn.mockReset = function () {
    mockCalls.length = 0;
    mockFn._returnValue = undefined;
  };

  return mockFn;
}

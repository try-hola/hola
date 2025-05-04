/**
 * Mocking utilities for Node.js test runner
 */
import { fn } from "./assertions";

// Simple module cache to store mocked modules
const mockedModules = new Map<string, any>();

/**
 * Creates a mock object with the specified implementation
 * @param implementation - Partial implementation of the object
 * @returns Mocked object
 */
export function createMock<T extends object>(implementation?: Partial<T>): T {
  const mockObj = implementation || {};
  return mockObj as T;
}

/**
 * Mocks a module with the specified implementations
 * @param modulePath - Path to the module to mock
 * @param mockImplementation - Mock implementation for the module
 * @returns The mocked module
 */
export function mockModule<T>(modulePath: string, mockImplementation: T): T {
  // Store the mock in our map for later use
  mockedModules.set(modulePath, mockImplementation);
  return mockImplementation;
}

/**
 * Gets a mocked module
 * @param modulePath - Path to the mocked module
 * @returns The mocked module
 */
export function getMockedModule<T>(modulePath: string): T | undefined {
  return mockedModules.get(modulePath) as T | undefined;
}

/**
 * Resets all mocks
 */
export function resetAllMocks(): void {
  mockedModules.clear();
}

// Re-export fn from assertions
export { fn };

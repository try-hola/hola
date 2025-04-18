/**
 * Mock implementation of the logger
 */

// Create mock functions for logging operations
const debug = jest.fn();
const info = jest.fn();
const warn = jest.fn();
const error = jest.fn();
const success = jest.fn();

// Reset all mocks
const resetMocks = () => {
  debug.mockReset();
  info.mockReset();
  warn.mockReset();
  error.mockReset();
  success.mockReset();
};

// Export as CommonJS module
module.exports = {
  debug,
  info,
  warn,
  error,
  success,
  resetMocks,
};

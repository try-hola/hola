/**
 * Mock implementation of the output formatter
 */

// Create mock functions for output operations
const formatOutput = jest.fn().mockImplementation((data, format) => data);
const table = jest.fn().mockImplementation((data, columns, options) => data);
const json = jest
  .fn()
  .mockImplementation((data) => JSON.stringify(data, null, 2));
const text = jest.fn().mockImplementation((data) => data.toString());

// Reset all mocks
const resetMocks = () => {
  formatOutput.mockReset().mockImplementation((data, format) => data);
  table.mockReset().mockImplementation((data, columns, options) => data);
  json.mockReset().mockImplementation((data) => JSON.stringify(data, null, 2));
  text.mockReset().mockImplementation((data) => data.toString());
};

// Create outputFormatter object to match the structure expected by auth-manager
const outputFormatter = {
  formatOutput,
  table,
  json,
  text,
};

// Export as CommonJS module
module.exports = {
  outputFormatter,
  formatOutput,
  table,
  json,
  text,
  resetMocks,
};

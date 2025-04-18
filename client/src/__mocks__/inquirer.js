/**
 * Mock implementation of inquirer
 */

// Create mock function for prompt
const prompt = jest.fn().mockResolvedValue({});

// Reset the mock
const resetMocks = () => {
  prompt.mockReset().mockResolvedValue({});
};

// Export as CommonJS module
module.exports = {
  prompt,
  resetMocks,
};

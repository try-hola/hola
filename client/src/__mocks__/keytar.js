/**
 * Mock implementation of keytar module
 */
const setPassword = jest.fn().mockResolvedValue(undefined);
const getPassword = jest.fn().mockResolvedValue("mock-password");
const deletePassword = jest.fn().mockResolvedValue(undefined);

// Reset all mocks
const resetMocks = () => {
  setPassword.mockReset().mockResolvedValue(undefined);
  getPassword.mockReset().mockResolvedValue("mock-password");
  deletePassword.mockReset().mockResolvedValue(undefined);
};

// Export as CommonJS module
module.exports = {
  setPassword,
  getPassword,
  deletePassword,
  resetMocks,
};

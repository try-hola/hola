/**
 * Mock implementation of the server provider registry
 */

// Create mock functions for provider registry operations
const getAvailableProviders = jest.fn().mockResolvedValue([
  { type: "local", displayName: "Local Server" },
  { type: "remote", displayName: "Remote Server" },
]);

const getProvider = jest.fn().mockImplementation((type) => {
  if (type === "local" || type === "remote") {
    return {
      type,
      displayName: type === "local" ? "Local Server" : "Remote Server",
    };
  }
  return null;
});

// Reset all mocks
const resetMocks = () => {
  getAvailableProviders.mockReset().mockResolvedValue([
    { type: "local", displayName: "Local Server" },
    { type: "remote", displayName: "Remote Server" },
  ]);

  getProvider.mockReset().mockImplementation((type) => {
    if (type === "local" || type === "remote") {
      return {
        type,
        displayName: type === "local" ? "Local Server" : "Remote Server",
      };
    }
    return null;
  });
};

// Export as CommonJS module
module.exports = {
  getAvailableProviders,
  getProvider,
  resetMocks,
};

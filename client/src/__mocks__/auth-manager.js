/**
 * Mock implementation of the auth manager
 */

// Create mock functions for authentication operations
const authenticate = jest.fn().mockResolvedValue(true);
const logout = jest.fn().mockResolvedValue(true);
const getAccessToken = jest.fn().mockResolvedValue("mock-access-token");
const refreshToken = jest.fn().mockResolvedValue("mock-refresh-token");
const storeTokens = jest.fn().mockResolvedValue(undefined);
const getTokens = jest.fn().mockResolvedValue({
  accessToken: "mock-access-token",
  refreshToken: "mock-refresh-token",
  expiresAt: Date.now() + 3600000,
});
const createCallbackServer = jest.fn().mockReturnValue({
  server: { close: jest.fn() },
  authorizationPromise: Promise.resolve({
    code: "mock-code",
    responseState: "mock-state",
  }),
});
const generateCodeVerifier = jest.fn().mockReturnValue("mock-code-verifier");
const generateCodeChallenge = jest.fn().mockReturnValue("mock-code-challenge");
const generateSecureString = jest.fn().mockReturnValue("mock-secure-string");

// Reset all mocks
const resetMocks = () => {
  authenticate.mockReset().mockResolvedValue(true);
  logout.mockReset().mockResolvedValue(true);
  getAccessToken.mockReset().mockResolvedValue("mock-access-token");
  refreshToken.mockReset().mockResolvedValue("mock-refresh-token");
  storeTokens.mockReset().mockResolvedValue(undefined);
  getTokens.mockReset().mockResolvedValue({
    accessToken: "mock-access-token",
    refreshToken: "mock-refresh-token",
    expiresAt: Date.now() + 3600000,
  });
  createCallbackServer.mockReset().mockReturnValue({
    server: { close: jest.fn() },
    authorizationPromise: Promise.resolve({
      code: "mock-code",
      responseState: "mock-state",
    }),
  });
  generateCodeVerifier.mockReset().mockReturnValue("mock-code-verifier");
  generateCodeChallenge.mockReset().mockReturnValue("mock-code-challenge");
  generateSecureString.mockReset().mockReturnValue("mock-secure-string");
};

// Export as CommonJS module
module.exports = {
  authenticate,
  logout,
  getAccessToken,
  refreshToken,
  storeTokens,
  getTokens,
  createCallbackServer,
  generateCodeVerifier,
  generateCodeChallenge,
  generateSecureString,
  resetMocks,
  // Add service name for consistency with the real implementation
  serviceName: "hola-cli",
};

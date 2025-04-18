/**
 * Tests for the auth-manager module
 */
// Mock dependencies before importing modules
jest.mock("keytar");
jest.mock("open");
jest.mock("../../utils/config-manager");
jest.mock("../../utils/output-formatter");

// Mock the outputFormatter module directly
const outputFormatterMock = {
  formatOutput: jest.fn(),
};
jest.doMock("../../utils/output-formatter", () => ({
  outputFormatter: outputFormatterMock,
}));

// Mock HTTP and crypto modules
const mockCreateServer = jest.fn();
const mockServerListen = jest.fn();
const mockServerClose = jest.fn();
let stateForTest; // Store the state for verification

// Mock the HTTP server
jest.mock("http", () => ({
  createServer: jest.fn(() => ({
    on: jest.fn((event, callback) => {
      if (event === "request") {
        // Store the callback to simulate a request later
        mockCreateServer.callback = callback;
      }
      return mockCreateServer.server;
    }),
    listen: mockServerListen.mockImplementation((port, callback) => {
      if (callback) callback();
      return mockCreateServer.server;
    }),
    close: mockServerClose,
  })),
}));

// Mock crypto for state generation to make it predictable in tests
jest.mock("crypto", () => ({
  randomBytes: jest.fn().mockImplementation((size) => {
    const randomString = "abcdef1234567890";
    stateForTest = randomString;
    return {
      toString: jest.fn().mockReturnValue(randomString),
    };
  }),
  createHash: jest.fn().mockImplementation(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue("mockDigest"),
  })),
}));

// Mock Axios for token requests
const mockAxiosPost = jest.fn();
jest.mock("axios", () => ({
  post: mockAxiosPost,
}));

// Import dependencies after mocking
const keytar = require("keytar");
const open = require("open");
const { outputFormatter } = require("../../utils/output-formatter");
const configManager = require("../../utils/config-manager");

// Import the module under test after all mocks are set up
const authManager = require("../../utils/auth-manager");

describe("Auth Manager", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up default mock implementations
    mockAxiosPost.mockResolvedValue({
      data: {
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 3600,
      },
    });

    keytar.getPassword.mockResolvedValue(null);
  });

  describe("authenticate", () => {
    it("should initiate OIDC auth flow and store tokens on success", async () => {
      const serverContext = {
        name: "test-server",
        providerOptions: {
          orbDomain: "test.orb.local",
        },
        clientId: "test-client-id",
      };

      // Create a promise that will resolve when we simulate the OAuth callback
      const authPromise = authManager.authenticate(serverContext);

      // Simulate the callback from the browser with the same state we generated
      mockCreateServer.callback(
        {
          url: `/callback?code=test-auth-code&state=${stateForTest}`,
          headers: {},
        },
        {
          writeHead: jest.fn(),
          end: jest.fn(),
        },
      );

      // Wait for auth flow to complete
      await authPromise;

      // Verify OIDC token request was made
      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.stringContaining("token"),
        expect.any(URLSearchParams),
      );

      // Verify tokens were stored securely
      expect(keytar.setPassword).toHaveBeenCalledWith(
        "hola-cli",
        "test-server_tokens",
        expect.stringContaining("test-access-token"),
      );

      // Verify browser was opened with correct URL
      expect(open).toHaveBeenCalledWith(expect.stringContaining("authorize"));

      // Verify success message was shown
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        "success",
        "Authentication successful!",
      );
    });

    it("should handle authentication errors", async () => {
      const serverContext = {
        name: "test-server",
        providerOptions: {
          orbDomain: "test.orb.local",
        },
        clientId: "test-client-id",
      };

      // Make the token request fail
      mockAxiosPost.mockRejectedValueOnce(new Error("Token request failed"));

      // Create a promise that will resolve when we simulate the OAuth callback
      const authPromise = authManager.authenticate(serverContext);

      // Simulate the callback from the browser
      mockCreateServer.callback(
        {
          url: `/callback?code=test-auth-code&state=${stateForTest}`,
          headers: {},
        },
        {
          writeHead: jest.fn(),
          end: jest.fn(),
        },
      );

      // The authenticate method should throw an error
      await expect(authPromise).rejects.toThrow();

      // Verify error message was shown
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("failed"),
      );
    });
  });

  describe("getAccessToken", () => {
    it("should return the cached token if not expired", async () => {
      // Set up mock to return a valid token
      const now = Math.floor(Date.now() / 1000);
      keytar.getPassword.mockResolvedValueOnce(
        JSON.stringify({
          accessToken: "valid-access-token",
          refreshToken: "refresh-token",
          expiresAt: now + 1000, // Not expired
        }),
      );

      const token = await authManager.getAccessToken("test-server");

      expect(token).toBe("valid-access-token");
      expect(mockAxiosPost).not.toHaveBeenCalled(); // Should not try to refresh
    });

    it("should refresh the token if expired", async () => {
      // Set up mock to return an expired token
      const now = Math.floor(Date.now() / 1000);
      keytar.getPassword.mockResolvedValueOnce(
        JSON.stringify({
          accessToken: "expired-access-token",
          refreshToken: "refresh-token",
          expiresAt: now - 100, // Expired
        }),
      );

      // Mock server context for the refresh token call
      configManager.getServerContext = jest.fn().mockResolvedValueOnce({
        name: "test-server",
        providerOptions: {
          orbDomain: "test.orb.local",
        },
        clientId: "test-client-id",
      });

      // Mock successful token refresh response
      mockAxiosPost.mockResolvedValueOnce({
        data: {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        },
      });

      const token = await authManager.getAccessToken("test-server");

      expect(token).toBe("new-access-token");
      expect(mockAxiosPost).toHaveBeenCalled(); // Should try to refresh
      expect(keytar.setPassword).toHaveBeenCalled(); // Should store new tokens
    });

    it("should throw an error if no tokens are found", async () => {
      keytar.getPassword.mockResolvedValueOnce(null);

      await expect(authManager.getAccessToken("test-server")).rejects.toThrow(
        "No authentication tokens found",
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        "error",
        "No authentication tokens found. Please authenticate first.",
      );
    });
  });

  describe("logout", () => {
    it("should remove stored tokens", async () => {
      await authManager.logout("test-server");

      expect(keytar.deletePassword).toHaveBeenCalledWith(
        "hola-cli",
        "test-server_tokens",
      );

      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        "success",
        'Logged out from server "test-server"',
      );
    });
  });
});

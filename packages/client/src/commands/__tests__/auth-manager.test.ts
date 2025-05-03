/**
 * Tests for the auth-manager module using Node.js test runner
 */
// Import Node.js test API
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

/**
 * Helper function to mock a module in the require cache
 * @param modulePath - Relative path to the module to mock
 * @param mockImplementation - Mock implementation object
 */
function mockModule(modulePath, mockImplementation) {
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
 * that match a specific pattern
 */
function clearMocks(pattern = "/utils/") {
  Object.keys(require.cache).forEach((key) => {
    if (key.includes(pattern) && !key.includes("node_modules")) {
      delete require.cache[key];
    }
  });
}

/**
 * Helper function for tracking function calls (similar to Jest spies)
 * @param fn - The function to track
 * @returns A wrapped function that tracks calls
 */
function trackCalls(fn) {
  const calls = [];
  const tracked = function (...args) {
    calls.push([...args]);
    return fn ? fn.apply(this, args) : undefined;
  };
  tracked.calls = calls;
  return tracked;
}

describe("Auth Manager (Node.js Test)", () => {
  // Variable to store generated state for verification
  let stateForTest;

  // Mock implementations
  let mockCreateServer;
  let mockServerListen;
  let mockServerClose;
  let mockAxiosPost;
  let mockKeytarGetPassword;
  let mockKeytarSetPassword;
  let mockKeytarDeletePassword;
  let mockOpen;

  beforeEach(() => {
    // Clear mocks before each test
    clearMocks();

    // Setup HTTP server mocks
    mockCreateServer = {
      callback: null,
      server: {
        on: (event, callback) => {
          if (event === "request") {
            mockCreateServer.callback = callback;
          }
          return mockCreateServer.server;
        },
        listen: (port, callback) => {
          if (callback) callback();
          return mockCreateServer.server;
        },
        close: () => {},
      },
    };

    mockServerListen = trackCalls((port, callback) => {
      if (callback) callback();
      return mockCreateServer.server;
    });

    mockServerClose = trackCalls();

    // Setup crypto mock for state generation
    const mockCrypto = {
      randomBytes: (size) => {
        const randomString = "abcdef1234567890";
        stateForTest = randomString;
        return {
          toString: () => randomString,
        };
      },
      createHash: () => ({
        update: () => ({
          digest: () => "mockDigest",
        }),
      }),
    };

    // Setup Axios mock for token requests
    mockAxiosPost = trackCalls(async (url, data) => {
      return {
        data: {
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          expires_in: 3600,
        },
      };
    });

    // Setup keytar mocks
    mockKeytarGetPassword = trackCalls(async () => null);
    mockKeytarSetPassword = trackCalls(async () => {});
    mockKeytarDeletePassword = trackCalls(async () => {});

    // Setup open mock
    mockOpen = trackCalls(async () => {});

    // Setup output formatter mock
    const mockOutputFormatter = {
      formatOutput: trackCalls((type, message) => {}),
    };

    // Mock all dependencies
    mockModule("keytar", {
      getPassword: mockKeytarGetPassword,
      setPassword: mockKeytarSetPassword,
      deletePassword: mockKeytarDeletePassword,
    });

    mockModule("open", mockOpen);

    mockModule("../../utils/config-manager", {
      getServerContext: async () => ({
        name: "test-server",
        providerOptions: {
          orbDomain: "test.orb.local",
        },
        clientId: "test-client-id",
      }),
    });

    mockModule("../../utils/output-formatter", {
      outputFormatter: mockOutputFormatter,
    });

    mockModule("http", {
      createServer: () => mockCreateServer.server,
    });

    mockModule("crypto", mockCrypto);

    mockModule("axios", {
      post: mockAxiosPost,
    });

    // Clear the module under test from cache
    if (require.cache[require.resolve("../../utils/auth-manager")]) {
      delete require.cache[require.resolve("../../utils/auth-manager")];
    }
  });

  describe("authenticate", () => {
    it("should initiate OIDC auth flow and store tokens on success", async () => {
      // Import the module under test after mocking
      const authManager = require("../../utils/auth-manager");

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
          writeHead: () => {},
          end: () => {},
        },
      );

      // Wait for auth flow to complete
      await authPromise;

      // Verify OIDC token request was made
      assert.ok(mockAxiosPost.calls.length > 0, "Axios post should be called");
      assert.ok(
        mockAxiosPost.calls[0][0].includes("token"),
        "URL should contain token endpoint",
      );

      // Verify tokens were stored securely
      assert.ok(
        mockKeytarSetPassword.calls.length > 0,
        "setPassword should be called",
      );
      assert.strictEqual(
        mockKeytarSetPassword.calls[0][0],
        "hola-cli",
        "Service name should be correct",
      );
      assert.strictEqual(
        mockKeytarSetPassword.calls[0][1],
        "test-server_tokens",
        "Account name should include server name",
      );
      assert.ok(
        mockKeytarSetPassword.calls[0][2].includes("test-access-token"),
        "Stored data should include access token",
      );

      // Verify browser was opened with correct URL
      assert.ok(mockOpen.calls.length > 0, "Browser should be opened");
      assert.ok(
        mockOpen.calls[0][0].includes("authorize"),
        "URL should contain authorize endpoint",
      );
    });

    it("should handle authentication errors", async () => {
      // Make the token request fail for this test
      mockAxiosPost = trackCalls(async () => {
        throw new Error("Token request failed");
      });

      mockModule("axios", {
        post: mockAxiosPost,
      });

      // Import the module under test after setting up mocks
      const authManager = require("../../utils/auth-manager");

      const serverContext = {
        name: "test-server",
        providerOptions: {
          orbDomain: "test.orb.local",
        },
        clientId: "test-client-id",
      };

      // Create a promise that will resolve when we simulate the OAuth callback
      const authPromise = authManager.authenticate(serverContext);

      // Simulate the callback from the browser
      mockCreateServer.callback(
        {
          url: `/callback?code=test-auth-code&state=${stateForTest}`,
          headers: {},
        },
        {
          writeHead: () => {},
          end: () => {},
        },
      );

      // The authenticate method should throw an error
      try {
        await authPromise;
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.ok(error, "Should throw an error");
      }

      // Get the output formatter calls
      const { outputFormatter } = require("../../utils/output-formatter");

      // Check if the error message was formatted
      const errorCall = outputFormatter.formatOutput.calls.find(
        (call) => call[0] === "error",
      );
      assert.ok(errorCall, "Should format an error message");
      assert.ok(
        errorCall[1].includes("failed") || errorCall[1].includes("error"),
        "Error message should include failure information",
      );
    });
  });

  describe("getAccessToken", () => {
    it("should return the cached token if not expired", async () => {
      // Setup mock to return a valid token
      const now = Math.floor(Date.now() / 1000);
      mockKeytarGetPassword = trackCalls(async () =>
        JSON.stringify({
          accessToken: "valid-access-token",
          refreshToken: "refresh-token",
          expiresAt: now + 1000, // Not expired
        }),
      );

      mockModule("keytar", {
        getPassword: mockKeytarGetPassword,
        setPassword: mockKeytarSetPassword,
        deletePassword: mockKeytarDeletePassword,
      });

      // Import the module under test after setting up mocks
      const authManager = require("../../utils/auth-manager");

      const token = await authManager.getAccessToken("test-server");

      assert.strictEqual(token, "valid-access-token");
      assert.strictEqual(
        mockAxiosPost.calls.length,
        0,
        "Should not try to refresh",
      );
    });

    it("should refresh the token if expired", async () => {
      // Setup mock to return an expired token
      const now = Math.floor(Date.now() / 1000);
      mockKeytarGetPassword = trackCalls(async () =>
        JSON.stringify({
          accessToken: "expired-access-token",
          refreshToken: "refresh-token",
          expiresAt: now - 100, // Expired
        }),
      );

      mockModule("keytar", {
        getPassword: mockKeytarGetPassword,
        setPassword: mockKeytarSetPassword,
        deletePassword: mockKeytarDeletePassword,
      });

      // Mock successful token refresh response
      mockAxiosPost = trackCalls(async () => ({
        data: {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        },
      }));

      mockModule("axios", {
        post: mockAxiosPost,
      });

      // Import the module under test after setting up mocks
      const authManager = require("../../utils/auth-manager");

      const token = await authManager.getAccessToken("test-server");

      assert.strictEqual(token, "new-access-token");
      assert.ok(mockAxiosPost.calls.length > 0, "Should try to refresh");
      assert.ok(
        mockKeytarSetPassword.calls.length > 0,
        "Should store new tokens",
      );
    });

    it("should throw an error if no tokens are found", async () => {
      // Setup mock to return null (no tokens)
      mockKeytarGetPassword = trackCalls(async () => null);

      mockModule("keytar", {
        getPassword: mockKeytarGetPassword,
        setPassword: mockKeytarSetPassword,
        deletePassword: mockKeytarDeletePassword,
      });

      // Import the module under test after setting up mocks
      const authManager = require("../../utils/auth-manager");

      try {
        await authManager.getAccessToken("test-server");
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.strictEqual(
          error.message,
          "No authentication tokens found",
          "Error message should match",
        );
      }

      // Get the output formatter calls
      const { outputFormatter } = require("../../utils/output-formatter");

      // Check if the error message was formatted
      const errorCall = outputFormatter.formatOutput.calls.find(
        (call) => call[0] === "error",
      );
      assert.ok(errorCall, "Should format an error message");
      assert.strictEqual(
        errorCall[1],
        "No authentication tokens found. Please authenticate first.",
        "Error message should match",
      );
    });
  });

  describe("logout", () => {
    it("should remove stored tokens", async () => {
      // Import the module under test after setting up mocks
      const authManager = require("../../utils/auth-manager");

      await authManager.logout("test-server");

      // Verify keytar.deletePassword was called with correct params
      assert.ok(
        mockKeytarDeletePassword.calls.length > 0,
        "deletePassword should be called",
      );
      assert.strictEqual(
        mockKeytarDeletePassword.calls[0][0],
        "hola-cli",
        "Service name should be correct",
      );
      assert.strictEqual(
        mockKeytarDeletePassword.calls[0][1],
        "test-server_tokens",
        "Account name should include server name",
      );

      // Get the output formatter calls
      const { outputFormatter } = require("../../utils/output-formatter");

      // Check if the success message was formatted
      const successCall = outputFormatter.formatOutput.calls.find(
        (call) => call[0] === "success",
      );
      assert.ok(successCall, "Should format a success message");
      assert.strictEqual(
        successCall[1],
        'Logged out from server "test-server"',
        "Success message should match",
      );
    });
  });
});

/**
 * Tests for auth commands using Node.js test runner
 */
// Import Node.js test API
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

/**
 * Helper function to mock a module in the require cache
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
 */
function clearMocks() {
  Object.keys(require.cache).forEach((key) => {
    if (
      (key.includes("/utils/") || key.includes("/auth/")) &&
      !key.includes("node_modules")
    ) {
      delete require.cache[key];
    }
  });
}

/**
 * Helper function for tracking function calls (similar to Jest spies)
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

describe("Auth Commands", () => {
  beforeEach(() => {
    // Clear mocks before each test
    clearMocks();

    // Setup mock for auth-manager
    mockModule("../../utils/auth-manager", {
      authenticate: trackCalls(async (serverContext) => {
        return { success: true };
      }),
      logout: trackCalls(async (serverName) => {
        return { success: true };
      }),
    });

    // Setup mock for config-manager
    mockModule("../../utils/config-manager", {
      resolveServerContext: trackCalls(async (serverName) => {
        return {
          name: "test-server",
          url: "https://example.org",
          providerOptions: {
            orbDomain: "example.org",
          },
          clientId: "mock-client-id",
        };
      }),
      getServerContexts: trackCalls(async () => {
        return {
          "test-server": {
            name: "test-server",
            url: "https://example.org",
          },
          "other-server": {
            name: "other-server",
            url: "https://other.example.org",
          },
        };
      }),
    });

    // Setup mock for output-formatter
    mockModule("../../utils/output-formatter", {
      formatOutput: trackCalls((type, message) => {}),
    });
  });

  describe("login command", () => {
    it("should authenticate with the resolved server context", async () => {
      // Import after mocking
      const { handler: loginHandler } = require("../auth/login");
      const authManager = require("../../utils/auth-manager");
      const configManager = require("../../utils/config-manager");
      const outputFormatter = require("../../utils/output-formatter");

      const options = {};
      await loginHandler(options);

      assert.strictEqual(configManager.resolveServerContext.calls.length, 1);
      assert.strictEqual(
        configManager.resolveServerContext.calls[0][0],
        undefined,
      );

      assert.strictEqual(authManager.authenticate.calls.length, 1);
      assert.strictEqual(
        authManager.authenticate.calls[0][0].name,
        "test-server",
      );

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      assert.strictEqual(outputFormatter.formatOutput.calls[0][0], "success");
      assert.ok(
        outputFormatter.formatOutput.calls[0][1].includes(
          "Successfully authenticated",
        ),
      );
    });

    it("should use the specified server when --server option is provided", async () => {
      // Import after mocking
      const { handler: loginHandler } = require("../auth/login");
      const configManager = require("../../utils/config-manager");

      const options = { server: "specific-server" };
      await loginHandler(options);

      assert.strictEqual(configManager.resolveServerContext.calls.length, 1);
      assert.strictEqual(
        configManager.resolveServerContext.calls[0][0],
        "specific-server",
      );
    });

    it("should handle errors when no server context is found", async () => {
      // Set up specific mock for this test
      mockModule("../../utils/config-manager", {
        resolveServerContext: trackCalls(async () => null),
      });

      // Import after mocking
      const { handler: loginHandler } = require("../auth/login");
      const authManager = require("../../utils/auth-manager");
      const outputFormatter = require("../../utils/output-formatter");

      const options = {};
      await loginHandler(options);

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      assert.strictEqual(outputFormatter.formatOutput.calls[0][0], "error");
      assert.ok(
        outputFormatter.formatOutput.calls[0][1].includes(
          "No server context found",
        ),
      );

      assert.strictEqual(authManager.authenticate.calls.length, 0);
    });

    it("should handle authentication errors", async () => {
      // Set up specific mock for this test
      mockModule("../../utils/auth-manager", {
        authenticate: trackCalls(async () => {
          throw new Error("Authentication failed");
        }),
      });

      // Import after mocking
      const { handler: loginHandler } = require("../auth/login");
      const outputFormatter = require("../../utils/output-formatter");

      const options = {};
      await loginHandler(options);

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      assert.strictEqual(outputFormatter.formatOutput.calls[0][0], "error");
      assert.ok(
        outputFormatter.formatOutput.calls[0][1].includes("Login failed"),
      );
    });
  });

  describe("logout command", () => {
    it("should log out from the resolved server context", async () => {
      // Import after mocking
      const { handler: logoutHandler } = require("../auth/logout");
      const configManager = require("../../utils/config-manager");
      const authManager = require("../../utils/auth-manager");
      const outputFormatter = require("../../utils/output-formatter");

      const options = {};
      await logoutHandler(options);

      assert.strictEqual(configManager.resolveServerContext.calls.length, 1);
      assert.strictEqual(authManager.logout.calls.length, 1);
      assert.strictEqual(authManager.logout.calls[0][0], "test-server");

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      assert.strictEqual(outputFormatter.formatOutput.calls[0][0], "success");
      assert.ok(
        outputFormatter.formatOutput.calls[0][1].includes(
          "Logged out from server",
        ),
      );
    });

    it("should log out from all servers when --all option is provided", async () => {
      // Import after mocking
      const { handler: logoutHandler } = require("../auth/logout");
      const configManager = require("../../utils/config-manager");
      const authManager = require("../../utils/auth-manager");
      const outputFormatter = require("../../utils/output-formatter");

      const options = { all: true };
      await logoutHandler(options);

      assert.strictEqual(configManager.getServerContexts.calls.length, 1);
      assert.strictEqual(authManager.logout.calls.length, 2); // For two server contexts

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      assert.strictEqual(outputFormatter.formatOutput.calls[0][0], "success");
      assert.ok(
        outputFormatter.formatOutput.calls[0][1].includes(
          "Logged out from all",
        ),
      );
    });

    it("should handle errors when no server context is found", async () => {
      // Set up specific mock for this test
      mockModule("../../utils/config-manager", {
        resolveServerContext: trackCalls(async () => null),
        getServerContexts: trackCalls(async () => ({})),
      });

      // Import after mocking
      const { handler: logoutHandler } = require("../auth/logout");
      const authManager = require("../../utils/auth-manager");
      const outputFormatter = require("../../utils/output-formatter");

      const options = {};
      await logoutHandler(options);

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      assert.strictEqual(outputFormatter.formatOutput.calls[0][0], "error");
      assert.ok(
        outputFormatter.formatOutput.calls[0][1].includes(
          "No server context found",
        ),
      );

      assert.strictEqual(authManager.logout.calls.length, 0);
    });

    it("should handle logout errors", async () => {
      // Set up specific mock for this test
      mockModule("../../utils/auth-manager", {
        logout: trackCalls(async () => {
          throw new Error("Logout failed");
        }),
      });

      // Import after mocking
      const { handler: logoutHandler } = require("../auth/logout");
      const outputFormatter = require("../../utils/output-formatter");

      const options = {};
      await logoutHandler(options);

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      assert.strictEqual(outputFormatter.formatOutput.calls[0][0], "error");
      assert.ok(
        outputFormatter.formatOutput.calls[0][1].includes("Logout failed"),
      );
    });
  });
});

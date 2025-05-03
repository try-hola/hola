/**
 * Tests for app commands using Node.js test runner
 */
const { describe, it } = require("node:test");
const assert = require("node:assert");

// Helper function for tracking function calls (similar to Jest spies)
function trackCalls(fn) {
  const calls = [];
  const tracked = function (...args) {
    calls.push([...args]);
    return fn ? fn.apply(this, args) : undefined;
  };
  tracked.calls = calls;
  return tracked;
}

describe("App Commands (Node.js Test)", () => {
  describe("app list command", () => {
    it("should list apps in table format by default", async () => {
      // Clear module cache to ensure fresh state
      Object.keys(require.cache).forEach((key) => {
        if (key.includes("/utils/") && !key.includes("node_modules")) {
          delete require.cache[key];
        }
        if (key.includes("/commands/app/")) {
          delete require.cache[key];
        }
      });

      // Setup mock response
      const mockResponse = {
        success: true,
        data: { apps: ["app1", "app2", "app3"] },
      };

      // Create API client mock
      const mockGet = trackCalls(async (url) => {
        assert.strictEqual(url, "/api/apps", "API endpoint should be correct");
        return mockResponse;
      });

      require.cache[require.resolve("../../utils/api-client")] = {
        exports: {
          get: mockGet,
          post: () => {},
          delete: () => {},
        },
        id: require.resolve("../../utils/api-client"),
        filename: require.resolve("../../utils/api-client"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Create output formatter mock
      const mockFormatOutput = trackCalls(() => {});
      require.cache[require.resolve("../../utils/output-formatter")] = {
        exports: {
          formatOutput: mockFormatOutput,
        },
        id: require.resolve("../../utils/output-formatter"),
        filename: require.resolve("../../utils/output-formatter"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Setup other required mocks
      require.cache[require.resolve("../../utils/logger")] = {
        exports: {
          debug: () => {},
          info: () => {},
          error: () => {},
          warn: () => {},
        },
        id: require.resolve("../../utils/logger"),
        filename: require.resolve("../../utils/logger"),
        loaded: true,
        children: [],
        paths: [],
      };

      require.cache[require.resolve("../../utils/error-handler")] = {
        exports: {
          handleCommandError: () => {},
        },
        id: require.resolve("../../utils/error-handler"),
        filename: require.resolve("../../utils/error-handler"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Import app/list module after mocking
      const appListModule = require("../../commands/app/list");
      const { handler: listHandler } = appListModule;

      // Call the handler
      const options = { output: "table" };
      const result = await listHandler(options);

      // Verify API call
      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );
      assert.strictEqual(
        mockGet.calls[0][0],
        "/api/apps",
        "API endpoint should be correct",
      );

      // Verify output formatting
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0][0],
        [{ name: "app1" }, { name: "app2" }, { name: "app3" }],
        "App data should be formatted correctly",
      );
      assert.strictEqual(
        mockFormatOutput.calls[0][1],
        "table",
        "Output format should be table",
      );

      // Verify result
      assert.deepStrictEqual(
        result,
        { success: true, data: ["app1", "app2", "app3"] },
        "Result should match expected structure",
      );
    });

    it("should list apps in JSON format when specified", async () => {
      // Clear module cache to ensure fresh state
      Object.keys(require.cache).forEach((key) => {
        if (key.includes("/utils/") && !key.includes("node_modules")) {
          delete require.cache[key];
        }
        if (key.includes("/commands/app/")) {
          delete require.cache[key];
        }
      });

      // Setup mock response
      const mockResponse = {
        success: true,
        data: { apps: ["app1", "app2", "app3"] },
      };

      // Create API client mock
      const mockGet = trackCalls(async (url) => {
        assert.strictEqual(url, "/api/apps", "API endpoint should be correct");
        return mockResponse;
      });

      require.cache[require.resolve("../../utils/api-client")] = {
        exports: {
          get: mockGet,
          post: () => {},
          delete: () => {},
        },
        id: require.resolve("../../utils/api-client"),
        filename: require.resolve("../../utils/api-client"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Create output formatter mock
      const mockFormatOutput = trackCalls(() => {});
      require.cache[require.resolve("../../utils/output-formatter")] = {
        exports: {
          formatOutput: mockFormatOutput,
        },
        id: require.resolve("../../utils/output-formatter"),
        filename: require.resolve("../../utils/output-formatter"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Setup other required mocks
      require.cache[require.resolve("../../utils/logger")] = {
        exports: {
          debug: () => {},
          info: () => {},
          error: () => {},
          warn: () => {},
        },
        id: require.resolve("../../utils/logger"),
        filename: require.resolve("../../utils/logger"),
        loaded: true,
        children: [],
        paths: [],
      };

      require.cache[require.resolve("../../utils/error-handler")] = {
        exports: {
          handleCommandError: () => {},
        },
        id: require.resolve("../../utils/error-handler"),
        filename: require.resolve("../../utils/error-handler"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Import app/list module after mocking
      const appListModule = require("../../commands/app/list");
      const { handler: listHandler } = appListModule;

      // Call the handler
      const options = { output: "json" };
      const result = await listHandler(options);

      // Verify API call
      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );
      assert.strictEqual(
        mockGet.calls[0][0],
        "/api/apps",
        "API endpoint should be correct",
      );

      // Verify output formatting
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0][0],
        [{ name: "app1" }, { name: "app2" }, { name: "app3" }],
        "App data should be formatted correctly",
      );
      assert.strictEqual(
        mockFormatOutput.calls[0][1],
        "json",
        "Output format should be json",
      );

      // Verify result
      assert.deepStrictEqual(
        result,
        { success: true, data: ["app1", "app2", "app3"] },
        "Result should match expected structure",
      );
    });

    it("should handle empty app list", async () => {
      // Clear module cache to ensure fresh state
      Object.keys(require.cache).forEach((key) => {
        if (key.includes("/utils/") && !key.includes("node_modules")) {
          delete require.cache[key];
        }
        if (key.includes("/commands/app/")) {
          delete require.cache[key];
        }
      });

      // Setup mock response
      const mockResponse = {
        success: true,
        data: { apps: [] },
      };

      // Create API client mock
      const mockGet = trackCalls(async (url) => {
        assert.strictEqual(url, "/api/apps", "API endpoint should be correct");
        return mockResponse;
      });

      require.cache[require.resolve("../../utils/api-client")] = {
        exports: {
          get: mockGet,
          post: () => {},
          delete: () => {},
        },
        id: require.resolve("../../utils/api-client"),
        filename: require.resolve("../../utils/api-client"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Create output formatter mock
      const mockFormatOutput = trackCalls(() => {});
      require.cache[require.resolve("../../utils/output-formatter")] = {
        exports: {
          formatOutput: mockFormatOutput,
        },
        id: require.resolve("../../utils/output-formatter"),
        filename: require.resolve("../../utils/output-formatter"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Setup other required mocks
      require.cache[require.resolve("../../utils/logger")] = {
        exports: {
          debug: () => {},
          info: () => {},
          error: () => {},
          warn: () => {},
        },
        id: require.resolve("../../utils/logger"),
        filename: require.resolve("../../utils/logger"),
        loaded: true,
        children: [],
        paths: [],
      };

      require.cache[require.resolve("../../utils/error-handler")] = {
        exports: {
          handleCommandError: () => {},
        },
        id: require.resolve("../../utils/error-handler"),
        filename: require.resolve("../../utils/error-handler"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Import app/list module after mocking
      const appListModule = require("../../commands/app/list");
      const { handler: listHandler } = appListModule;

      // Call the handler
      const options = { output: "table" };
      const result = await listHandler(options);

      // Verify API call
      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );
      assert.strictEqual(
        mockGet.calls[0][0],
        "/api/apps",
        "API endpoint should be correct",
      );

      // Verify output formatting
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0][0],
        { message: "No applications deployed" },
        "Empty list message should be formatted",
      );
      assert.strictEqual(
        mockFormatOutput.calls[0][1],
        "table",
        "Output format should be table",
      );

      // Verify result
      assert.deepStrictEqual(
        result,
        { success: true, data: [] },
        "Result should match expected structure",
      );
    });

    it("should handle API errors", async () => {
      // Clear module cache to ensure fresh state
      Object.keys(require.cache).forEach((key) => {
        if (key.includes("/utils/") && !key.includes("node_modules")) {
          delete require.cache[key];
        }
        if (key.includes("/commands/app/")) {
          delete require.cache[key];
        }
      });

      // Setup mock error
      const mockError = new Error("API connection failed");

      // Create API client mock that throws
      const mockGet = trackCalls(async () => {
        throw mockError;
      });

      require.cache[require.resolve("../../utils/api-client")] = {
        exports: {
          get: mockGet,
          post: () => {},
          delete: () => {},
        },
        id: require.resolve("../../utils/api-client"),
        filename: require.resolve("../../utils/api-client"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Create output formatter mock
      const mockFormatOutput = trackCalls(() => {});
      require.cache[require.resolve("../../utils/output-formatter")] = {
        exports: {
          formatOutput: mockFormatOutput,
        },
        id: require.resolve("../../utils/output-formatter"),
        filename: require.resolve("../../utils/output-formatter"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Setup other required mocks
      require.cache[require.resolve("../../utils/logger")] = {
        exports: {
          debug: () => {},
          info: () => {},
          error: () => {},
          warn: () => {},
        },
        id: require.resolve("../../utils/logger"),
        filename: require.resolve("../../utils/logger"),
        loaded: true,
        children: [],
        paths: [],
      };

      require.cache[require.resolve("../../utils/error-handler")] = {
        exports: {
          handleCommandError: () => {},
        },
        id: require.resolve("../../utils/error-handler"),
        filename: require.resolve("../../utils/error-handler"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Import app/list module after mocking
      const appListModule = require("../../commands/app/list");
      const { handler: listHandler } = appListModule;

      // Call the handler
      const options = { output: "table" };
      const result = await listHandler(options);

      // Verify API call was attempted
      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );

      // Verify result contains error info
      assert.strictEqual(
        result.success,
        false,
        "Result should indicate failure",
      );
      assert.ok(result.error, "Result should contain error object");
      assert.strictEqual(
        result.error.code,
        mockError.code || "LIST_ERROR",
        "Error code should match",
      );
      assert.strictEqual(
        result.error.message,
        mockError.message || "Unknown error",
        "Error message should match",
      );
    });
  });

  describe("app info command", () => {
    it("should show app details in table format by default", async () => {
      // Clear module cache to ensure fresh state
      Object.keys(require.cache).forEach((key) => {
        if (key.includes("/utils/") && !key.includes("node_modules")) {
          delete require.cache[key];
        }
        if (key.includes("/commands/app/")) {
          delete require.cache[key];
        }
      });

      // Setup mock response
      const mockAppDetails = {
        name: "test-app1",
        status: "running",
        version: "1.0.0",
        port: 3000,
        createdAt: "2025-04-01T10:30:00.000Z",
      };

      const mockResponse = {
        success: true,
        data: mockAppDetails,
      };

      // Create API client mock
      const mockGet = trackCalls(async (url) => {
        assert.strictEqual(
          url,
          "/api/apps/test-app1",
          "API endpoint should be correct",
        );
        return mockResponse;
      });

      require.cache[require.resolve("../../utils/api-client")] = {
        exports: {
          get: mockGet,
          post: () => {},
          delete: () => {},
        },
        id: require.resolve("../../utils/api-client"),
        filename: require.resolve("../../utils/api-client"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Create output formatter mock
      const mockFormatOutput = trackCalls(() => {});
      require.cache[require.resolve("../../utils/output-formatter")] = {
        exports: {
          formatOutput: mockFormatOutput,
        },
        id: require.resolve("../../utils/output-formatter"),
        filename: require.resolve("../../utils/output-formatter"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Setup other required mocks
      require.cache[require.resolve("../../utils/logger")] = {
        exports: {
          debug: () => {},
          info: () => {},
          error: () => {},
          warn: () => {},
        },
        id: require.resolve("../../utils/logger"),
        filename: require.resolve("../../utils/logger"),
        loaded: true,
        children: [],
        paths: [],
      };

      require.cache[require.resolve("../../utils/error-handler")] = {
        exports: {
          handleCommandError: () => {},
        },
        id: require.resolve("../../utils/error-handler"),
        filename: require.resolve("../../utils/error-handler"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Import app/info module after mocking
      const appInfoModule = require("../../commands/app/info");
      const { handler: infoHandler } = appInfoModule;

      // Call the handler
      const options = { output: "table" };
      const result = await infoHandler("test-app1", options);

      // Verify API call
      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );
      assert.strictEqual(
        mockGet.calls[0][0],
        "/api/apps/test-app1",
        "API endpoint should be correct",
      );

      // Verify output formatting
      assert.strictEqual(
        mockFormatOutput.calls.length,
        2,
        "formatOutput should be called twice",
      );

      // First call for app name header
      assert.deepStrictEqual(
        mockFormatOutput.calls[0][0],
        [{ property: "Application", value: "test-app1" }],
        "App header should be formatted",
      );
      assert.strictEqual(
        mockFormatOutput.calls[0][1],
        "table",
        "Output format should be table",
      );

      // Second call for app details
      const secondCallData = mockFormatOutput.calls[1][0];
      assert.ok(
        Array.isArray(secondCallData),
        "Second call data should be an array",
      );
      assert.ok(
        secondCallData.some(
          (item) => item.property === "name" && item.value === "test-app1",
        ),
        "App details should include name",
      );
      assert.ok(
        secondCallData.some(
          (item) => item.property === "status" && item.value === "running ✓",
        ),
        "App details should include status with checkmark",
      );
      assert.strictEqual(
        mockFormatOutput.calls[1][1],
        "table",
        "Output format should be table",
      );

      // Verify result
      assert.deepStrictEqual(
        result,
        { success: true, data: mockAppDetails },
        "Result should match expected structure",
      );
    });

    it("should show app details in JSON format when specified", async () => {
      // Clear module cache to ensure fresh state
      Object.keys(require.cache).forEach((key) => {
        if (key.includes("/utils/") && !key.includes("node_modules")) {
          delete require.cache[key];
        }
        if (key.includes("/commands/app/")) {
          delete require.cache[key];
        }
      });

      // Setup mock response
      const mockAppDetails = {
        name: "test-app1",
        status: "stopped",
        version: "1.0.0",
      };

      const mockResponse = {
        success: true,
        data: mockAppDetails,
      };

      // Create API client mock
      const mockGet = trackCalls(async (url) => {
        assert.strictEqual(
          url,
          "/api/apps/test-app1",
          "API endpoint should be correct",
        );
        return mockResponse;
      });

      require.cache[require.resolve("../../utils/api-client")] = {
        exports: {
          get: mockGet,
          post: () => {},
          delete: () => {},
        },
        id: require.resolve("../../utils/api-client"),
        filename: require.resolve("../../utils/api-client"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Create output formatter mock
      const mockFormatOutput = trackCalls(() => {});
      require.cache[require.resolve("../../utils/output-formatter")] = {
        exports: {
          formatOutput: mockFormatOutput,
        },
        id: require.resolve("../../utils/output-formatter"),
        filename: require.resolve("../../utils/output-formatter"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Setup other required mocks
      require.cache[require.resolve("../../utils/logger")] = {
        exports: {
          debug: () => {},
          info: () => {},
          error: () => {},
          warn: () => {},
        },
        id: require.resolve("../../utils/logger"),
        filename: require.resolve("../../utils/logger"),
        loaded: true,
        children: [],
        paths: [],
      };

      require.cache[require.resolve("../../utils/error-handler")] = {
        exports: {
          handleCommandError: () => {},
        },
        id: require.resolve("../../utils/error-handler"),
        filename: require.resolve("../../utils/error-handler"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Import app/info module after mocking
      const appInfoModule = require("../../commands/app/info");
      const { handler: infoHandler } = appInfoModule;

      // Call the handler
      const options = { output: "json" };
      const result = await infoHandler("test-app1", options);

      // Verify API call
      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );
      assert.strictEqual(
        mockGet.calls[0][0],
        "/api/apps/test-app1",
        "API endpoint should be correct",
      );

      // Verify output formatting
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0][0],
        mockAppDetails,
        "App details should be formatted correctly",
      );
      assert.strictEqual(
        mockFormatOutput.calls[0][1],
        "json",
        "Output format should be json",
      );

      // Verify result
      assert.deepStrictEqual(
        result,
        { success: true, data: mockAppDetails },
        "Result should match expected structure",
      );
    });

    it("should handle errors when app doesn't exist", async () => {
      // Clear module cache to ensure fresh state
      Object.keys(require.cache).forEach((key) => {
        if (key.includes("/utils/") && !key.includes("node_modules")) {
          delete require.cache[key];
        }
        if (key.includes("/commands/app/")) {
          delete require.cache[key];
        }
      });

      // Setup mock error
      const mockError = new Error("App not found");
      mockError.response = { status: 404 };

      // Create API client mock that throws
      const mockGet = trackCalls(async () => {
        throw mockError;
      });

      require.cache[require.resolve("../../utils/api-client")] = {
        exports: {
          get: mockGet,
          post: () => {},
          delete: () => {},
        },
        id: require.resolve("../../utils/api-client"),
        filename: require.resolve("../../utils/api-client"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Create output formatter mock
      const mockFormatOutput = trackCalls(() => {});
      require.cache[require.resolve("../../utils/output-formatter")] = {
        exports: {
          formatOutput: mockFormatOutput,
        },
        id: require.resolve("../../utils/output-formatter"),
        filename: require.resolve("../../utils/output-formatter"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Setup other required mocks
      require.cache[require.resolve("../../utils/logger")] = {
        exports: {
          debug: () => {},
          info: () => {},
          error: () => {},
          warn: () => {},
        },
        id: require.resolve("../../utils/logger"),
        filename: require.resolve("../../utils/logger"),
        loaded: true,
        children: [],
        paths: [],
      };

      require.cache[require.resolve("../../utils/error-handler")] = {
        exports: {
          handleCommandError: () => {},
        },
        id: require.resolve("../../utils/error-handler"),
        filename: require.resolve("../../utils/error-handler"),
        loaded: true,
        children: [],
        paths: [],
      };

      // Import app/info module after mocking
      const appInfoModule = require("../../commands/app/info");
      const { handler: infoHandler } = appInfoModule;

      // Call the handler
      const options = { output: "table" };
      const result = await infoHandler("non-existent-app", options);

      // Verify API call was attempted
      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );
      assert.strictEqual(
        mockGet.calls[0][0],
        "/api/apps/non-existent-app",
        "API endpoint should be correct",
      );

      // Verify result contains error info
      assert.strictEqual(
        result.success,
        false,
        "Result should indicate failure",
      );
      assert.ok(result.error, "Result should contain error object");
      assert.strictEqual(
        result.error.code,
        mockError.code || "INFO_ERROR",
        "Error code should match",
      );
      assert.strictEqual(
        result.error.message,
        mockError.message || "Unknown error",
        "Error message should match",
      );
    });
  });
});

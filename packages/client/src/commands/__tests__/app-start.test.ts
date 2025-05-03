// app-start.node.test.ts - Node.js test runner version
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

// Create reusable test for command handlers since start, stop, and restart are similar
function testAppCommand(commandName, handlerModulePath, endpoint) {
  describe(`App ${commandName} Command`, () => {
    beforeEach(() => {
      // Clear mocks before each test
      clearMocks();

      // Clear the modules under test from the cache
      const moduleUnderTestPaths = [
        "../app/start",
        "../app/stop",
        "../app/restart",
      ];

      moduleUnderTestPaths.forEach((path) => {
        if (require.cache[require.resolve(path)]) {
          delete require.cache[require.resolve(path)];
        }
      });
    });

    it(`should ${commandName} an application successfully`, async () => {
      // Setup mocks
      const formatOutputSpy = trackCalls();

      let apiPostUrl = null;
      const postSpy = trackCalls(async (url) => {
        apiPostUrl = url;
        return {
          success: true,
          data: {
            success: true,
            message: `Application ${commandName}ed successfully`,
          },
        };
      });

      // Setup dependencies
      mockModule("../../utils/api-client", {
        post: postSpy,
        getCurrentServer: () => ({
          url: "http://localhost:3000",
          name: "local",
        }),
      });

      mockModule("../../utils/output-formatter", {
        formatOutput: formatOutputSpy,
      });

      mockModule("../../utils/logger", {
        debug: () => {},
        info: () => {},
        error: () => {},
        warn: () => {},
      });

      mockModule("../../utils/error-handler", {
        handleCommandError: () => {},
      });

      // Import the module under test after setting up mocks
      const { handler } = require(handlerModulePath);

      // Execute the handler function
      const options = { server: "local" };
      const result = await handler("test-app", options);

      // Verify API was called correctly
      assert.strictEqual(apiPostUrl, `/api/apps/test-app/${endpoint}`);
      assert.strictEqual(postSpy.calls.length, 1);

      // Verify output formatter was called (for start command)
      if (commandName === "start") {
        assert.ok(formatOutputSpy.calls.length > 0);
        assert.ok(
          formatOutputSpy.calls[0][0].message &&
            formatOutputSpy.calls[0][0].message.includes("successfully"),
          `Output should mention that app was ${commandName}ed successfully`,
        );
        assert.strictEqual(formatOutputSpy.calls[0][1], "table");
      }

      // Verify result
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.success, true);
      assert.ok(result.data.message.includes(`${commandName}ed successfully`));
    });

    it(`should handle API errors when ${commandName}ing an application`, async () => {
      // Setup mocks
      mockModule("../../utils/api-client", {
        post: async () => {
          throw new Error("API connection failed");
        },
        getCurrentServer: () => ({
          url: "http://localhost:3000",
          name: "local",
        }),
      });

      mockModule("../../utils/output-formatter", {
        formatOutput: trackCalls(),
      });

      mockModule("../../utils/logger", {
        debug: () => {},
        info: () => {},
        error: () => {},
        warn: () => {},
      });

      mockModule("../../utils/error-handler", {
        handleCommandError: () => {},
      });

      // Import the module under test after setting up mocks
      const { handler } = require(handlerModulePath);

      // Execute the handler function
      const options = { server: "local" };
      const result = await handler("test-app1", options);

      // Verify result
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error.message, "API connection failed");
      const expectedErrorCode = `${commandName.toUpperCase()}_ERROR`;
      assert.strictEqual(result.error.code, expectedErrorCode);
    });

    it(`should handle unsuccessful application ${commandName}`, async () => {
      // Setup mocks
      mockModule("../../utils/api-client", {
        post: async () => {
          return {
            success: false,
            error: {
              code: `${commandName.toUpperCase()}_FAILED`,
              message: `Application failed to ${commandName}`,
            },
          };
        },
        getCurrentServer: () => ({
          url: "http://localhost:3000",
          name: "local",
        }),
      });

      const formatOutputSpy = trackCalls();
      mockModule("../../utils/output-formatter", {
        formatOutput: formatOutputSpy,
      });

      mockModule("../../utils/logger", {
        debug: () => {},
        info: () => {},
        error: () => {},
        warn: () => {},
      });

      mockModule("../../utils/error-handler", {
        handleCommandError: () => {},
      });

      // Import the module under test after setting up mocks
      const { handler } = require(handlerModulePath);

      // Execute the handler function
      const options = { server: "local" };
      const result = await handler("test-app1", options);

      // Verify output formatter was called (for start command)
      if (commandName === "start") {
        assert.ok(formatOutputSpy.calls.length > 0);
        assert.ok(formatOutputSpy.calls[0][0].error);
        assert.strictEqual(
          formatOutputSpy.calls[0][0].error.code,
          "START_FAILED",
        );
        assert.strictEqual(formatOutputSpy.calls[0][1], "table");
      }

      // Verify result
      assert.strictEqual(result.success, false);
      assert.strictEqual(
        result.error.code,
        `${commandName.toUpperCase()}_FAILED`,
      );
      assert.strictEqual(
        result.error.message,
        `Application failed to ${commandName}`,
      );
    });
  });
}

// Our test suite for app commands
describe("App Commands Tests", () => {
  // Test the start command
  testAppCommand("start", "../app/start", "start");

  // Test the stop command
  testAppCommand("stop", "../app/stop", "stop");

  // Test the restart command
  testAppCommand("restart", "../app/restart", "restart");
});

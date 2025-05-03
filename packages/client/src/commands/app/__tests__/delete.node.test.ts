/**
 * Tests for app delete command using Node.js test runner
 */
const { describe, it } = require("node:test");
const assert = require("node:assert");

// Helper function for tracking function calls
function trackCalls(fn) {
  const calls = [];
  const tracked = function (...args) {
    calls.push([...args]);
    return fn ? fn.apply(this, args) : undefined;
  };
  tracked.calls = calls;
  return tracked;
}

describe("App Delete Command (Node.js Test)", () => {
  it("should delete an application successfully", async () => {
    // Clear module cache to ensure fresh state
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("/utils/") && !key.includes("node_modules")) {
        delete require.cache[key];
      }
      if (key.includes("/commands/app/")) {
        delete require.cache[key];
      }
    });

    // Mock api-client with successful response
    const mockDelete = trackCalls(async () => ({ success: true }));
    require.cache[require.resolve("../../../utils/api-client")] = {
      exports: {
        delete: mockDelete,
      },
      id: require.resolve("../../../utils/api-client"),
      filename: require.resolve("../../../utils/api-client"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock output-formatter
    const mockFormatOutput = trackCalls(() => {});
    require.cache[require.resolve("../../../utils/output-formatter")] = {
      exports: {
        formatOutput: mockFormatOutput,
      },
      id: require.resolve("../../../utils/output-formatter"),
      filename: require.resolve("../../../utils/output-formatter"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Import the handler after mocking
    const deleteModule = require("../delete");

    // Call the delete handler
    const result = await deleteModule.handler("myapp", {});

    // Verify API call
    assert.strictEqual(
      mockDelete.calls.length,
      1,
      "delete should be called once",
    );
    assert.strictEqual(
      mockDelete.calls[0][0],
      "/api/apps/myapp",
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
      { message: "Application 'myapp' deleted successfully." },
      "Success message should be correct",
    );
    assert.strictEqual(
      mockFormatOutput.calls[0][1],
      "table",
      "Output format should be table",
    );

    // Verify result
    assert.strictEqual(result.success, true, "Result should indicate success");
  });

  it("should handle API error response", async () => {
    // Clear module cache to ensure fresh state
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("/utils/") && !key.includes("node_modules")) {
        delete require.cache[key];
      }
      if (key.includes("/commands/app/")) {
        delete require.cache[key];
      }
    });

    // Mock api-client with error response
    const errorResponse = {
      success: false,
      error: { code: "NOT_FOUND", message: "App not found", details: {} },
    };
    const mockDelete = trackCalls(async () => errorResponse);
    require.cache[require.resolve("../../../utils/api-client")] = {
      exports: {
        delete: mockDelete,
      },
      id: require.resolve("../../../utils/api-client"),
      filename: require.resolve("../../../utils/api-client"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock output-formatter
    const mockFormatOutput = trackCalls(() => {});
    require.cache[require.resolve("../../../utils/output-formatter")] = {
      exports: {
        formatOutput: mockFormatOutput,
      },
      id: require.resolve("../../../utils/output-formatter"),
      filename: require.resolve("../../../utils/output-formatter"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Import the handler after mocking
    const deleteModule = require("../delete");

    // Call the delete handler
    const result = await deleteModule.handler("missingapp", {});

    // Verify API call
    assert.strictEqual(
      mockDelete.calls.length,
      1,
      "delete should be called once",
    );
    assert.strictEqual(
      mockDelete.calls[0][0],
      "/api/apps/missingapp",
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
      {
        error: {
          code: "NOT_FOUND",
          message: "App not found",
          details: {},
        },
      },
      "Error message should be correct",
    );
    assert.strictEqual(
      mockFormatOutput.calls[0][1],
      "table",
      "Output format should be table",
    );

    // Verify result
    assert.strictEqual(result.success, false, "Result should indicate failure");
    assert.deepStrictEqual(
      result.error,
      { code: "NOT_FOUND", message: "App not found", details: {} },
      "Error details should be correct",
    );
  });

  it("should handle thrown exceptions", async () => {
    // Clear module cache to ensure fresh state
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("/utils/") && !key.includes("node_modules")) {
        delete require.cache[key];
      }
      if (key.includes("/commands/app/")) {
        delete require.cache[key];
      }
    });

    // Create an error to be thrown
    const error = new Error("Network error");

    // Mock api-client that throws an error
    const mockDelete = trackCalls(async () => {
      throw error;
    });
    require.cache[require.resolve("../../../utils/api-client")] = {
      exports: {
        delete: mockDelete,
      },
      id: require.resolve("../../../utils/api-client"),
      filename: require.resolve("../../../utils/api-client"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock output-formatter
    const mockFormatOutput = trackCalls(() => {});
    require.cache[require.resolve("../../../utils/output-formatter")] = {
      exports: {
        formatOutput: mockFormatOutput,
      },
      id: require.resolve("../../../utils/output-formatter"),
      filename: require.resolve("../../../utils/output-formatter"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Import the handler after mocking
    const deleteModule = require("../delete");

    // Call the delete handler
    const result = await deleteModule.handler("failapp", {});

    // Verify API call
    assert.strictEqual(
      mockDelete.calls.length,
      1,
      "delete should be called once",
    );
    assert.strictEqual(
      mockDelete.calls[0][0],
      "/api/apps/failapp",
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
      {
        error: {
          code: error.code || "DELETE_ERROR",
          message: error.message || "Unknown error",
          details: error.details,
        },
      },
      "Error message should be correct",
    );
    assert.strictEqual(
      mockFormatOutput.calls[0][1],
      "table",
      "Output format should be table",
    );

    // Verify result
    assert.strictEqual(result.success, false, "Result should indicate failure");
    assert.deepStrictEqual(
      result.error,
      {
        code: error.code || "DELETE_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
      "Error details should be correct",
    );
  });
});

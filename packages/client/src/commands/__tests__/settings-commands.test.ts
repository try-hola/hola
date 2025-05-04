/**
 * Tests for settings commands using Node.js test runner
 */
// Import Node.js test API
const { describe, it, beforeEach, after } = require("node:test");
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
      (key.includes("/utils/") || key.includes("/settings/")) &&
      !key.includes("node_modules")
    ) {
      delete require.cache[key];
    }
  });
}

/**
 * Helper function for tracking function calls
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

// Mock process.exit to prevent tests from exiting
const originalExit = process.exit;
let exitSpy;

// Create a mock commander object
function createMockCommand() {
  const mockCommand = {
    command: function () {
      return this;
    },
    description: function () {
      return this;
    },
    option: function () {
      return this;
    },
    argument: function () {
      return this;
    },
    action: function (handler) {
      this._handler = handler;
      return this;
    },
    addCommand: function () {
      return this;
    },
  };

  // Add tracking to each method
  mockCommand.command = trackCalls(mockCommand.command.bind(mockCommand));
  mockCommand.description = trackCalls(
    mockCommand.description.bind(mockCommand),
  );
  mockCommand.option = trackCalls(mockCommand.option.bind(mockCommand));
  mockCommand.argument = trackCalls(mockCommand.argument.bind(mockCommand));
  mockCommand.action = trackCalls(mockCommand.action.bind(mockCommand));
  mockCommand.addCommand = trackCalls(mockCommand.addCommand.bind(mockCommand));

  return mockCommand;
}

describe("Settings Commands", () => {
  beforeEach(() => {
    // Clear mocks before each test
    clearMocks();

    // Set up exitSpy for this test
    exitSpy = trackCalls(() => {});
    process.exit = exitSpy;

    // Setup mock for config-manager
    mockModule("../../utils/config-manager", {
      loadConfig: trackCalls(async () => ({
        server_url: "http://localhost:3000",
        timeout: 5000,
        output_format: "table",
      })),
      saveConfig: trackCalls(async () => undefined),
    });

    // Setup mock for output-formatter
    mockModule("../../utils/output-formatter", {
      formatOutput: trackCalls(() => {}),
    });
  });

  // Restore original process.exit after all tests
  after(() => {
    process.exit = originalExit;
  });

  describe("settings get", () => {
    it("should output all settings in table format by default", async () => {
      // Import after mocking
      const registerGet = require("../settings/get");
      const configManager = require("../../utils/config-manager");
      const outputFormatter = require("../../utils/output-formatter");

      const mockCommand = createMockCommand();
      registerGet(mockCommand);
      const handler = mockCommand._handler;
      await handler({});

      assert.strictEqual(configManager.loadConfig.calls.length, 1);
      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);

      // Check that formatOutput was called with settings and table format
      const outputArgs = outputFormatter.formatOutput.calls[0];
      assert.ok(outputArgs[0].server_url);
      assert.strictEqual(outputArgs[1], "table");
    });

    it("should output a specific setting if key is provided", async () => {
      // Import after mocking
      const registerGet = require("../settings/get");
      const outputFormatter = require("../../utils/output-formatter");

      const mockCommand = createMockCommand();
      registerGet(mockCommand);
      const handler = mockCommand._handler;

      await handler({ key: "server_url" });

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      const outputArgs = outputFormatter.formatOutput.calls[0];
      assert.deepStrictEqual(outputArgs[0], {
        server_url: "http://localhost:3000",
      });
      assert.strictEqual(outputArgs[1], "table");
    });

    it("should output error if key does not exist", async () => {
      // Set up specific mock for this test
      mockModule("../../utils/config-manager", {
        loadConfig: trackCalls(async () => ({ foo: "bar" })),
      });

      // Import after mocking
      const registerGet = require("../settings/get");
      const outputFormatter = require("../../utils/output-formatter");

      const mockCommand = createMockCommand();
      registerGet(mockCommand);
      const handler = mockCommand._handler;

      await handler({ key: "not_found" });

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      const outputArgs = outputFormatter.formatOutput.calls[0];
      assert.deepStrictEqual(outputArgs[0], {
        error: {
          code: "NOT_FOUND",
          message: "Setting 'not_found' not found.",
        },
      });
      assert.strictEqual(outputArgs[1], "json");
    });

    it("should output error if loadConfig throws", async () => {
      // Set up specific mock for this test
      mockModule("../../utils/config-manager", {
        loadConfig: trackCalls(async () => {
          throw new Error("load failed");
        }),
      });

      // Import after mocking
      const registerGet = require("../settings/get");
      const outputFormatter = require("../../utils/output-formatter");

      const mockCommand = createMockCommand();
      registerGet(mockCommand);
      const handler = mockCommand._handler;

      await handler({});

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      const outputArgs = outputFormatter.formatOutput.calls[0];
      assert.deepStrictEqual(outputArgs[0], {
        error: {
          code: "SETTINGS_GET_ERROR",
          message: "load failed",
        },
      });
      assert.strictEqual(outputArgs[1], "json");
    });
  });

  describe("settings set", () => {
    it("should update settings and output success", async () => {
      // Import after mocking
      const registerSet = require("../settings/set");
      const configManager = require("../../utils/config-manager");
      const outputFormatter = require("../../utils/output-formatter");

      const mockCommand = createMockCommand();
      registerSet(mockCommand);
      const handler = mockCommand._handler;

      await handler(["timeout=120000", "output_format=json"]);

      assert.strictEqual(configManager.loadConfig.calls.length, 1);
      assert.strictEqual(configManager.saveConfig.calls.length, 1);

      // Check that saveConfig was called with the correct settings
      const saveArgs = configManager.saveConfig.calls[0];
      assert.strictEqual(saveArgs[0].timeout, "120000");
      assert.strictEqual(saveArgs[0].output_format, "json");

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      const outputArgs = outputFormatter.formatOutput.calls[0];
      assert.deepStrictEqual(outputArgs[0], {
        success: true,
        updated: { timeout: "120000", output_format: "json" },
      });
      assert.strictEqual(outputArgs[1], "json");
    });

    it("should output error for invalid key=value pair", async () => {
      // Import modules first
      const outputFormatter = require("../../utils/output-formatter");

      // Create a custom mock directly for this test with special handling
      outputFormatter.formatOutput = trackCalls(() => {});
      process.exit = trackCalls(() => {}); // Track process.exit calls

      // Now import the module under test
      const registerSet = require("../settings/set");

      const mockCommand = createMockCommand();
      registerSet(mockCommand);
      const handler = mockCommand._handler;

      // Execute the handler with invalid input
      await handler(["invalidpair"]);

      // Check that formatOutput was called with the correct error
      assert.ok(
        outputFormatter.formatOutput.calls.length > 0,
        "formatOutput should have been called",
      );

      let foundErrorCall = false;
      for (const call of outputFormatter.formatOutput.calls) {
        if (
          call[0]?.error?.code === "INVALID_ARGUMENT" &&
          call[1] === "json" &&
          call[0]?.error?.message.includes("Invalid setting format")
        ) {
          foundErrorCall = true;
          break;
        }
      }

      assert.ok(
        foundErrorCall,
        "Expected error call with INVALID_ARGUMENT code was not found",
      );
      assert.ok(
        process.exit.calls.length > 0,
        "process.exit should have been called",
      );
    });

    it("should output error if saveConfig throws", async () => {
      // Set up specific mock for this test
      mockModule("../../utils/config-manager", {
        loadConfig: trackCalls(async () => ({
          server_url: "http://localhost:3000",
          timeout: 5000,
          output_format: "table",
        })),
        saveConfig: trackCalls(async () => {
          throw new Error("save failed");
        }),
      });

      // Import after mocking
      const registerSet = require("../settings/set");
      const outputFormatter = require("../../utils/output-formatter");

      const mockCommand = createMockCommand();
      registerSet(mockCommand);
      const handler = mockCommand._handler;

      await handler(["timeout=1000"]);

      assert.strictEqual(outputFormatter.formatOutput.calls.length, 1);
      const outputArgs = outputFormatter.formatOutput.calls[0];
      assert.deepStrictEqual(outputArgs[0], {
        error: {
          code: "SETTINGS_SET_ERROR",
          message: "save failed",
        },
      });
      assert.strictEqual(outputArgs[1], "json");
    });
  });
});

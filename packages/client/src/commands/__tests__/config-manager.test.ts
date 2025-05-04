/**
 * Tests for config commands using Node.js test runner
 */
const test = require("node:test");
const assert = require("node:assert");

const describe = test.describe;
const it = test.it;
const beforeEach = test.beforeEach;

// Helper function for tracking function calls
function trackCalls(fn) {
  const calls = [];
  const tracked = function (...args) {
    calls.push(args);
    return fn ? fn.apply(this, args) : undefined;
  };
  tracked.calls = calls;
  tracked.mockImplementation = (newFn) => {
    fn = newFn;
  };
  return tracked;
}

// Mock module helper
function mockModule(modulePath, implementation) {
  const fullPath = require.resolve(modulePath);
  require.cache[fullPath] = {
    exports: implementation,
    id: fullPath,
    filename: fullPath,
    loaded: true,
    children: [],
    paths: [],
  };
}

describe("Config Commands", () => {
  beforeEach(() => {
    // Clear module cache before each test
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("/utils/") || key.includes("/config/")) {
        delete require.cache[key];
      }
    });

    // Set up api-client mocks with tracked calls
    const mockGet = trackCalls(async () => ({
      data: { config: { server_url: "http://localhost:3000", timeout: 5000 } },
    }));
    const mockPost = trackCalls(async () => ({ data: { config: {} } }));
    const mockDelete = trackCalls(async () => ({}));

    mockModule("../../utils/api-client", {
      get: mockGet,
      post: mockPost,
      delete: mockDelete,
    });

    // Set up output-formatter mock
    mockModule("../../utils/output-formatter", {
      formatOutput: trackCalls(),
    });

    // Set up other utility mocks
    mockModule("../../utils/logger", {
      debug: () => {},
      error: () => {},
    });

    mockModule("../../utils/error-handler", {
      handleError: (error) => error,
    });

    mockModule("../../utils/config-manager", {
      // Add any config manager specific mocks if needed
    });
  });

  describe("get command", () => {
    it("should get all system config values from the server when no app is provided", async () => {
      // Import modules after mocking
      const { get: mockGet } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const getModule = require("../../commands/config/get");

      // Setup mock commander object
      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      // Register command to get handler
      getModule.default(mockCommand);
      const getHandler = mockCommand.handler;

      // Setup test data
      const mockResponse = {
        success: true,
        data: {
          config: { server_url: "http://localhost:3000", timeout: 5000 },
        },
      };
      mockGet.mockImplementation(async () => mockResponse);

      // Execute test
      const argv = { output: "json" };
      const result = await getHandler(argv);

      // Verify using Node's assertions
      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );
      assert.deepStrictEqual(
        mockGet.calls[0],
        ["/api/config", {}],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [mockResponse.data.config, "json"],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true, data: mockResponse.data },
        "Result should match expected structure",
      );
    });

    it("should get a specific system config value from the server when key is provided", async () => {
      const { get: mockGet } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const getModule = require("../../commands/config/get");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      getModule.default(mockCommand);
      const getHandler = mockCommand.handler;

      const mockResponse = {
        data: { config: { server_url: "http://localhost:3000" } },
      };
      mockGet.mockImplementation(async () => mockResponse);

      const argv = { key: "server_url", output: "table" };
      const result = await getHandler(argv);

      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );
      assert.deepStrictEqual(
        mockGet.calls[0],
        ["/api/config", { key: "server_url" }],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [mockResponse.data.config.server_url, "table"],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true, data: mockResponse.data },
        "Result should match expected structure",
      );
    });

    it("should get all app config values from the server when app is provided", async () => {
      const { get: mockGet } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const getModule = require("../../commands/config/get");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      getModule.default(mockCommand);
      const getHandler = mockCommand.handler;

      const appName = "test-app";
      const mockResponse = { data: { config: { port: 3000, name: appName } } };
      mockGet.mockImplementation(async () => mockResponse);

      const argv = { app: appName, output: "json" };
      const result = await getHandler(argv);

      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );
      assert.deepStrictEqual(
        mockGet.calls[0],
        [`/api/config/${appName}`, {}],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [mockResponse.data.config, "json"],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true, data: mockResponse.data },
        "Result should match expected structure",
      );
    });

    it("should get encrypted app config values when secret flag is used", async () => {
      const { get: mockGet } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const getModule = require("../../commands/config/get");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      getModule.default(mockCommand);
      const getHandler = mockCommand.handler;

      const appName = "test-app";
      const mockResponse = { data: { config: { DB_PASSWORD: "******" } } };
      mockGet.mockImplementation(async () => mockResponse);

      const argv = { app: appName, secret: true, output: "json" };
      const result = await getHandler(argv);

      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );
      assert.deepStrictEqual(
        mockGet.calls[0],
        [`/api/config/${appName}/encrypted`, {}],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [mockResponse.data.config, "json"],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true, data: mockResponse.data },
        "Result should match expected structure",
      );
    });

    it("should handle errors gracefully", async () => {
      const { get: mockGet } = require("../../utils/api-client");
      const getModule = require("../../commands/config/get");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      getModule.default(mockCommand);
      const getHandler = mockCommand.handler;

      const mockError = new Error("API Error") as ApiError;
      mockGet.mockImplementation(() => Promise.reject(mockError));

      const argv = { app: "test-app" };
      const result = await getHandler(argv);

      assert.deepStrictEqual(
        result,
        {
          success: false,
          error: {
            code: mockError.code || "GET_ERROR",
            message: mockError.message || "Unknown error",
            details: mockError.details,
          },
        },
        "Should return error response",
      );
    });

    it("should get a specific app config value from the server when app and key are provided", async () => {
      const { get: mockGet } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const getModule = require("../../commands/config/get");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      getModule.default(mockCommand);
      const getHandler = mockCommand.handler;

      const appName = "test-app";
      const key = "port";
      const mockResponse = { data: { config: { port: 3000 } } };
      mockGet.mockImplementation(async () => mockResponse);

      const argv = { app: appName, key, output: "table" };
      const result = await getHandler(argv);

      assert.strictEqual(
        mockGet.calls.length,
        1,
        "API get should be called once",
      );
      assert.deepStrictEqual(
        mockGet.calls[0],
        [`/api/config/${appName}`, { key }],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [mockResponse.data.config.port, "table"],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true, data: mockResponse.data },
        "Result should match expected structure",
      );
    });
  });

  describe("set command", () => {
    it("should set system config values via the API", async () => {
      const { post: mockPost } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const setModule = require("../../commands/config/set");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      setModule.default(mockCommand);
      const setHandler = mockCommand.handler;

      const mockResponse = {
        data: {
          config: { server_url: "http://localhost:4000", timeout: "10000" },
        },
      };
      mockPost.mockImplementation(async () => mockResponse);

      const keyValues = ["server_url=http://localhost:4000", "timeout=10000"];
      const result = await setHandler(keyValues, {});

      assert.strictEqual(
        mockPost.calls.length,
        1,
        "API post should be called once",
      );
      assert.deepStrictEqual(
        mockPost.calls[0],
        [
          "/api/config",
          { config: { server_url: "http://localhost:4000", timeout: "10000" } },
        ],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [{ message: "System configuration updated successfully." }, undefined],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true, data: mockResponse.data },
        "Result should match expected structure",
      );
    });

    it("should set app-specific config values via the API", async () => {
      const { post: mockPost } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const setModule = require("../../commands/config/set");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      setModule.default(mockCommand);
      const setHandler = mockCommand.handler;

      const mockResponse = {
        data: { config: { DB_USER: "admin", DB_PASS: "secret" } },
      };
      mockPost.mockImplementation(async () => mockResponse);

      const keyValues = ["DB_USER=admin", "DB_PASS=secret"];
      const options = { app: "myapp" };
      const result = await setHandler(keyValues, options);

      assert.strictEqual(
        mockPost.calls.length,
        1,
        "API post should be called once",
      );
      assert.deepStrictEqual(
        mockPost.calls[0],
        [
          "/api/config/myapp",
          { config: { DB_USER: "admin", DB_PASS: "secret" } },
        ],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [
          { message: "Configuration for app 'myapp' updated successfully." },
          undefined,
        ],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true, data: mockResponse.data },
        "Result should match expected structure",
      );
    });

    it("should handle errors gracefully", async () => {
      const setModule = require("../../commands/config/set");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      setModule.default(mockCommand);
      const setHandler = mockCommand.handler;

      const keyValues = ["invalid-pair"];
      const result = await setHandler(keyValues, {});

      assert.strictEqual(result.success, false, "Should indicate failure");
      assert.ok(result.error, "Should include error details");
    });
  });

  describe("delete command", () => {
    it("should delete a single system config value via the API", async () => {
      const { delete: mockDelete } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const deleteModule = require("../../commands/config/delete");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      deleteModule.default(mockCommand);
      const deleteHandler = mockCommand.handler;

      mockDelete.mockImplementation(async () => ({}));

      const keys = ["server_url"];
      const result = await deleteHandler(keys, {});

      assert.strictEqual(
        mockDelete.calls.length,
        1,
        "API delete should be called once",
      );
      assert.deepStrictEqual(
        mockDelete.calls[0],
        ["/api/config/server_url"],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [
          {
            message:
              "System configuration key 'server_url' deleted successfully.",
          },
          "table",
        ],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true },
        "Result should match expected structure",
      );
    });

    it("should delete multiple system config values via the API", async () => {
      const { delete: mockDelete } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const deleteModule = require("../../commands/config/delete");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      deleteModule.default(mockCommand);
      const deleteHandler = mockCommand.handler;

      mockDelete.mockImplementation(async () => ({}));

      const keys = ["server_url", "timeout"];
      const result = await deleteHandler(keys, {});

      assert.strictEqual(
        mockDelete.calls.length,
        1,
        "API delete should be called once",
      );
      assert.deepStrictEqual(
        mockDelete.calls[0],
        ["/api/config", { params: { keys: "server_url,timeout" } }],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [
          {
            message:
              "System configuration keys [server_url, timeout] deleted successfully.",
          },
          "table",
        ],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true },
        "Result should match expected structure",
      );
    });

    it("should delete encrypted app-specific config values via the API", async () => {
      const { delete: mockDelete } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const deleteModule = require("../../commands/config/delete");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      deleteModule.default(mockCommand);
      const deleteHandler = mockCommand.handler;

      mockDelete.mockImplementation(async () => ({}));

      const keys = ["SECRET_KEY"];
      const options = { app: "myapp", secret: true };
      const result = await deleteHandler(keys, options);

      assert.strictEqual(
        mockDelete.calls.length,
        1,
        "API delete should be called once",
      );
      assert.deepStrictEqual(
        mockDelete.calls[0],
        ["/api/config/myapp/encrypted/SECRET_KEY"],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [
          {
            message:
              "Encrypted configuration for app 'myapp' deleted successfully.",
          },
          "table",
        ],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true },
        "Result should match expected structure",
      );
    });

    it("should handle errors gracefully", async () => {
      const { delete: mockDelete } = require("../../utils/api-client");
      const deleteModule = require("../../commands/config/delete");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      deleteModule.default(mockCommand);
      const deleteHandler = mockCommand.handler;

      const mockError = new Error("API Error") as ApiError;
      mockDelete.mockImplementation(() => Promise.reject(mockError));

      const keys = ["DB_USER"];
      const options = { app: "myapp" };
      const result = await deleteHandler(keys, options);

      assert.deepStrictEqual(
        result,
        {
          success: false,
          error: {
            code: mockError.code || "DELETE_ERROR",
            message: mockError.message || "Delete failed",
            details: mockError.details,
          },
        },
        "Should return error response",
      );
    });

    it("should delete a single app-specific config value via the API", async () => {
      const { delete: mockDelete } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const deleteModule = require("../../commands/config/delete");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      deleteModule.default(mockCommand);
      const deleteHandler = mockCommand.handler;

      mockDelete.mockImplementation(async () => ({}));

      const keys = ["DB_USER"];
      const options = { app: "myapp" };
      const result = await deleteHandler(keys, options);

      assert.strictEqual(
        mockDelete.calls.length,
        1,
        "API delete should be called once",
      );
      assert.deepStrictEqual(
        mockDelete.calls[0],
        ["/api/config/myapp/DB_USER"],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [
          {
            message:
              "Configuration key 'DB_USER' for app 'myapp' deleted successfully.",
          },
          "table",
        ],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true },
        "Result should match expected structure",
      );
    });

    it("should delete multiple app-specific config values via the API", async () => {
      const { delete: mockDelete } = require("../../utils/api-client");
      const {
        formatOutput: mockFormatOutput,
      } = require("../../utils/output-formatter");
      const deleteModule = require("../../commands/config/delete");

      const mockCommand: MockCommand = {
        command: () => mockCommand,
        description: () => mockCommand,
        option: () => mockCommand,
        alias: () => mockCommand,
        action: (handler) => {
          mockCommand.handler = handler;
          return mockCommand;
        },
        addHelpText: () => mockCommand,
        handler: () => Promise.resolve({}), // Default empty handler that will be replaced
      };

      deleteModule.default(mockCommand);
      const deleteHandler = mockCommand.handler;

      mockDelete.mockImplementation(async () => ({}));

      const keys = ["DB_USER", "DB_PASS"];
      const options = { app: "myapp" };
      const result = await deleteHandler(keys, options);

      assert.strictEqual(
        mockDelete.calls.length,
        1,
        "API delete should be called once",
      );
      assert.deepStrictEqual(
        mockDelete.calls[0],
        ["/api/config/myapp", { params: { keys: "DB_USER,DB_PASS" } }],
        "API call should have correct parameters",
      );
      assert.strictEqual(
        mockFormatOutput.calls.length,
        1,
        "formatOutput should be called once",
      );
      assert.deepStrictEqual(
        mockFormatOutput.calls[0],
        [
          {
            message:
              "Configuration keys [DB_USER, DB_PASS] for app 'myapp' deleted successfully.",
          },
          "table",
        ],
        "formatOutput should have correct parameters",
      );
      assert.deepStrictEqual(
        result,
        { success: true },
        "Result should match expected structure",
      );
    });
  });
});

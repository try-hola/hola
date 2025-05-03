// app-deploy.node.test.ts - Node.js test runner version
const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");

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

// Create simple mocks for dependencies
const mockApiClient = {
  post: null, // Will be implemented in each test
};

const mockOutputFormatter = {
  formatOutput: null, // Will be implemented in each test
};

const mockLogger = {
  debug: () => {},
  info: () => {},
  error: () => {},
  warn: () => {},
};

const mockErrorHandler = {
  handleCommandError: () => {},
};

// Setup for mocking with Node.js test runner
describe("app deploy command", () => {
  let originalExistsSync;
  let originalStatSync;

  beforeEach(() => {
    // Save original fs functions
    originalExistsSync = fs.existsSync;
    originalStatSync = fs.statSync;

    // Clear mocks before each test
    clearMocks();

    // Delete the module under test from the cache to ensure a fresh import
    if (require.cache[require.resolve("../app/deploy")]) {
      delete require.cache[require.resolve("../app/deploy")];
    }

    // Setup mocks for dependencies
    mockModule("../../utils/api-client", mockApiClient);
    mockModule("../../utils/output-formatter", mockOutputFormatter);
    mockModule("../../utils/logger", mockLogger);
    mockModule("../../utils/error-handler", mockErrorHandler);

    // Mock fs methods
    fs.existsSync = () => true;
    fs.statSync = () => ({ isFile: () => true });

    // Default mock implementations
    mockApiClient.post = async () => {
      throw new Error("API post method not mocked for this test");
    };

    mockOutputFormatter.formatOutput = () => {};
  });

  it("should deploy app successfully", async () => {
    // Set up specific mocks for this test
    let apiPostUrl = null;
    let apiPostData = null;

    mockApiClient.post = async (url, data) => {
      apiPostUrl = url;
      apiPostData = data;
      return { data: { deploymentId: "123" } };
    };

    const formatOutputCalls = [];
    mockOutputFormatter.formatOutput = (data, format) => {
      formatOutputCalls.push({ data, format });
    };

    // Import the module under test after setting up mocks
    const { handler: deployHandler } = require("../app/deploy");

    // Execute the handler
    const options = { output: "table" };
    const result = await deployHandler("myapp", "package.tgz", options);

    // Assert API was called with correct URL and data
    assert.strictEqual(apiPostUrl, "/api/apps/deploy");
    assert.strictEqual(apiPostData.appName, "myapp");
    assert.ok(apiPostData.packagePath);

    // Assert output was formatted
    assert.ok(formatOutputCalls.length > 0);
    assert.ok(formatOutputCalls[0].data.message.includes("Deployment started"));
    assert.strictEqual(formatOutputCalls[0].format, "table");

    // Assert on the result
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.deploymentId, "123");
  });

  it("should handle API errors gracefully", async () => {
    // Set up specific mocks for this test
    mockApiClient.post = async () => {
      throw new Error("API failed");
    };

    const formatOutputCalls = [];
    mockOutputFormatter.formatOutput = (data, format) => {
      formatOutputCalls.push({ data, format });
    };

    // Import the module under test after setting up mocks
    const { handler: deployHandler } = require("../app/deploy");

    // Execute the handler
    const options = { output: "json" };
    const result = await deployHandler("myapp", undefined, options);

    // Assert output was formatted
    assert.ok(formatOutputCalls.length > 0);
    assert.ok(formatOutputCalls[0].data.error);
    assert.strictEqual(formatOutputCalls[0].format, "json");

    // Assert on the result
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, "DEPLOY_ERROR");
    assert.strictEqual(result.error.message, "API failed");
  });

  it("should validate app name and return error for invalid name", async () => {
    // Set up formatOutput tracking
    const formatOutputCalls = [];
    mockOutputFormatter.formatOutput = (data, format) => {
      formatOutputCalls.push({ data, format });
    };

    // Import the module under test after setting up mocks
    const { handler: deployHandler } = require("../app/deploy");

    // Execute the handler
    const options = { output: "table" };
    const result = await deployHandler("invalid name!", "package.tgz", options);

    // Assert output was formatted
    assert.ok(formatOutputCalls.length > 0);
    assert.ok(formatOutputCalls[0].data.error);
    assert.strictEqual(
      formatOutputCalls[0].data.error.code,
      "DEPLOY_INVALID_APPNAME",
    );

    // Assert on the result
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, "DEPLOY_INVALID_APPNAME");
  });

  it("should return error if package file does not exist", async () => {
    // Mock fs.existsSync to return false
    fs.existsSync = () => false;

    // Set up formatOutput tracking
    const formatOutputCalls = [];
    mockOutputFormatter.formatOutput = (data, format) => {
      formatOutputCalls.push({ data, format });
    };

    // Import the module under test after setting up mocks
    const { handler: deployHandler } = require("../app/deploy");

    // Execute the handler
    const options = { output: "table" };
    const result = await deployHandler("myapp", "missing.tgz", options);

    // Assert output was formatted
    assert.ok(formatOutputCalls.length > 0);
    assert.ok(formatOutputCalls[0].data.error);
    assert.strictEqual(
      formatOutputCalls[0].data.error.code,
      "DEPLOY_PACKAGE_NOT_FOUND",
    );

    // Assert on the result
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, "DEPLOY_PACKAGE_NOT_FOUND");
  });

  it("should include force flag in payload if specified", async () => {
    // Set up specific mocks for this test
    let apiPostUrl = null;
    let apiPostData = null;

    mockApiClient.post = async (url, data) => {
      apiPostUrl = url;
      apiPostData = data;
      return { data: { deploymentId: "456" } };
    };

    // Import the module under test after setting up mocks
    const { handler: deployHandler } = require("../app/deploy");

    // Execute the handler
    const options = { force: true, output: "json" };
    await deployHandler("myapp", "package.tgz", options);

    // Assert API was called with correct data including force flag
    assert.strictEqual(apiPostUrl, "/api/apps/deploy");
    assert.strictEqual(apiPostData.appName, "myapp");
    assert.strictEqual(apiPostData.force, true);
    assert.ok(apiPostData.packagePath);
  });

  it("should work without packagePath (remote package)", async () => {
    // Set up specific mocks for this test
    let apiPostUrl = null;
    let apiPostData = null;

    mockApiClient.post = async (url, data) => {
      apiPostUrl = url;
      apiPostData = data;
      return { data: { deploymentId: "789" } };
    };

    // Import the module under test after setting up mocks
    const { handler: deployHandler } = require("../app/deploy");

    // Execute the handler
    const options = { output: "json" };
    const result = await deployHandler("myapp", undefined, options);

    // Assert API was called with correct URL and data
    assert.strictEqual(apiPostUrl, "/api/apps/deploy");
    assert.strictEqual(apiPostData.appName, "myapp");
    assert.strictEqual(apiPostData.packagePath, undefined);

    // Assert on the result
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.deploymentId, "789");
  });

  after(() => {
    // Restore original fs functions
    fs.existsSync = originalExistsSync;
    fs.statSync = originalStatSync;
  });
});

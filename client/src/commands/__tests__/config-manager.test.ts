// Mock the configuration before importing any modules that use it
jest.mock("../../utils/config-manager", () => ({
  getConfig: jest.fn().mockReturnValue({
    server_url: "http://localhost:3000",
    timeout: 5000,
    api_key: "test-api-key",
  }),
  get: jest.fn().mockImplementation((key: string, defaultValue) => {
    const config: Record<string, string | number> = {
      log_level: "info",
      server_url: "http://localhost:3000",
      timeout: 5000,
      api_key: "test-api-key",
    };
    return config[key] !== undefined ? config[key] : defaultValue;
  }),
  set: jest.fn(), // Mock set as a spy function
  delete: jest.fn(), // Mock delete as a spy function
}));

// Mock API client before importing other modules
jest.mock("../../utils/api-client", () => ({
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
}));

// Mock output formatter
jest.mock("../../utils/output-formatter", () => ({
  formatOutput: jest.fn().mockImplementation((data) => data),
  format: jest.fn().mockImplementation((data) => data),
}));

// Mock logger
jest.mock("../../utils/logger", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Mock error handler
jest.mock("../../utils/error-handler", () => ({
  handleCommandError: jest.fn().mockImplementation((error) => {
    return { success: false, error };
  }),
}));

// Import dependencies after mocking
const configManager = require("../../utils/config-manager");
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const logger = require("../../utils/logger");
const { handleCommandError } = require("../../utils/error-handler");

// Create a mock commander object
const mockCommand = {
  command: jest.fn().mockReturnThis(),
  description: jest.fn().mockReturnThis(),
  option: jest.fn().mockReturnThis(),
  alias: jest.fn().mockReturnThis(),
  action: jest.fn().mockImplementation(function (handler) {
    this._handler = handler;
    return this;
  }),
  addHelpText: jest.fn().mockReturnThis(),
};

// Import commands and capture handlers
const getModule = require("../../commands/config/get");
const setModule = require("../../commands/config/set");
const deleteModule = require("../../commands/config/delete");

getModule.default(mockCommand);
const getHandler = mockCommand._handler;

setModule.default(mockCommand);
const setHandler = mockCommand._handler;

deleteModule.default(mockCommand);
const deleteHandler = mockCommand._handler;

describe("Config Commands", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("get command", () => {
    it("should get all local config values when no parameters provided", async () => {
      const argv = { output: "json" };
      const result = await getHandler(argv);
      expect(configManager.getConfig).toHaveBeenCalled();
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          server_url: "http://localhost:3000",
          api_key: expect.stringMatching(/^test.*key$/),
        }),
        "json"
      );
      expect(result).toEqual({ success: true, data: expect.any(Object) });
    });

    it("should get specific local config value when key is provided", async () => {
      const argv = { key: "server_url", output: "table" };
      const result = await getHandler(argv);
      expect(configManager.get).toHaveBeenCalledWith("server_url");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { server_url: "http://localhost:3000" },
        "table"
      );
      expect(result).toEqual({
        success: true,
        data: { server_url: "http://localhost:3000" },
      });
    });

    it("should mask api_key when requesting it specifically", async () => {
      const argv = { key: "api_key", output: "table" };
      const result = await getHandler(argv);
      expect(configManager.get).toHaveBeenCalledWith("api_key");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { api_key: expect.stringMatching(/^test.*key$/) },
        "table"
      );
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          api_key: expect.stringMatching(/^test.*key$/),
        }),
      });
    });

    it("should get application config from server when app parameter is provided", async () => {
      const appName = "test-app";
      const argv = { app: appName, output: "json" };
      const mockResponse = { data: { port: 3000, name: appName } };
      apiClient.get.mockResolvedValueOnce(mockResponse);
      const result = await getHandler(argv);
      expect(apiClient.get).toHaveBeenCalledWith(`/api/config/${appName}`, {});
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockResponse.data,
        "json"
      );
      expect(result).toEqual({ success: true, data: mockResponse.data });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("should get specific application config value when app and key parameters are provided", async () => {
      const appName = "test-app";
      const key = "port";
      const argv = { app: appName, key, output: "table" };
      const mockResponse = { data: { port: 3000 } };
      apiClient.get.mockResolvedValueOnce(mockResponse);
      const result = await getHandler(argv);
      expect(apiClient.get).toHaveBeenCalledWith(`/api/config/${appName}`, {
        key,
      });
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockResponse.data.port,
        "table"
      );
      expect(result).toEqual({ success: true, data: mockResponse.data });
    });

    it("should get encrypted application values when secret flag is used", async () => {
      const appName = "test-app";
      const argv = { app: appName, secret: true, output: "json" };
      const mockResponse = { data: { DB_PASSWORD: "******" } };
      apiClient.get.mockResolvedValueOnce(mockResponse);
      const result = await getHandler(argv);
      expect(apiClient.get).toHaveBeenCalledWith(
        `/api/config/${appName}/encrypted`,
        {}
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockResponse.data,
        "json"
      );
      expect(result).toEqual({ success: true, data: mockResponse.data });
    });

    it("should handle errors gracefully", async () => {
      const appName = "test-app";
      const argv = { app: appName };
      const mockError = new Error("API Error");
      apiClient.get.mockRejectedValueOnce(mockError);
      const result = await getHandler(argv);
      expect(result).toEqual({ success: false, error: mockError });
    });
  });

  describe("set command", () => {
    it("should set local config values", async () => {
      const argv = {
        keyValues: ["server_url=http://localhost:4000", "timeout=10000"],
      };
      const result = await setHandler(argv.keyValues, {});
      expect(configManager.set).toHaveBeenCalledWith(
        "server_url",
        "http://localhost:4000"
      );
      expect(configManager.set).toHaveBeenCalledWith("timeout", "10000");
      expect(result).toEqual({ success: true });
    });

    it("should set app-specific config values on the server", async () => {
      const argv = {
        keyValues: ["DB_USER=admin", "DB_PASS=secret"],
        app: "myapp",
      };
      apiClient.post.mockResolvedValueOnce({});
      const result = await setHandler(argv.keyValues, { app: argv.app });
      expect(apiClient.post).toHaveBeenCalledWith("/api/config/myapp", {
        config: { DB_USER: "admin", DB_PASS: "secret" },
      });
      expect(result).toEqual({ success: true });
    });

    it("should handle errors gracefully", async () => {
      const argv = { keyValues: ["invalid-pair"] };
      const result = await setHandler(argv.keyValues, {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("delete command", () => {
    it("should delete local config values", async () => {
      const argv = { keys: ["server_url", "timeout"] };
      const result = await deleteHandler(argv.keys, {});
      expect(configManager.delete).toHaveBeenCalledWith("server_url");
      expect(configManager.delete).toHaveBeenCalledWith("timeout");
      expect(result).toEqual({ success: true });
    });

    it("should warn when deleting api_key", async () => {
      const argv = { keys: ["api_key"] };
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
      const result = await deleteHandler(argv.keys, {});
      expect(configManager.delete).toHaveBeenCalledWith("api_key");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("api_key")
      );
      expect(result).toEqual({ success: true });
      consoleSpy.mockRestore();
    });

    it("should delete a single app-specific config value", async () => {
      const argv = { keys: ["DB_USER"], app: "myapp" };
      apiClient.delete.mockResolvedValueOnce({});
      const result = await deleteHandler(argv.keys, { app: argv.app });
      expect(apiClient.delete).toHaveBeenCalledWith(
        `/api/config/myapp/DB_USER`
      );
      expect(result).toEqual({ success: true });
    });

    it("should delete multiple app-specific config values", async () => {
      const argv = { keys: ["DB_USER", "DB_PASS"], app: "myapp" };
      apiClient.delete.mockResolvedValueOnce({});
      const result = await deleteHandler(argv.keys, { app: argv.app });
      expect(apiClient.delete).toHaveBeenCalledWith(`/api/config/myapp`, {
        params: { keys: "DB_USER,DB_PASS" },
      });
      expect(result).toEqual({ success: true });
    });

    it("should delete encrypted app-specific config values", async () => {
      const argv = { keys: ["SECRET_KEY"], app: "myapp", secret: true };
      apiClient.delete.mockResolvedValueOnce({});
      const result = await deleteHandler(argv.keys, {
        app: argv.app,
        secret: argv.secret,
      });
      expect(apiClient.delete).toHaveBeenCalledWith(
        `/api/config/myapp/encrypted/SECRET_KEY`
      );
      expect(result).toEqual({ success: true });
    });

    it("should handle errors gracefully", async () => {
      const argv = { keys: ["DB_USER"], app: "myapp" };
      const mockError = new Error("API Error");
      apiClient.delete.mockRejectedValueOnce(mockError);
      const result = await deleteHandler(argv.keys, { app: argv.app });
      expect(result).toEqual({ success: false, error: mockError });
    });
  });
});

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
    it("should get all system config values from the server when no app is provided", async () => {
      const argv = { output: "json" };
      const mockResponse = { data: { config: { server_url: "http://localhost:3000", timeout: 5000 } } };
      apiClient.get.mockResolvedValueOnce(mockResponse);
      const result = await getHandler(argv);
      expect(apiClient.get).toHaveBeenCalledWith("/api/config", {});
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockResponse.data.config,
        "json"
      );
      expect(result).toEqual({ success: true, data: mockResponse.data });
    });

    it("should get a specific system config value from the server when key is provided", async () => {
      const argv = { key: "server_url", output: "table" };
      const mockResponse = { data: { config: { server_url: "http://localhost:3000" } } };
      apiClient.get.mockResolvedValueOnce(mockResponse);
      const result = await getHandler(argv);
      expect(apiClient.get).toHaveBeenCalledWith("/api/config", { key: "server_url" });
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockResponse.data.config.server_url,
        "table"
      );
      expect(result).toEqual({ success: true, data: mockResponse.data });
    });

    it("should get all app config values from the server when app is provided", async () => {
      const appName = "test-app";
      const argv = { app: appName, output: "json" };
      const mockResponse = { data: { config: { port: 3000, name: appName } } };
      apiClient.get.mockResolvedValueOnce(mockResponse);
      const result = await getHandler(argv);
      expect(apiClient.get).toHaveBeenCalledWith(`/api/config/${appName}`, {});
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockResponse.data.config,
        "json"
      );
      expect(result).toEqual({ success: true, data: mockResponse.data });
    });

    it("should get a specific app config value from the server when app and key are provided", async () => {
      const appName = "test-app";
      const key = "port";
      const argv = { app: appName, key, output: "table" };
      const mockResponse = { data: { config: { port: 3000 } } };
      apiClient.get.mockResolvedValueOnce(mockResponse);
      const result = await getHandler(argv);
      expect(apiClient.get).toHaveBeenCalledWith(`/api/config/${appName}`, { key });
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockResponse.data.config.port,
        "table"
      );
      expect(result).toEqual({ success: true, data: mockResponse.data });
    });

    it("should get encrypted app config values when secret flag is used", async () => {
      const appName = "test-app";
      const argv = { app: appName, secret: true, output: "json" };
      const mockResponse = { data: { config: { DB_PASSWORD: "******" } } };
      apiClient.get.mockResolvedValueOnce(mockResponse);
      const result = await getHandler(argv);
      expect(apiClient.get).toHaveBeenCalledWith(
        `/api/config/${appName}/encrypted`,
        {}
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockResponse.data.config,
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
      expect(result).toEqual({
        success: false,
        error: {
          code: mockError.code || "GET_ERROR",
          message: mockError.message || "Unknown error",
          details: mockError.details,
        },
      });
    });
  });

  describe("set command", () => {
    it("should set system config values via the API", async () => {
      const argv = {
        keyValues: ["server_url=http://localhost:4000", "timeout=10000"],
      };
      apiClient.post.mockResolvedValueOnce({ data: { config: { server_url: "http://localhost:4000", timeout: "10000" } } });
      const result = await setHandler(argv.keyValues, {});
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/config",
        { config: { server_url: "http://localhost:4000", timeout: "10000" } }
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { message: "System configuration updated successfully." },
        undefined
      );
      expect(result).toEqual({ success: true, data: { config: { server_url: "http://localhost:4000", timeout: "10000" } } });
    });

    it("should set app-specific config values via the API", async () => {
      const argv = {
        keyValues: ["DB_USER=admin", "DB_PASS=secret"],
        app: "myapp",
      };
      apiClient.post.mockResolvedValueOnce({ data: { config: { DB_USER: "admin", DB_PASS: "secret" } } });
      const result = await setHandler(argv.keyValues, { app: argv.app });
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/config/myapp",
        { config: { DB_USER: "admin", DB_PASS: "secret" } }
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { message: `Configuration for app 'myapp' updated successfully.` },
        undefined
      );
      expect(result).toEqual({ success: true, data: { config: { DB_USER: "admin", DB_PASS: "secret" } } });
    });

    it("should handle errors gracefully", async () => {
      const argv = { keyValues: ["invalid-pair"] };
      const result = await setHandler(argv.keyValues, {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("delete command", () => {
    it("should delete a single system config value via the API", async () => {
      const argv = { keys: ["server_url"] };
      apiClient.delete.mockResolvedValueOnce({});
      const result = await deleteHandler(argv.keys, {});
      expect(apiClient.delete).toHaveBeenCalledWith(
        "/api/config/server_url"
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { message: `System configuration key 'server_url' deleted successfully.` },
        "table"
      );
      expect(result).toEqual({ success: true });
    });

    it("should delete multiple system config values via the API", async () => {
      const argv = { keys: ["server_url", "timeout"] };
      apiClient.delete.mockResolvedValueOnce({});
      const result = await deleteHandler(argv.keys, {});
      expect(apiClient.delete).toHaveBeenCalledWith(
        "/api/config",
        { params: { keys: "server_url,timeout" } }
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { message: `System configuration keys [server_url, timeout] deleted successfully.` },
        "table"
      );
      expect(result).toEqual({ success: true });
    });

    it("should delete a single app-specific config value via the API", async () => {
      const argv = { keys: ["DB_USER"], app: "myapp" };
      apiClient.delete.mockResolvedValueOnce({});
      const result = await deleteHandler(argv.keys, { app: argv.app });
      expect(apiClient.delete).toHaveBeenCalledWith(
        "/api/config/myapp/DB_USER"
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { message: `Configuration key 'DB_USER' for app 'myapp' deleted successfully.` },
        "table"
      );
      expect(result).toEqual({ success: true });
    });

    it("should delete multiple app-specific config values via the API", async () => {
      const argv = { keys: ["DB_USER", "DB_PASS"], app: "myapp" };
      apiClient.delete.mockResolvedValueOnce({});
      const result = await deleteHandler(argv.keys, { app: argv.app });
      expect(apiClient.delete).toHaveBeenCalledWith(
        "/api/config/myapp",
        { params: { keys: "DB_USER,DB_PASS" } }
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { message: `Configuration keys [DB_USER, DB_PASS] for app 'myapp' deleted successfully.` },
        "table"
      );
      expect(result).toEqual({ success: true });
    });

    it("should delete encrypted app-specific config values via the API", async () => {
      const argv = { keys: ["SECRET_KEY"], app: "myapp", secret: true };
      apiClient.delete.mockResolvedValueOnce({});
      const result = await deleteHandler(argv.keys, { app: argv.app, secret: argv.secret });
      expect(apiClient.delete).toHaveBeenCalledWith(
        "/api/config/myapp/encrypted/SECRET_KEY"
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { message: `Encrypted configuration for app 'myapp' deleted successfully.` },
        "table"
      );
      expect(result).toEqual({ success: true });
    });

    it("should handle errors gracefully", async () => {
      const argv = { keys: ["DB_USER"], app: "myapp" };
      const mockError = new Error("API Error");
      apiClient.delete.mockRejectedValueOnce(mockError);
      const result = await deleteHandler(argv.keys, { app: argv.app });
      expect(result).toEqual({
        success: false,
        error: {
          code: mockError.code || "DELETE_ERROR",
          message: mockError.message || "Delete failed",
          details: mockError.details,
        },
      });
    });
  });
});

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

describe("Config Commands", () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe("get command", () => {
    const getCommand = require("../../commands/config/get");

    it("should have correct command definition", () => {
      expect(getCommand.command).toBe("get");
      expect(getCommand.describe).toBeDefined();
      expect(getCommand.builder).toBeDefined();
      expect(getCommand.handler).toBeDefined();
    });

    it("should get all local config values when no parameters provided", async () => {
      // Arrange
      const argv = { output: "json" };
      
      // Act
      const result = await getCommand.handler(argv);
      
      // Assert
      expect(configManager.getConfig).toHaveBeenCalled();
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        expect.objectContaining({ 
          server_url: "http://localhost:3000",
          api_key: expect.stringMatching(/^test.*key$/) // Should be masked
        }),
        "json"
      );
      expect(result).toEqual({
        success: true,
        data: expect.any(Object)
      });
    });

    it("should get specific local config value when key is provided", async () => {
      // Arrange
      const argv = { key: "server_url", output: "table" };
      
      // Act
      const result = await getCommand.handler(argv);
      
      // Assert
      expect(configManager.get).toHaveBeenCalledWith("server_url");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { server_url: "http://localhost:3000" },
        "table"
      );
      expect(result).toEqual({
        success: true,
        data: { server_url: "http://localhost:3000" }
      });
    });

    it("should mask api_key when requesting it specifically", async () => {
      // Arrange
      const argv = { key: "api_key", output: "table" };
      
      // Act
      const result = await getCommand.handler(argv);
      
      // Assert
      expect(configManager.get).toHaveBeenCalledWith("api_key");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { api_key: expect.stringMatching(/^test.*key$/) }, // Should be masked 
        "table"
      );
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ 
          api_key: expect.stringMatching(/^test.*key$/) // Should be masked
        })
      });
    });

    it("should get application config from server when app parameter is provided", async () => {
      // Arrange
      const appName = "test-app";
      const argv = { app: appName, output: "json" };
      const mockResponse = { 
        data: { port: 3000, name: appName } 
      };
      apiClient.get.mockResolvedValueOnce(mockResponse);
      
      // Act
      const result = await getCommand.handler(argv);
      
      // Assert
      expect(apiClient.get).toHaveBeenCalledWith(`/api/config/${appName}`, {});
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockResponse.data,
        "json"
      );
      expect(result).toEqual({
        success: true,
        data: mockResponse.data
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("should get specific application config value when app and key parameters are provided", async () => {
      // Arrange
      const appName = "test-app";
      const key = "port";
      const argv = { app: appName, key, output: "table" };
      const mockResponse = { 
        data: { port: 3000 } 
      };
      apiClient.get.mockResolvedValueOnce(mockResponse);
      
      // Act
      const result = await getCommand.handler(argv);
      
      // Assert
      expect(apiClient.get).toHaveBeenCalledWith(`/api/config/${appName}`, { key });
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockResponse.data.port,
        "table"
      );
      expect(result).toEqual({
        success: true,
        data: mockResponse.data
      });
    });

    it("should get encrypted application values when secret flag is used", async () => {
      // Arrange
      const appName = "test-app";
      const argv = { app: appName, secret: true, output: "json" };
      const mockResponse = { 
        data: { DB_PASSWORD: "******" }
      };
      apiClient.get.mockResolvedValueOnce(mockResponse);
      
      // Act
      const result = await getCommand.handler(argv);
      
      // Assert
      expect(apiClient.get).toHaveBeenCalledWith(`/api/config/${appName}/encrypted`, {});
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockResponse.data,
        "json"
      );
      expect(result).toEqual({
        success: true,
        data: mockResponse.data
      });
    });

    it("should handle errors gracefully", async () => {
      // Arrange
      const appName = "test-app";
      const argv = { app: appName };
      const mockError = new Error("API Error");
      apiClient.get.mockRejectedValueOnce(mockError);
      
      // Act
      const result = await getCommand.handler(argv);
      
      // Assert
      expect(result).toEqual({
        success: false,
        error: mockError
      });
    });
  });

  describe("set command", () => {
    const setCommand = require("../../commands/config/set");

    it("should have correct command definition", () => {
      expect(setCommand.command).toBe("set [keyValues..]");
      expect(setCommand.describe).toBeDefined();
      expect(setCommand.builder).toBeDefined();
      expect(setCommand.handler).toBeDefined();
    });

    it("should set local config values", async () => {
      // Arrange
      const argv = { keyValues: ["server_url=http://localhost:4000", "timeout=10000"] };

      // Act
      const result = await setCommand.handler(argv.keyValues, {});

      // Assert
      expect(configManager.set).toHaveBeenCalledWith("server_url", "http://localhost:4000");
      expect(configManager.set).toHaveBeenCalledWith("timeout", "10000");
      expect(result).toEqual({ success: true });
    });

    it("should set app-specific config values on the server", async () => {
      // Arrange
      const argv = { keyValues: ["DB_USER=admin", "DB_PASS=secret"], app: "myapp" };
      apiClient.post.mockResolvedValueOnce({});

      // Act
      const result = await setCommand.handler(argv.keyValues, { app: argv.app });

      // Assert
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/config/myapp",
        { config: { DB_USER: "admin", DB_PASS: "secret" } }
      );
      expect(result).toEqual({ success: true });
    });

    it("should handle errors gracefully", async () => {
      // Arrange
      const argv = { keyValues: ["invalid-pair"] };

      // Act
      const result = await setCommand.handler(argv.keyValues, {});

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("delete command", () => {
    const deleteCommand = require("../../commands/config/delete");

    it("should delete local config values", async () => {
      // Arrange
      const keys = ["server_url", "timeout"];

      // Act
      const result = await deleteCommand.execute(keys, {});

      // Assert
      expect(configManager.delete).toHaveBeenCalledWith("server_url");
      expect(configManager.delete).toHaveBeenCalledWith("timeout");
      expect(result).toEqual({ success: true });
    });

    it("should warn when deleting api_key", async () => {
      // Arrange
      const keys = ["api_key"];
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Act
      const result = await deleteCommand.execute(keys, {});

      // Assert
      expect(configManager.delete).toHaveBeenCalledWith("api_key");
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("api_key"));
      expect(result).toEqual({ success: true });
      
      // Cleanup
      consoleSpy.mockRestore();
    });

    it("should delete a single app-specific config value", async () => {
      // Arrange
      const keys = ["DB_USER"];
      const options = { app: "myapp" };
      apiClient.delete.mockResolvedValueOnce({});

      // Act
      const result = await deleteCommand.execute(keys, options);

      // Assert
      expect(apiClient.delete).toHaveBeenCalledWith("/api/config/myapp/DB_USER");
      expect(result).toEqual({ success: true });
    });

    it("should delete multiple app-specific config values", async () => {
      // Arrange
      const keys = ["DB_USER", "DB_PASS"];
      const options = { app: "myapp" };
      apiClient.delete.mockResolvedValueOnce({});

      // Act
      const result = await deleteCommand.execute(keys, options);

      // Assert
      expect(apiClient.delete).toHaveBeenCalledWith(
        "/api/config/myapp", 
        { params: { keys: "DB_USER,DB_PASS" } }
      );
      expect(result).toEqual({ success: true });
    });

    it("should delete encrypted app-specific config values", async () => {
      // Arrange
      const keys = ["SECRET_KEY"];
      const options = { app: "myapp", secret: true };
      apiClient.delete.mockResolvedValueOnce({});

      // Act
      const result = await deleteCommand.execute(keys, options);

      // Assert
      expect(apiClient.delete).toHaveBeenCalledWith("/api/config/myapp/encrypted/SECRET_KEY");
      expect(result).toEqual({ success: true });
    });

    it("should handle errors gracefully", async () => {
      // Arrange
      const keys = ["DB_USER"];
      const options = { app: "myapp" };
      const mockError = new Error("API Error");
      apiClient.delete.mockRejectedValueOnce(mockError);

      // Act
      const result = await deleteCommand.execute(keys, options);

      // Assert
      expect(result).toEqual({
        success: false,
        error: mockError
      });
    });
  });
});

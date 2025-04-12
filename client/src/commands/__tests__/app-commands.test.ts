// Clear the module cache before mocking
jest.resetModules();

// Update the mock implementation of apiClient.get to log the URL for debugging
jest.mock("../../utils/api-client", () => {
  const mockGet = jest.fn().mockImplementation((url) => {
    console.log("apiClient.get called with URL:", url); // Debugging log

    if (url === "/api/apps") {
      return Promise.resolve({
        data: {
          apps: ["app1", "app2", "app3"],
        },
      });
    } else if (url.startsWith("/api/apps/")) {
      const appName = url.split("/").pop();
      if (appName === "non-existent-app") {
        return Promise.reject({ response: { status: 404 } });
      }
      return Promise.resolve({
        data: {
          name: appName,
          status: "running",
          version: "1.0.0",
        },
      });
    }

    return Promise.reject(new Error("Unexpected URL: " + url));
  });

  return {
    get: mockGet,
    post: jest.fn(),
    delete: jest.fn(),
  };
});

// Fix the outputFormatter mock to ensure proper function calls
jest.mock("../../utils/output-formatter", () => {
  const originalModule = jest.requireActual("../../utils/output-formatter");
  return {
    ...originalModule,
    table: jest.fn((data, columns, options) => {
      console.log("Mock table output", data, columns, options);
    }),
    json: jest.fn((data) => {
      console.log("Mock JSON output", data);
    }),
    formatOutput: jest.fn((data, format) => {
      console.log(`Mock formatOutput with format: ${format}`, data);
    }),
  };
});

jest.mock("../../utils/error-handler", () => ({
  handleCommandError: jest.fn().mockImplementation((error) => {
    return { success: false, error };
  }),
}));

jest.mock("../../utils/logger", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Import dependencies after mocking
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
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
};

// Import commands and capture handlers
const appListModule = require("../app/list");
const appInfoModule = require("../app/info");

const { handler: listHandler } = appListModule;
const { handler: infoHandler } = appInfoModule;

describe("App Commands", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("app list command", () => {
    test("should list apps in table format by default", async () => {
      apiClient.get.mockResolvedValue({
        success: true,
        data: { apps: ["app1", "app2", "app3"] },
      });

      const options = { output: "table" };
      const result = await listHandler(options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        [
          { name: "app1" },
          { name: "app2" },
          { name: "app3" }
        ],
        "table"
      );
      expect(result).toEqual({ success: true, data: ["app1", "app2", "app3"] });
    });

    test("should list apps in JSON format when specified", async () => {
      apiClient.get.mockResolvedValue({
        success: true,
        data: { apps: ["app1", "app2", "app3"] },
      });

      const options = { output: "json" };
      const result = await listHandler(options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        [
          { name: "app1" },
          { name: "app2" },
          { name: "app3" }
        ],
        "json"
      );
      expect(result).toEqual({ success: true, data: ["app1", "app2", "app3"] });
    });

    test("should handle empty app list", async () => {
      apiClient.get.mockResolvedValue({ success: true, data: { apps: [] } });

      const options = { output: "table" };
      const result = await listHandler(options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { message: "No applications deployed" },
        "table"
      );
      expect(result).toEqual({ success: true, data: [] });
    });

    test("should handle API errors", async () => {
      const mockError = new Error("API connection failed");
      apiClient.get.mockRejectedValue(mockError);

      const options = { output: "table" };
      const result = await listHandler(options);

      expect(apiClient.get).toHaveBeenCalled();
      // The handler now returns ApiResponse error structure
      expect(result).toEqual({
        success: false,
        error: {
          code: mockError.code || "LIST_ERROR",
          message: mockError.message || "Unknown error",
          details: mockError.details,
        },
      });
    });
  });

  describe("app info command", () => {
    test("should show app details in table format by default", async () => {
      const mockAppDetails = {
        name: "test-app1",
        status: "running",
        version: "1.0.0",
        port: 3000,
        createdAt: "2025-04-01T10:30:00.000Z",
      };

      apiClient.get.mockResolvedValue({ success: true, data: mockAppDetails });

      const options = { output: "table" };
      const result = await infoHandler("test-app1", options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps/test-app1");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        [{ property: "Application", value: "test-app1" }],
        "table"
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ property: "name", value: "test-app1" }),
          expect.objectContaining({ property: "status", value: "running ✓" }),
        ]),
        "table"
      );
      expect(result).toEqual({ success: true, data: mockAppDetails });
    });

    test("should show app details in JSON format when specified", async () => {
      const mockAppDetails = {
        name: "test-app1",
        status: "stopped",
        version: "1.0.0",
      };

      apiClient.get.mockResolvedValue({ success: true, data: mockAppDetails });

      const options = { output: "json" };
      const result = await infoHandler("test-app1", options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps/test-app1");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockAppDetails,
        "json"
      );
      expect(result).toEqual({ success: true, data: mockAppDetails });
    });

    test("should handle errors when app doesn't exist", async () => {
      const mockError = new Error("App not found");
      mockError.response = { status: 404 };
      apiClient.get.mockRejectedValue(mockError);

      const options = { output: "table" };
      const result = await infoHandler("non-existent-app", options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps/non-existent-app");
      // The handler now returns ApiResponse error structure
      expect(result).toEqual({
        success: false,
        error: {
          code: mockError.code || "INFO_ERROR",
          message: mockError.message || "Unknown error",
          details: mockError.details,
        },
      });
    });
  });
});

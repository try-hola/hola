/**
 * Tests for app commands
 */

// Use Jest's automatic mocking system to load mocks from __mocks__ directory
jest.mock("../../utils/api-client");
jest.mock("../../utils/output-formatter");
jest.mock("../../utils/error-handler");
jest.mock("../../utils/logger");

// Import dependencies after mocking
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");

// Import commands and capture handlers
const appListModule = require("../app/list");
const appInfoModule = require("../app/info");

const { handler: listHandler } = appListModule;
const { handler: infoHandler } = appInfoModule;

describe("App Commands", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up specific mock behavior for these tests
    apiClient.get.mockImplementation((url) => {
      if (url === "/api/apps") {
        return Promise.resolve({
          success: true,
          data: { apps: ["app1", "app2", "app3"] },
        });
      } else if (url.startsWith("/api/apps/")) {
        const appName = url.split("/").pop();
        if (appName === "non-existent-app") {
          return Promise.reject({ response: { status: 404 } });
        }
        return Promise.resolve({
          success: true,
          data: {
            name: appName,
            status: "running",
            version: "1.0.0",
          },
        });
      }
      return Promise.reject(new Error("Unexpected URL: " + url));
    });
  });

  describe("app list command", () => {
    test("should list apps in table format by default", async () => {
      const options = { output: "table" };
      const result = await listHandler(options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        [{ name: "app1" }, { name: "app2" }, { name: "app3" }],
        "table",
      );
      expect(result).toEqual({ success: true, data: ["app1", "app2", "app3"] });
    });

    test("should list apps in JSON format when specified", async () => {
      const options = { output: "json" };
      const result = await listHandler(options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        [{ name: "app1" }, { name: "app2" }, { name: "app3" }],
        "json",
      );
      expect(result).toEqual({ success: true, data: ["app1", "app2", "app3"] });
    });

    test("should handle empty app list", async () => {
      apiClient.get.mockResolvedValueOnce({
        success: true,
        data: { apps: [] },
      });

      const options = { output: "table" };
      const result = await listHandler(options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { message: "No applications deployed" },
        "table",
      );
      expect(result).toEqual({ success: true, data: [] });
    });

    test("should handle API errors", async () => {
      const mockError = new Error("API connection failed");
      apiClient.get.mockRejectedValueOnce(mockError);

      const options = { output: "table" };
      const result = await listHandler(options);

      expect(apiClient.get).toHaveBeenCalled();
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

      apiClient.get.mockResolvedValueOnce({
        success: true,
        data: mockAppDetails,
      });

      const options = { output: "table" };
      const result = await infoHandler("test-app1", options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps/test-app1");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        [{ property: "Application", value: "test-app1" }],
        "table",
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ property: "name", value: "test-app1" }),
          expect.objectContaining({ property: "status", value: "running ✓" }),
        ]),
        "table",
      );
      expect(result).toEqual({ success: true, data: mockAppDetails });
    });

    test("should show app details in JSON format when specified", async () => {
      const mockAppDetails = {
        name: "test-app1",
        status: "stopped",
        version: "1.0.0",
      };

      apiClient.get.mockResolvedValueOnce({
        success: true,
        data: mockAppDetails,
      });

      const options = { output: "json" };
      const result = await infoHandler("test-app1", options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps/test-app1");
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        mockAppDetails,
        "json",
      );
      expect(result).toEqual({ success: true, data: mockAppDetails });
    });

    test("should handle errors when app doesn't exist", async () => {
      const mockError = new Error("App not found");
      mockError.response = { status: 404 };
      apiClient.get.mockRejectedValueOnce(mockError);

      const options = { output: "table" };
      const result = await infoHandler("non-existent-app", options);

      expect(apiClient.get).toHaveBeenCalledWith("/api/apps/non-existent-app");
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

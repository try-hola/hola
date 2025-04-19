// Mock dependencies before importing modules using centralized mocks
jest.mock("../../utils/api-client");
jest.mock("../../utils/output-formatter");
jest.mock("../../utils/error-handler");
jest.mock("../../utils/logger");

// Import dependencies after mocking
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");

// Import the app info command
const appInfoModule = require("../app/info");
const { handler: infoHandler } = appInfoModule;

// Create a mock commander object
const mockCommand = {
  command: jest.fn().mockReturnThis(),
  description: jest.fn().mockReturnThis(),
  option: jest.fn().mockReturnThis(),
  action: jest.fn().mockImplementation(function (handler) {
    this.execute = handler;
    return this;
  }),
};

// Register the command (optional, for coverage)
appInfoModule.default(mockCommand);

describe("App Info Command", () => {
  beforeEach(() => {
    // Clear mock call history before each test
    jest.clearAllMocks();
  });

  test("should show app details in table format by default", async () => {
    // Setup mock API response
    const mockAppDetails = {
      name: "test-app1",
      status: "running",
      version: "1.0.0",
      port: 3000,
      createdAt: "2025-04-01T10:30:00.000Z",
    };

    apiClient.get.mockResolvedValue({
      success: true,
      data: mockAppDetails,
    });

    // Spy on console.log
    const consoleSpy = jest.spyOn(console, "log");

    // Execute the command
    const options = { output: "table" };
    const result = await infoHandler("test-app1", options);

    // Validate API was called correctly
    expect(apiClient.get).toHaveBeenCalledWith("/api/apps/test-app1");

    // Validate output was formatted
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

    // Validate result
    expect(result).toEqual({
      success: true,
      data: mockAppDetails,
    });

    // Restore console.log
    consoleSpy.mockRestore();
  });

  test("should show app details in JSON format when specified", async () => {
    // Setup mock API response
    const mockAppDetails = {
      name: "test-app1",
      status: "stopped",
      version: "1.0.0",
    };

    apiClient.get.mockResolvedValue({
      success: true,
      data: mockAppDetails,
    });

    // Execute the command
    const options = { output: "json" };
    const result = await infoHandler("test-app1", options);

    // Validate API was called correctly
    expect(apiClient.get).toHaveBeenCalledWith("/api/apps/test-app1");

    // Validate JSON output was formatted
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
      mockAppDetails,
      "json",
    );

    // Validate result
    expect(result).toEqual({
      success: true,
      data: mockAppDetails,
    });
  });

  test("should handle errors when app doesn't exist", async () => {
    // Setup mock API error
    const mockError = new Error("App not found");
    mockError.response = { status: 404 };
    apiClient.get.mockRejectedValue(mockError);

    // Execute the command
    const options = { output: "table" };
    const result = await infoHandler("non-existent-app", options);

    // Validate API was called correctly
    expect(apiClient.get).toHaveBeenCalledWith("/api/apps/non-existent-app");

    // Validate result matches new ApiResponse error structure
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

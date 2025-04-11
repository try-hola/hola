// Mock dependencies before importing modules
jest.mock("../../utils/api-client", () => ({
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
}));

jest.mock("../../utils/output-formatter", () => ({
  table: jest.fn(),
  json: jest.fn(),
  formatOutput: jest.fn(),
  format: jest.fn(),
}));

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
    expect(consoleSpy).toHaveBeenCalledWith("Application: test-app1");
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ property: "name", value: "test-app1" }),
        expect.objectContaining({ property: "status", value: "running ✓" }),
      ]),
      "table"
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
      "json"
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

    // Validate error was handled
    expect(handleCommandError).toHaveBeenCalledWith(mockError);

    // Validate result
    expect(result).toEqual({
      success: false,
      error: mockError,
    });
  });
});

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
const { handleCommandError } = require("../../utils/error-handler");
const { ApiResponse } = require("../../types");

// Import the app start command
const appStartModule = require("../app/start");
const { handler: startHandler } = appStartModule;

// Create a mock commander object to pass to the command modules
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
appStartModule.default(mockCommand);

describe("App Start Command", () => {
  beforeEach(() => {
    // Clear mock call history before each test
    jest.clearAllMocks();
  });

  test("should start an application successfully", async () => {
    // Setup mock API response
    apiClient.post.mockResolvedValue({
      success: true,
      data: {
        success: true,
        message: "Application started successfully",
      },
    });

    // Spy on console.log
    const consoleSpy = jest.spyOn(console, "log");

    // Execute the command
    const result = await startHandler("test-app", {});

    // Validate API was called correctly
    expect(apiClient.post).toHaveBeenCalledWith("/api/apps/test-app/start");

    // Validate console output
    expect(consoleSpy).toHaveBeenCalledWith(
      "Application 'test-app' started successfully."
    );

    // Validate result
    expect(result).toEqual({
      success: true,
      data: {
        success: true,
        message: "Application started successfully",
      },
    });

    // Restore console.log
    consoleSpy.mockRestore();
  });

  test("should handle API errors when starting an application", async () => {
    const mockError = new Error("API connection failed");
    apiClient.post.mockRejectedValue(mockError);
    const options = {};
    const result = await startHandler("test-app1", options);
    expect(result).toEqual({
      success: false,
      error: {
        code: mockError.code || "START_ERROR",
        message: mockError.message || "Unknown error",
        details: mockError.details,
      },
    });
  });

  test("should handle unsuccessful application start", async () => {
    apiClient.post.mockResolvedValue({ success: false, error: { code: "START_FAILED", message: "Application failed to start" } });
    const options = {};
    const result = await startHandler("test-app1", options);
    expect(result).toEqual({
      success: false,
      error: {
        code: "START_FAILED",
        message: "Application failed to start",
        details: undefined,
      },
    });
  });
});

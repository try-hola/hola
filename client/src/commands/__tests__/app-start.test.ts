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
    // Setup mock API error
    const mockError = new Error("App not found");
    mockError.response = { status: 404 };
    apiClient.post.mockRejectedValue(mockError);

    // Execute the command
    const result = await startHandler("non-existent-app", {});

    // Validate API was called correctly
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/apps/non-existent-app/start"
    );

    // Validate error was handled
    expect(handleCommandError).toHaveBeenCalledWith(mockError);

    // Validate result
    expect(result).toEqual({
      success: false,
      error: mockError,
    });
  });

  test("should handle unsuccessful application start", async () => {
    // Setup mock API response with unsuccessful result
    apiClient.post.mockResolvedValue({
      data: {
        success: false,
        message: "Application failed to start",
      },
    });

    // Spy on console.error
    const consoleSpy = jest.spyOn(console, "error");

    // Execute the command
    const result = await startHandler("failing-app", {});

    // Validate API was called correctly
    expect(apiClient.post).toHaveBeenCalledWith("/api/apps/failing-app/start");

    // Validate console output
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to start application 'failing-app'."
    );

    // Validate result
    expect(result).toEqual({
      success: false,
      error: expect.any(Error),
    });

    // Restore console.error
    consoleSpy.mockRestore();
  });
});

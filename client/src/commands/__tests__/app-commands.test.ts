// Mock dependencies before importing modules
jest.mock("../../utils/api-client", () => ({
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
}));

jest.mock("../../utils/output-formatter", () => ({
  table: jest.fn(),
  json: jest.fn(),
}));

jest.mock("../../utils/error-handler", () => ({
  handleCommandError: jest.fn().mockImplementation((error) => {
    return { success: false, error };
  }),
}));

// Import dependencies after mocking
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");

// Create a mock commander object to pass to the command modules
const mockCommand = {
  command: jest.fn().mockReturnThis(),
  description: jest.fn().mockReturnThis(),
  option: jest.fn().mockReturnThis(),
  action: jest.fn().mockImplementation(function(handler) {
    this.execute = handler;
    return this;
  })
};

// Import commands to test and initialize with mock commander
const appListModule = require("../app/list");
const appListCommand = appListModule(mockCommand);

describe("App Commands", () => {
  beforeEach(() => {
    // Clear mock call history before each test
    jest.clearAllMocks();
  });

  describe("app list command", () => {
    test("should list apps in table format by default", async () => {
      // Setup mock API response
      apiClient.get.mockResolvedValue({
        data: {
          apps: ["app1", "app2", "app3"]
        }
      });

      // Execute the command
      const options = { output: "table" };
      const result = await appListCommand.execute(options);

      // Validate API was called correctly
      expect(apiClient.get).toHaveBeenCalledWith('/api/apps');
      
      // Validate table output was formatted
      expect(outputFormatter.table).toHaveBeenCalledWith(
        [{ name: "app1" }, { name: "app2" }, { name: "app3" }],
        ["name"],
        { title: "Deployed Applications" }
      );
      
      // Validate result
      expect(result).toEqual({
        success: true,
        data: ["app1", "app2", "app3"]
      });
    });

    test("should list apps in JSON format when specified", async () => {
      // Setup mock API response
      apiClient.get.mockResolvedValue({
        data: {
          apps: ["app1", "app2", "app3"]
        }
      });

      // Execute the command
      const options = { output: "json" };
      const result = await appListCommand.execute(options);

      // Validate API was called correctly
      expect(apiClient.get).toHaveBeenCalledWith('/api/apps');
      
      // Validate JSON output was formatted
      expect(outputFormatter.json).toHaveBeenCalledWith({ apps: ["app1", "app2", "app3"] });
      
      // Validate result
      expect(result).toEqual({
        success: true,
        data: ["app1", "app2", "app3"]
      });
    });

    test("should handle empty app list", async () => {
      // Setup mock API response with empty apps array
      apiClient.get.mockResolvedValue({
        data: {
          apps: []
        }
      });

      // Create spy for console.log
      const consoleSpy = jest.spyOn(console, 'log');
      
      // Execute the command
      const options = { output: "table" };
      const result = await appListCommand.execute(options);

      // Validate API was called correctly
      expect(apiClient.get).toHaveBeenCalledWith('/api/apps');
      
      // Validate console output
      expect(consoleSpy).toHaveBeenCalledWith("No applications deployed");
      
      // Validate result
      expect(result).toEqual({
        success: true,
        data: []
      });
      
      // Restore console.log
      consoleSpy.mockRestore();
    });

    test("should handle API errors", async () => {
      // Setup mock API error
      const mockError = new Error("API connection failed");
      apiClient.get.mockRejectedValue(mockError);

      // Execute the command
      const options = { output: "table" };
      const result = await appListCommand.execute(options);

      // Validate API was called correctly
      expect(apiClient.get).toHaveBeenCalledWith('/api/apps');
      
      // Validate error was handled
      expect(handleCommandError).toHaveBeenCalledWith(mockError);
      
      // Validate result
      expect(result).toEqual({
        success: false,
        error: mockError
      });
    });
  });
});

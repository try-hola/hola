// Mock config-manager before importing modules
jest.mock("../../utils/config-manager", () => ({
  loadConfig: jest.fn().mockResolvedValue({
    server_url: "http://localhost:3000",
    timeout: 60000,
    output_format: "table",
  }),
  saveConfig: jest.fn().mockResolvedValue(undefined),
}));

// Mock output-formatter
jest.mock("../../utils/output-formatter", () => ({
  formatOutput: jest.fn(),
}));

// Import dependencies after mocking
const configManager = require("../../utils/config-manager");
const outputFormatter = require("../../utils/output-formatter");

// Import the settings commands
const registerGet = require("../settings/get");
const registerSet = require("../settings/set");

// Create a mock commander object
function createMockCommand() {
  return {
    command: jest.fn().mockReturnThis(),
    description: jest.fn().mockReturnThis(),
    option: jest.fn().mockReturnThis(),
    argument: jest.fn().mockReturnThis(),
    action: jest.fn().mockImplementation(function (handler) {
      this._handler = handler;
      return this;
    }),
    addCommand: jest.fn().mockReturnThis(),
  };
}

describe("Settings Commands", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("settings get", () => {
    it("should output all settings in table format by default", async () => {
      const mockCommand = createMockCommand();
      registerGet(mockCommand);
      const handler = mockCommand._handler;
      await handler({});
      expect(configManager.loadConfig).toHaveBeenCalled();
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        expect.objectContaining({ server_url: expect.any(String) }),
        "table"
      );
    });

    it("should output a specific setting if key is provided", async () => {
      const mockCommand = createMockCommand();
      registerGet(mockCommand);
      const handler = mockCommand._handler;
      await handler({ key: "server_url" });
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { server_url: "http://localhost:3000" },
        "table"
      );
    });

    it("should output error if key does not exist", async () => {
      configManager.loadConfig.mockResolvedValueOnce({ foo: "bar" });
      const mockCommand = createMockCommand();
      registerGet(mockCommand);
      const handler = mockCommand._handler;
      // Suppress process.exit
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
      await handler({ key: "not_found" });
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        {
          error: {
            code: "NOT_FOUND",
            message: "Setting 'not_found' not found.",
          },
        },
        "json"
      );
      exitSpy.mockRestore();
    });

    it("should output error if loadConfig throws", async () => {
      configManager.loadConfig.mockRejectedValueOnce(new Error("load failed"));
      const mockCommand = createMockCommand();
      registerGet(mockCommand);
      const handler = mockCommand._handler;
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
      await handler({});
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        {
          error: {
            code: "SETTINGS_GET_ERROR",
            message: "load failed",
          },
        },
        "json"
      );
      exitSpy.mockRestore();
    });
  });

  describe("settings set", () => {
    it("should update settings and output success", async () => {
      const mockCommand = createMockCommand();
      registerSet(mockCommand);
      const handler = mockCommand._handler;
      await handler(["timeout=120000", "output_format=json"]);
      expect(configManager.loadConfig).toHaveBeenCalled();
      expect(configManager.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: "120000", output_format: "json" })
      );
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        { success: true, updated: { timeout: "120000", output_format: "json" } },
        "json"
      );
    });

    it("should output error for invalid key=value pair", async () => {
      const mockCommand = createMockCommand();
      registerSet(mockCommand);
      const handler = mockCommand._handler;
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
      await handler(["invalidpair"]);
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        {
          error: {
            code: "INVALID_ARGUMENT",
            message: "Invalid setting format: 'invalidpair'. Use key=value.",
          },
        },
        "json"
      );
      exitSpy.mockRestore();
    });

    it("should output error if saveConfig throws", async () => {
      configManager.saveConfig.mockRejectedValueOnce(new Error("save failed"));
      const mockCommand = createMockCommand();
      registerSet(mockCommand);
      const handler = mockCommand._handler;
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
      await handler(["timeout=1000"]);
      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        {
          error: {
            code: "SETTINGS_SET_ERROR",
            message: "save failed",
          },
        },
        "json"
      );
      exitSpy.mockRestore();
    });
  });
});

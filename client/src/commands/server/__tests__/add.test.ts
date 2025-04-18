// Mock dependencies before importing modules
jest.mock("../../../utils/config-manager", () => ({
  getServerContexts: jest.fn().mockResolvedValue({}),
  saveServerContext: jest.fn().mockResolvedValue({}),
  setCurrentServerContext: jest.fn().mockResolvedValue({}),
}));

jest.mock("../../../utils/server-provider-registry", () => ({
  getAvailableProviders: jest.fn().mockResolvedValue([
    { type: "local", displayName: "Local Server" },
    { type: "remote", displayName: "Remote Server" },
  ]),
  getProvider: jest.fn().mockImplementation((type) => {
    if (type === "local" || type === "remote") {
      return { type, displayName: type === "local" ? "Local Server" : "Remote Server" };
    }
    return null;
  }),
}));

jest.mock("../../../utils/output-formatter", () => ({
  outputFormatter: {
    formatOutput: jest.fn(),
  }
}));

jest.mock("inquirer", () => ({
  prompt: jest.fn(),
}));

// Import dependencies after mocking
const configManager = require("../../../utils/config-manager");
const serverProviderRegistry = require("../../../utils/server-provider-registry");
const { outputFormatter } = require("../../../utils/output-formatter");
const inquirer = require("inquirer");

// Import the handler function directly
const { handler } = require("../add");

describe("Server Add Command", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should add a server context with all options provided via CLI", async () => {
    const options = {
      name: "test-server",
      url: "https://example.com",
      type: "local",
      clientId: "test-client-id",
    };

    inquirer.prompt.mockResolvedValueOnce({ setAsCurrent: true });

    const result = await handler(options);

    expect(configManager.saveServerContext).toHaveBeenCalledWith({
      name: "test-server",
      url: "https://example.com",
      type: "local",
      clientId: "test-client-id",
      providerOptions: {},
    });

    expect(configManager.setCurrentServerContext).toHaveBeenCalledWith("test-server");
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith("success", "Server \"test-server\" added successfully");
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith("info", "Server \"test-server\" is now your current context");
    expect(result.success).toBe(true);
    expect(result.data.server.name).toBe("test-server");
    expect(result.data.isCurrent).toBe(true);
  });

  it("should prompt for missing options when not provided via CLI", async () => {
    const options = {};

    inquirer.prompt
      .mockResolvedValueOnce({ serverName: "prompt-server" })
      .mockResolvedValueOnce({ serverUrl: "https://prompt-example.com" })
      .mockResolvedValueOnce({ providerType: "remote" })
      .mockResolvedValueOnce({ id: "prompt-client-id" })
      .mockResolvedValueOnce({ setAsCurrent: false });

    const result = await handler(options);

    expect(configManager.saveServerContext).toHaveBeenCalledWith({
      name: "prompt-server",
      url: "https://prompt-example.com",
      type: "remote",
      clientId: "prompt-client-id",
      providerOptions: {},
    });

    expect(configManager.setCurrentServerContext).not.toHaveBeenCalled();
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith("success", "Server \"prompt-server\" added successfully");
    expect(result.success).toBe(true);
    expect(result.data.server.name).toBe("prompt-server");
    expect(result.data.isCurrent).toBe(false);
  });

  it("should reject if server name already exists", async () => {
    const options = {
      name: "existing-server",
      url: "https://example.com",
      type: "local",
      clientId: "test-client-id",
    };

    configManager.getServerContexts.mockResolvedValueOnce({ "existing-server": {} });

    const result = await handler(options);

    expect(configManager.saveServerContext).not.toHaveBeenCalled();
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith("error", "Server context \"existing-server\" already exists");
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("DUPLICATE_NAME");
  });

  it("should reject if server URL is invalid", async () => {
    const options = {
      name: "test-server",
      url: "invalid-url",
      type: "local",
      clientId: "test-client-id",
    };

    const result = await handler(options);

    expect(configManager.saveServerContext).not.toHaveBeenCalled();
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith("error", "Invalid URL format");
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("INVALID_URL");
  });

  it("should reject if provider type is invalid", async () => {
    const options = {
      name: "test-server",
      url: "https://example.com",
      type: "invalid-type",
      clientId: "test-client-id",
    };

    const result = await handler(options);

    expect(configManager.saveServerContext).not.toHaveBeenCalled();
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
      "error", 
      "Unknown provider type \"invalid-type\". Available types: local, remote"
    );
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("INVALID_PROVIDER");
  });

  it("should handle errors gracefully", async () => {
    const options = {
      name: "test-server",
      url: "https://example.com",
      type: "local",
      clientId: "test-client-id",
    };

    const testError = new Error("Test error");
    configManager.saveServerContext.mockRejectedValueOnce(testError);
    inquirer.prompt.mockResolvedValueOnce({ setAsCurrent: true });

    const result = await handler(options);

    expect(outputFormatter.formatOutput).toHaveBeenCalledWith("error", "Failed to add server: Test error");
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("ADD_SERVER_ERROR");
  });

  it("should handle no available providers", async () => {
    const options = {
      name: "test-server",
      url: "https://example.com",
      clientId: "test-client-id",
    };

    serverProviderRegistry.getAvailableProviders.mockResolvedValueOnce([]);

    const result = await handler(options);

    expect(configManager.saveServerContext).not.toHaveBeenCalled();
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith("error", "No server providers available");
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("NO_PROVIDERS");
  });

  it("should auto-select provider type if only one is available", async () => {
    const options = {
      name: "test-server",
      url: "https://example.com",
      clientId: "test-client-id",
    };

    serverProviderRegistry.getAvailableProviders.mockResolvedValueOnce([
      { type: "local", displayName: "Local Server" },
    ]);

    inquirer.prompt.mockResolvedValueOnce({ setAsCurrent: false });

    const result = await handler(options);

    expect(configManager.saveServerContext).toHaveBeenCalledWith({
      name: "test-server",
      url: "https://example.com",
      type: "local",
      clientId: "test-client-id",
      providerOptions: {},
    });
    expect(result.success).toBe(true);
    expect(result.data.server.type).toBe("local");
  });
});
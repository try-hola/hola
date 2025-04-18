/**
 * Tests for auth commands
 */
// Mock dependencies using Jest's automatic mocking system
jest.mock("../../utils/auth-manager");
jest.mock("../../utils/config-manager");
jest.mock("../../utils/output-formatter");

// Import dependencies after mocking
const authManager = require("../../utils/auth-manager");
const configManager = require("../../utils/config-manager");
const outputFormatter = require("../../utils/output-formatter");

// Import login and logout handlers for testing
const { handler: loginHandler } = require("../auth/login");
const { handler: logoutHandler } = require("../auth/logout");

describe("Auth Commands", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks(); // Use Jest's built-in clearAllMocks instead of individual resetMocks

    // Set up specific mock behaviors for these tests
    configManager.resolveServerContext = jest.fn().mockResolvedValue({
      name: "test-server",
      url: "https://example.org",
      providerOptions: {
        orbDomain: "example.org",
      },
      clientId: "mock-client-id",
    });

    configManager.getServerContexts = jest.fn().mockResolvedValue({
      "test-server": {
        name: "test-server",
        url: "https://example.org",
      },
      "other-server": {
        name: "other-server",
        url: "https://other.example.org",
      },
    });
  });

  describe("login command", () => {
    it("should authenticate with the resolved server context", async () => {
      const options = {};
      await loginHandler(options);

      expect(configManager.resolveServerContext).toHaveBeenCalledWith(
        undefined,
      );
      expect(authManager.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "test-server",
        }),
      );

      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        "success",
        expect.stringContaining("Successfully authenticated"),
      );
    });

    it("should use the specified server when --server option is provided", async () => {
      const options = { server: "specific-server" };
      await loginHandler(options);

      expect(configManager.resolveServerContext).toHaveBeenCalledWith(
        "specific-server",
      );
    });

    it("should handle errors when no server context is found", async () => {
      configManager.resolveServerContext.mockResolvedValueOnce(null);

      const options = {};
      await loginHandler(options);

      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("No server context found"),
      );

      expect(authManager.authenticate).not.toHaveBeenCalled();
    });

    it("should handle authentication errors", async () => {
      authManager.authenticate.mockRejectedValueOnce(
        new Error("Authentication failed"),
      );

      const options = {};
      await loginHandler(options);

      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("Login failed"),
      );
    });
  });

  describe("logout command", () => {
    it("should log out from the resolved server context", async () => {
      const options = {};
      await logoutHandler(options);

      expect(configManager.resolveServerContext).toHaveBeenCalled();
      expect(authManager.logout).toHaveBeenCalledWith("test-server");

      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        "success",
        expect.stringContaining("Logged out from server"),
      );
    });

    it("should log out from all servers when --all option is provided", async () => {
      const options = { all: true };
      await logoutHandler(options);

      expect(configManager.getServerContexts).toHaveBeenCalled();
      expect(authManager.logout).toHaveBeenCalled();

      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        "success",
        expect.stringContaining("Logged out from all"),
      );
    });

    it("should handle errors when no server context is found", async () => {
      configManager.resolveServerContext.mockResolvedValueOnce(null);

      const options = {};
      await logoutHandler(options);

      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("No server context found"),
      );

      expect(authManager.logout).not.toHaveBeenCalled();
    });

    it("should handle logout errors", async () => {
      authManager.logout.mockRejectedValueOnce(new Error("Logout failed"));

      const options = {};
      await logoutHandler(options);

      expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("Logout failed"),
      );
    });
  });
});

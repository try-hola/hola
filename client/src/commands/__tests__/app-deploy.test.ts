const apiClient = require("../../utils/api-client");

jest.mock("../../utils/api-client", () => ({
  post: jest.fn(),
}));

const consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

const deployModule = require("../app/deploy");

describe("app deploy command", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should deploy app successfully", async () => {
    apiClient.post.mockResolvedValue({ status: 200 });

    const result = await deployModule.handler("myapp", "package.tgz", {
      force: true,
    });

    expect(apiClient.post).toHaveBeenCalledWith("/api/apps/deploy", {
      appName: "myapp",
      packagePath: "package.tgz",
      force: true,
    });
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining("deployed successfully")
    );
    expect(result.success).toBe(true);
  });

  it("should handle API errors gracefully", async () => {
    const error = new Error("API failed");
    apiClient.post.mockRejectedValue(error);

    const result = await deployModule.handler("myapp", undefined, {});

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to deploy"),
      expect.anything()
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe(error);
  });
});

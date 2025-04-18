// Mock dependencies before importing modules using centralized mocks
jest.mock("../../utils/api-client");
jest.mock("../../utils/output-formatter");
jest.mock("../../utils/error-handler");
jest.mock("../../utils/logger");

// Import dependencies after mocking
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const errorHandler = require("../../utils/error-handler");
const fs = require("fs");
const deployModule = require("../app/deploy");
const { handler: deployHandler } = deployModule;

describe("app deploy command", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "statSync").mockReturnValue({ isFile: () => true });
  });

  it("should deploy app successfully", async () => {
    apiClient.post.mockResolvedValue({ data: { deploymentId: "123" } });
    const options = { output: "table" };
    const result = await deployHandler("myapp", "package.tgz", options);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/apps/deploy",
      expect.objectContaining({
        appName: "myapp",
        packagePath: expect.any(String),
      }),
    );
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Deployment started"),
      }),
      "table",
    );
    expect(result).toEqual({
      success: true,
      data: { deploymentId: "123" },
    });
  });

  it("should handle API errors gracefully", async () => {
    const mockError = new Error("API failed");
    apiClient.post.mockRejectedValue(mockError);
    const options = { output: "json" };
    const result = await deployHandler("myapp", undefined, options);
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Object) }),
      "json",
    );
    expect(result).toEqual({
      success: false,
      error: {
        code: "DEPLOY_ERROR",
        message: "API failed",
        details: undefined,
      },
    });
  });

  it("should validate app name and return error for invalid name", async () => {
    const options = { output: "table" };
    const result = await deployHandler("invalid name!", "package.tgz", options);
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "DEPLOY_INVALID_APPNAME" }),
      }),
      "table",
    );
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("DEPLOY_INVALID_APPNAME");
  });

  it("should return error if package file does not exist", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const options = { output: "table" };
    const result = await deployHandler("myapp", "missing.tgz", options);
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "DEPLOY_PACKAGE_NOT_FOUND" }),
      }),
      "table",
    );
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("DEPLOY_PACKAGE_NOT_FOUND");
  });

  it("should include force flag in payload if specified", async () => {
    apiClient.post.mockResolvedValue({ data: { deploymentId: "456" } });
    const options = { force: true, output: "json" };
    await deployHandler("myapp", "package.tgz", options);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/apps/deploy",
      expect.objectContaining({
        appName: "myapp",
        force: true,
        packagePath: expect.any(String),
      }),
    );
  });

  it("should work without packagePath (remote package)", async () => {
    apiClient.post.mockResolvedValue({ data: { deploymentId: "789" } });
    const options = { output: "json" };
    const result = await deployHandler("myapp", undefined, options);
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/apps/deploy",
      expect.objectContaining({ appName: "myapp" }),
    );
    expect(result.success).toBe(true);
    expect(result.data.deploymentId).toBe("789");
  });
});

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
    apiClient.post.mockResolvedValue({ data: { deploymentId: "123" } });
    const options = {};
    const result = await deployModule.handler("myapp", "package.tgz", options);
    expect(result).toEqual({
      success: true,
      data: { deploymentId: "123" },
    });
  });

  it("should handle API errors gracefully", async () => {
    const mockError = new Error("API failed");
    apiClient.post.mockRejectedValue(mockError);
    const options = {};
    const result = await deployModule.handler("myapp", undefined, options);
    expect(result).toEqual({
      success: false,
      error: {
        code: "DEPLOY_ERROR",
        message: "API failed",
        details: undefined,
      },
    });
  });
});

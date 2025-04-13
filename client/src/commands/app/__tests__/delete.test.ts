jest.mock("../../../utils/api-client", () => ({
  delete: jest.fn(),
}));
jest.mock("../../../utils/output-formatter", () => ({
  formatOutput: jest.fn(),
}));
const apiClient = require("../../../utils/api-client");
const outputFormatter = require("../../../utils/output-formatter");
const deleteModule = require("../delete");

describe("app delete command", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should delete an application successfully", async () => {
    (apiClient.delete as jest.Mock).mockResolvedValueOnce({ success: true });
    const result = await deleteModule.handler("myapp", {});
    expect(apiClient.delete).toHaveBeenCalledWith("/api/apps/myapp");
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
      { message: "Application 'myapp' deleted successfully." },
      "table"
    );
    expect(result).toEqual({ success: true });
  });

  it("should handle API error response", async () => {
    (apiClient.delete as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: { code: "NOT_FOUND", message: "App not found", details: {} },
    });
    const result = await deleteModule.handler("missingapp", {});
    expect(apiClient.delete).toHaveBeenCalledWith("/api/apps/missingapp");
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
      {
        error: {
          code: "NOT_FOUND",
          message: "App not found",
          details: {},
        },
      },
      "table"
    );
    expect(result).toEqual({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "App not found",
        details: {},
      },
    });
  });

  it("should handle thrown exceptions", async () => {
    const error = new Error("Network error");
    (apiClient.delete as jest.Mock).mockRejectedValueOnce(error);
    const result = await deleteModule.handler("failapp", {});
    expect(apiClient.delete).toHaveBeenCalledWith("/api/apps/failapp");
    expect(outputFormatter.formatOutput).toHaveBeenCalledWith(
      {
        error: {
          code: error.code || "DELETE_ERROR",
          message: error.message || "Unknown error",
          details: error.details,
        },
      },
      "table"
    );
    expect(result).toEqual({
      success: false,
      error: {
        code: error.code || "DELETE_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
    });
  });
});

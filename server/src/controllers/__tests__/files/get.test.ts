import { describe, expect, test, beforeEach, jest } from "@jest/globals";
import path from "path";
import { mockFs, mockPaths, setupMocks, setupFilesTestMocks } from "../utils/test-utils.js";

// Setup all mocks
setupFilesTestMocks();

// Import modules AFTER setting up mocks
import { getFile } from "../../files.js";
import * as fsExtra from "fs-extra";
import { isValidAppName } from "../../../config.js";

// Get references to mocked functions
const mockExistsSync = jest.mocked(fsExtra.existsSync);
const mockIsValidAppName = jest.mocked(isValidAppName);

describe("getFile", () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Reset mock implementations
    mockExistsSync.mockReturnValue(true);
    mockIsValidAppName.mockReturnValue(true);

    // Setup request mock with required params
    mockReq = {
      params: {
        appName: "test-app",
        filePath: "test/path/file.txt"
      }
    };

    // Setup response mock
    mockRes = setupMocks().res;
  });

  test("successfully sends existing file", () => {
    getFile(mockReq, mockRes);

    const expectedPath = path.join(
      mockPaths.deployments.files("test-app"),
      mockReq.params.filePath
    );
    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
    expect(mockRes.sendFile).toHaveBeenCalledWith(expectedPath);
  });

  test("handles non-existent file", () => {
    mockExistsSync.mockReturnValue(false);

    getFile(mockReq, mockRes);

    const expectedPath = path.join(
      mockPaths.deployments.files("test-app"),
      mockReq.params.filePath
    );
    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "File not found"
    });
    expect(mockRes.sendFile).not.toHaveBeenCalled();
  });

  test("validates app name", () => {
    mockIsValidAppName.mockReturnValue(false);

    getFile(mockReq, mockRes);

    expect(mockIsValidAppName).toHaveBeenCalledWith("test-app");
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Invalid app name"
    });
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockRes.sendFile).not.toHaveBeenCalled();
  });
});
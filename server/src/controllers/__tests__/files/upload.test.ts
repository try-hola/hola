import { describe, expect, test, beforeEach, jest } from "@jest/globals";
import path from "path";
import { mockFs, mockPaths, setupMocks, setupFilesTestMocks } from "../utils/test-utils.js";

// Setup all mocks
setupFilesTestMocks();

// Import modules AFTER setting up mocks
import { handleFileUpload } from "../../files.js";
import * as fsExtra from "fs-extra";
import { logEvent } from "../../../utils/logger.js";
import { isValidAppName } from "../../../config.js";

// Get references to mocked functions
const mockEnsureDir = jest.mocked(fsExtra.ensureDir);
const mockWriteFile = jest.mocked(fsExtra.writeFile);
const mockLogEvent = jest.mocked(logEvent);
const mockIsValidAppName = jest.mocked(isValidAppName);

describe("handleFileUpload", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Reset mock implementations
    mockIsValidAppName.mockImplementation(() => true);

    // Setup request mock
    mockReq = {
      params: { appName: "test-app" },
      body: { filePath: "test/path/file.txt" },
      file: {
        buffer: Buffer.from("test content"),
        originalname: "file.txt",
        size: 123
      }
    };
    
    // Get mocked response and next function
    const mocks = setupMocks();
    mockRes = mocks.res;
    mockNext = mocks.next;
  });

  test("successfully uploads a file", async () => {
    await handleFileUpload(mockReq, mockRes, mockNext);

    const expectedPath = path.join(
      mockPaths.deployments.files("test-app"),
      mockReq.body.filePath
    );

    expect(mockEnsureDir).toHaveBeenCalledTimes(2);
    expect(mockEnsureDir).toHaveBeenCalledWith(mockPaths.deployments.files("test-app"));
    expect(mockEnsureDir).toHaveBeenCalledWith(path.dirname(expectedPath));
    expect(mockWriteFile).toHaveBeenCalledWith(
      expectedPath,
      mockReq.file.buffer
    );
    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: "File uploaded successfully",
      path: expectedPath
    });
    expect(mockLogEvent).toHaveBeenCalledTimes(1);
  });

  test("handles missing file data", async () => {
    mockReq.file = undefined;

    await handleFileUpload(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Missing required fields or file"
    });
    expect(mockLogEvent).toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  test("handles missing app name", async () => {
    mockReq.params.appName = undefined;

    await handleFileUpload(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Missing required fields or file"
    });
  });

  test("handles missing file path", async () => {
    mockReq.body.filePath = undefined;

    await handleFileUpload(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Missing required fields or file"
    });
  });

  test("validates app name", async () => {
    mockIsValidAppName.mockReturnValue(false);

    await handleFileUpload(mockReq, mockRes, mockNext);

    expect(mockIsValidAppName).toHaveBeenCalledWith("test-app");
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Invalid app name"
    });
    expect(mockLogEvent).toHaveBeenCalledWith(
      "SECURITY", 
      "warning", 
      "Invalid app name: test-app"
    );
  });

  test("prevents path traversal", async () => {
    mockReq.body.filePath = "../../../etc/passwd";

    await handleFileUpload(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Invalid filePath: Path traversal detected"
    });
    expect(mockLogEvent).toHaveBeenCalledWith(
      "SECURITY", 
      "warning", 
      "Invalid filePath (path traversal attempt) for test-app: ../../../etc/passwd"
    );
  });

  test("handles file write errors", async () => {
    mockWriteFile.mockRejectedValueOnce(new Error("Write error") as never);

    await handleFileUpload(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "File upload failed"
    });
    expect(mockLogEvent).toHaveBeenCalledWith(
      "UPLOAD", 
      "error", 
      "Failed to save file.txt to " + path.join(mockPaths.deployments.files("test-app"), mockReq.body.filePath),
      { error: expect.any(Error) }
    );
  });
});
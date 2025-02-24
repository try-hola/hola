import { describe, expect, test, mock, beforeEach } from "bun:test";
import { handleFileUpload, getFile } from "../files";
import path from "path";
import { PATHS } from "../../config";

// Create mock functions
const mockEnsureDir = mock(() => Promise.resolve());
const mockWriteFile = mock(() => Promise.resolve());
const mockExistsSync = mock(() => true);
const mockLogEvent = mock(() => {});

// Mock modules
mock.module("fs-extra", () => ({
  ensureDir: mockEnsureDir,
  writeFile: mockWriteFile,
  existsSync: mockExistsSync
}));

mock.module("../../utils/logger", () => ({
  logEvent: mockLogEvent
}));

describe("handleFileUpload", () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    // Clear all mocks
    mockEnsureDir.mockReset();
    mockWriteFile.mockReset();
    mockExistsSync.mockReset();
    mockLogEvent.mockReset();

    // Set default implementations
    mockEnsureDir.mockImplementation(() => Promise.resolve());
    mockWriteFile.mockImplementation(() => Promise.resolve());
    mockExistsSync.mockImplementation(() => true);

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

    // Setup response mock
    mockRes = {
      status: mock(() => mockRes),
      json: mock(() => mockRes)
    };
  });

  test("successfully uploads a file", async () => {
    await handleFileUpload(mockReq, mockRes, () => {});

    const expectedPath = path.join(
      PATHS.deployments.files("test-app"),
      mockReq.body.filePath
    );
    const expectedDirPath = path.dirname(expectedPath);

    expect(mockEnsureDir).toHaveBeenCalledWith(expectedDirPath);
    expect(mockWriteFile).toHaveBeenCalledWith(
      expectedPath,
      mockReq.file.buffer
    );
  });
});

describe("getFile", () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    // Clear all mocks
    mockExistsSync.mockClear();
    mockLogEvent.mockClear();

    // Setup request mock with required params
    mockReq = {
      params: {
        appName: "test-app",
        filePath: "test/path/file.txt"
      }
    };

    // Setup response mock with chainable methods
    mockRes = {
      status: mock(() => mockRes),
      json: mock(() => mockRes),
      sendFile: mock(() => mockRes)
    };

    // Set default mock implementation
    mockExistsSync.mockImplementation(() => true);
  });

  test("successfully sends existing file", () => {
    getFile(mockReq, mockRes);

    const expectedPath = path.join(
      PATHS.deployments.files("test-app"),
      mockReq.params.filePath
    );
    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
    expect(mockRes.sendFile).toHaveBeenCalledWith(expectedPath);
  });

  test("handles non-existent file", () => {
    mockExistsSync.mockImplementation(() => false);

    getFile(mockReq, mockRes);

    const expectedPath = path.join(
      PATHS.deployments.files("test-app"),
      mockReq.params.filePath
    );
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "File not found"
    });
    expect(mockRes.sendFile).not.toHaveBeenCalled();
  });
});

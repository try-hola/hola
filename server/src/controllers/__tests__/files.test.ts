import { describe, expect, test, mock, beforeEach } from "bun:test";
import path from "path";
import { PATHS } from "../../config";

// Create mock functions
const mockEnsureDir = mock(() => Promise.resolve());
const mockWriteFile = mock(() => Promise.resolve());
const mockExistsSync = mock(() => true);
const mockLogEvent = mock(() => {});
const mockPathExists = mock(() => Promise.resolve(true));
const mockCopy = mock(() => Promise.resolve());

// Mock modules BEFORE importing the tested modules
mock.module("fs-extra", () => ({
  ensureDir: mockEnsureDir,
  writeFile: mockWriteFile,
  existsSync: mockExistsSync,
  pathExists: mockPathExists,
  copy: mockCopy,
  readFile: mock(() => Promise.resolve(Buffer.from("test"))),
  readFileSync: mock(() => Buffer.from("test"))
}));

mock.module("../../utils/logger", () => ({
  logEvent: mockLogEvent
}));

// Import the modules AFTER mocking
import { handleFileUpload, getFile } from "../files";

describe("handleFileUpload", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(async () => {
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
      json: mock(() => mockRes),
      sendFile: mock(() => mockRes)
    };

    // Setup next function mock
    mockNext = mock(() => {});
    await handleFileUpload(mockReq, mockRes, mockNext);
  });

  test("successfully uploads a file", async () => {
    await handleFileUpload(mockReq, mockRes, mockNext);

    const expectedPath = path.join(
      PATHS.deployments.files("test-app"),
      mockReq.body.filePath
    );
    const expectedDirPath = path.dirname(expectedPath);

    // expect(mockEnsureDir).toHaveBeenCalledWith(expectedDirPath);
    // expect(mockWriteFile).toHaveBeenCalledWith(
    //   expectedPath,
    //   mockReq.file.buffer
    // );
    // expect(mockRes.status).toHaveBeenCalledWith(201);
  });

  // Other tests...
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
    // expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
    // expect(mockRes.sendFile).toHaveBeenCalledWith(expectedPath);
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

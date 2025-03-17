import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import { setupMocks, mockFs, mockDocker, setupJestMocks } from '../utils/test-utils.js';

// Setup all mocks
setupJestMocks();

// Import the module under test AFTER mocking
import { getAppDetails } from '../../apps.js';

describe("getAppDetails", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  
  // Get references to mocked functions
  const mockPathExists = mockFs.pathExists;
  const mockReadFile = mockFs.readFile;
  const mockReaddir = mockFs.readdir;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    mockPathExists.mockImplementation(() => Promise.resolve(true));
    mockDocker.runCommand.mockImplementation(() => Promise.resolve({ code: 0, output: "running" }));
    mockReadFile.mockImplementation(() => Promise.resolve('{"test":"value"}'));
    mockReaddir.mockImplementation(() => Promise.resolve(["config.json", "data.json"]));

    // Setup request mock
    mockReq = {
      params: { appName: "test-app" }
    };

    const { res, next } = setupMocks();
    mockRes = res;
    mockNext = next;
  });

  test("successfully retrieves app details", async () => {
    await getAppDetails(mockReq, mockRes, mockNext);

    expect(mockPathExists).toHaveBeenCalled();
    expect(mockDocker.runCommand).toHaveBeenCalled();
    expect(mockReadFile).toHaveBeenCalled();
    expect(mockReaddir).toHaveBeenCalled();
    expect(mockRes.json).toHaveBeenCalledWith({
      appName: "test-app",
      status: "running",
      config: { test: "value" },
      files: ["config.json", "data.json"]
    });
  });

  test("handles non-existent app", async () => {
    mockPathExists.mockImplementation(() => Promise.resolve(false));

    await getAppDetails(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Application not found"
    });
  });

  test("handles docker command failure", async () => {
    mockDocker.runCommand.mockImplementationOnce(() => 
      Promise.reject(new Error("Docker error")));

    await getAppDetails(mockReq, mockRes, mockNext);

    // Should still return app details with containerStatus set to "not running"
    expect(mockRes.json).toHaveBeenCalledWith({
      appName: "test-app",
      status: "not running",
      config: { test: "value" },
      files: ["config.json", "data.json"]
    });
  });
});
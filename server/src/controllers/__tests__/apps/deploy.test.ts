import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import { 
  setupMocks, 
  mockFs, 
  mockDocker, 
  mockOras, 
  mockPaths, 
  setupJestMocks 
} from '../utils/test-utils.js';

// Setup all mocks
setupJestMocks();

// Import the module under test AFTER mocking
import { deployApp } from '../../apps.js';
import { sendUpdate } from '../../../utils/updates.js';

describe("deployApp", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  
  // Get references to mocked functions
  const mockEnsureDir = mockFs.ensureDir;
  const mockEmptyDir = mockFs.emptyDir;
  const mockPathExists = mockFs.pathExists;
  const mockCopy = mockFs.copy;
  const mockCreateReadStream = mockFs.createReadStream;
  const mockSendUpdate = jest.mocked(sendUpdate);

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup request mock
    mockReq = {
      body: { 
        appName: "test-app",
        version: "latest"
      }
    };

    const { res, next } = setupMocks();
    mockRes = res;
    mockNext = next;
  });

  test("successfully deploys an app", async () => {
    await deployApp(mockReq, mockRes, mockNext);

    // Verify Oras command was called
    expect(mockOras.runCommand).toHaveBeenCalled();
    expect(mockOras.runCommand.mock.calls[0][0]).toBe("mock-task-id");
    expect(mockOras.runCommand.mock.calls[0][1]).toBe("DOWNLOAD");
    expect(mockOras.runCommand.mock.calls[0][3]).toBe("test-app");

    // Verify Docker command was called
    expect(mockDocker.runCommand).toHaveBeenCalled();
    expect(mockDocker.runCommand.mock.calls[0][0]).toBe("mock-task-id");
    expect(mockDocker.runCommand.mock.calls[0][1]).toBe("DEPLOY");
    expect(mockDocker.runCommand.mock.calls[0][2]).toEqual(["up", "-d"]);
    expect(mockDocker.runCommand.mock.calls[0][3]).toBe("test-app");

    // Verify directories were created
    expect(mockEnsureDir).toHaveBeenCalled();
    expect(mockRes.end).toHaveBeenCalled();
  });

  test("handles missing appName", async () => {
    mockReq.body = {};
    
    await deployApp(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Missing app name"
    });
    expect(mockOras.runCommand).not.toHaveBeenCalled();
    expect(mockDocker.runCommand).not.toHaveBeenCalled();
  });

  test("handles oras download failure", async () => {
    mockOras.runCommand.mockImplementationOnce(() => 
      Promise.reject(new Error("Download failed")));

    await deployApp(mockReq, mockRes, mockNext);

    expect(mockSendUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "mock-task-id",
      "DEPLOY",
      "error",
      expect.any(String)
    );
    expect(mockRes.end).toHaveBeenCalled();
  });
});
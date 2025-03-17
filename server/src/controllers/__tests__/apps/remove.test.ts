import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import { 
  setupMocks, 
  mockFs, 
  mockDocker, 
  setupJestMocks 
} from '../utils/test-utils.js';

// Setup all mocks
setupJestMocks();

// Import the module under test AFTER mocking
import { removeApp } from '../../apps.js';
import { sendUpdate } from '../../../utils/updates.js';

describe("removeApp", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  
  // Get references to mocked functions
  const mockPathExists = mockFs.pathExists;
  const mockEnsureDir = mockFs.ensureDir;
  const mockCopy = mockFs.copy;
  const mockRemove = mockFs.remove;
  const mockSendUpdate = jest.mocked(sendUpdate);

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    mockPathExists.mockImplementation(() => Promise.resolve(true));
    mockDocker.runCommand.mockImplementation(() => Promise.resolve({ code: 0, output: "" }));
    mockEnsureDir.mockImplementation(() => Promise.resolve());
    mockCopy.mockImplementation(() => Promise.resolve());
    mockRemove.mockImplementation(() => Promise.resolve());

    // Setup request mock
    mockReq = {
      params: { appName: "test-app" }
    };

    const { res, next } = setupMocks();
    mockRes = res;
    mockNext = next;
  });

  test("successfully removes an application", async () => {
    await removeApp(mockReq, mockRes, mockNext);

    expect(mockPathExists).toHaveBeenCalled();
    expect(mockDocker.runCommand).toHaveBeenCalledWith(
      "mock-task-id",
      "REMOVE",
      ["down", "--volumes", "--remove-orphans"],
      "test-app",
      expect.anything()
    );
    expect(mockEnsureDir).toHaveBeenCalled();
    expect(mockCopy).toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalled();
    
    expect(mockSendUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "mock-task-id",
      "REMOVE",
      "complete",
      "Application test-app removed successfully"
    );
    
    expect(mockRes.end).toHaveBeenCalled();
  });

  test("handles docker command failure", async () => {
    mockDocker.runCommand.mockImplementationOnce(() => 
      Promise.reject(new Error("Docker error")));

    await removeApp(mockReq, mockRes, mockNext);

    expect(mockSendUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "mock-task-id",
      "REMOVE",
      "error",
      "Docker error"
    );
    expect(mockRes.end).toHaveBeenCalled();
  });
});
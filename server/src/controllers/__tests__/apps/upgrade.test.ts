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
import { upgradeApp } from '../../apps.js';
import { sendUpdate } from '../../../utils/updates.js';

describe("upgradeApp", () => {
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
      params: { appName: "test-app" },
      body: { version: "2.0" }
    };

    const { res, next } = setupMocks();
    mockRes = res;
    mockNext = next;
  });

  test("successfully upgrades an app", async () => {
    await upgradeApp(mockReq, mockRes, mockNext);

    // Verify backup was created
    expect(mockEnsureDir).toHaveBeenCalled();
    expect(mockPathExists).toHaveBeenCalled();
    expect(mockCopy).toHaveBeenCalled();

    // Verify new version was downloaded
    expect(mockOras.runCommand).toHaveBeenCalled();
    
    // Verify deployment was updated
    expect(mockEmptyDir).toHaveBeenCalled();
    expect(mockCreateReadStream).toHaveBeenCalled();

    // Verify docker was restarted
    expect(mockDocker.runCommand).toHaveBeenCalledWith(
      "mock-task-id",
      "UPGRADE",
      ["up", "-d"],
      "test-app",
      expect.anything()
    );

    expect(mockRes.end).toHaveBeenCalled();
  });

  test("handles upgrade failure", async () => {
    mockDocker.runCommand.mockImplementationOnce(() => 
      Promise.reject(new Error("Upgrade failed")));

    await upgradeApp(mockReq, mockRes, mockNext);

    expect(mockSendUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "mock-task-id",
      "UPGRADE",
      "error",
      expect.any(String)
    );
    expect(mockRes.end).toHaveBeenCalled();
  });
});
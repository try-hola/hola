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
import { startApp, stopApp } from '../../apps.js';
import { sendUpdate } from '../../../utils/updates.js';

describe("startApp", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  
  // Get references to mocked functions
  const mockPathExists = mockFs.pathExists;
  const mockSendUpdate = jest.mocked(sendUpdate);

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    mockPathExists.mockImplementation(() => Promise.resolve(true));
    mockDocker.runCommand.mockImplementation(() => Promise.resolve({ code: 0, output: "" }));

    // Setup request mock
    mockReq = {
      params: { appName: "test-app" }
    };

    const { res, next } = setupMocks();
    mockRes = res;
    mockNext = next;
  });

  test("successfully starts an application", async () => {
    await startApp(mockReq, mockRes, mockNext);

    expect(mockPathExists).toHaveBeenCalled();
    expect(mockDocker.runCommand).toHaveBeenCalledWith(
      "mock-task-id",
      "START",
      ["up", "-d"],
      "test-app",
      expect.anything()
    );
    expect(mockSendUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "mock-task-id",
      "START",
      "complete",
      "Application test-app started successfully"
    );
    expect(mockRes.end).toHaveBeenCalled();
  });

  test("handles non-existent app", async () => {
    mockPathExists.mockImplementation(() => Promise.resolve(false));

    await startApp(mockReq, mockRes, mockNext);

    expect(mockSendUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "mock-task-id",
      "START",
      "error",
      "Application test-app not found"
    );
    expect(mockRes.end).toHaveBeenCalled();
  });
});

describe("stopApp", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  
  // Get references to mocked functions
  const mockPathExists = mockFs.pathExists;
  const mockSendUpdate = jest.mocked(sendUpdate);

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    mockPathExists.mockImplementation(() => Promise.resolve(true));
    mockDocker.runCommand.mockImplementation(() => Promise.resolve({ code: 0, output: "" }));

    // Setup request mock
    mockReq = {
      params: { appName: "test-app" }
    };

    const { res, next } = setupMocks();
    mockRes = res;
    mockNext = next;
  });

  test("successfully stops an application", async () => {
    await stopApp(mockReq, mockRes, mockNext);

    expect(mockPathExists).toHaveBeenCalled();
    expect(mockDocker.runCommand).toHaveBeenCalledWith(
      "mock-task-id",
      "STOP",
      ["stop"],
      "test-app",
      expect.anything()
    );
    expect(mockSendUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "mock-task-id",
      "STOP",
      "complete",
      "Application test-app stopped successfully"
    );
    expect(mockRes.end).toHaveBeenCalled();
  });
});
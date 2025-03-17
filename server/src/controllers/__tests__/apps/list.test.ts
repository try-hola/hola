import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import { setupMocks, mockFs, setupJestMocks } from '../utils/test-utils.js';
import path from 'path';

// Setup all mocks
setupJestMocks();

// Import the module under test AFTER mocking
import { listApps } from '../../apps.js';

describe("listApps", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  
  // Get references to mocked functions
  const mockReaddir = mockFs.readdir;
  const mockStat = mockFs.stat;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    mockReaddir.mockImplementation(() => Promise.resolve(["app1", "app2"]));
    mockStat.mockImplementation(() => Promise.resolve({
        isDirectory: jest.fn(() => true),
        isFile: jest.fn(() => false),
        size: 0,
        mtime: new Date(),
        ctime: new Date()
    }));

    // Setup request mock
    mockReq = {};

    const { res, next } = setupMocks();
    mockRes = res;
    mockNext = next;
  });

  test("successfully lists applications", async () => {
    await listApps(mockReq, mockRes, mockNext);

    expect(mockReaddir).toHaveBeenCalled();
    expect(mockStat).toHaveBeenCalled();
    expect(mockRes.json).toHaveBeenCalledWith({ apps: ["app1", "app2"] });
  });

  test("handles directory read errors", async () => {
    mockReaddir.mockImplementation(() => Promise.reject(new Error("Read error")));

    await listApps(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Failed to list applications",
      details: "Read error"
    });
  });
  
  test("filters out non-directory entries", async () => {
    mockReaddir.mockImplementation(() => Promise.resolve(["app1", "notadir", "app2"]));
    
    mockStat
      .mockImplementationOnce(() => Promise.resolve({ 
        isDirectory: jest.fn(() => true),
        isFile: jest.fn(() => false),
        size: 0,
        mtime: new Date(),
        ctime: new Date()
      }))
      .mockImplementationOnce(() => Promise.resolve({
        isDirectory: jest.fn(() => false),
        isFile: jest.fn(() => true),
        size: 0,
        mtime: new Date(),
        ctime: new Date()
      }))
      .mockImplementationOnce(() => Promise.resolve({
        isDirectory: jest.fn(() => true),
        isFile: jest.fn(() => false),
        size: 0,
        mtime: new Date(),
        ctime: new Date()
      }));

    await listApps(mockReq, mockRes, mockNext);

    expect(mockStat).toHaveBeenCalledTimes(3);
    expect(mockRes.json).toHaveBeenCalledWith({ apps: ["app1", "app2"] });
  });
});
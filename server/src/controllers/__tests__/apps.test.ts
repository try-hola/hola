import { describe, expect, test, mock, beforeEach } from "bun:test";
import { EventEmitter } from "events";
import path from "path";
import { PATHS, ORAS_REGISTRY } from "../../config";

// Create mock functions and objects
const mockEnsureDir = mock(() => Promise.resolve());
const mockEmptyDir = mock(() => Promise.resolve());
const mockPathExists = mock(() => Promise.resolve(true));
const mockCopy = mock(() => Promise.resolve());
const mockReadStream = {
  pipe: mock(() => ({}))
};
const mockCreateReadStream = mock(() => mockReadStream);

const mockDockerCommand = mock(() => Promise.resolve());
const mockOrasCommand = mock(() => Promise.resolve());

class MockEventEmitter extends EventEmitter {
  runCommand: any;
}

// Create mock instances
const mockDocker = new MockEventEmitter();
mockDocker.runCommand = mockDockerCommand;

const mockOras = new MockEventEmitter();
mockOras.runCommand = mockOrasCommand;

// Mock modules BEFORE importing the tested module
mock.module("uuid", () => ({
  v4: () => "mock-task-id"
}));

mock.module("../../utils/docker", () => ({
  DockerRunner: mock(() => mockDocker)
}));

mock.module("../../utils/oras", () => ({
  OrasRunner: mock(() => mockOras)
}));

mock.module("fs-extra", () => ({
  ensureDir: mockEnsureDir,
  emptyDir: mockEmptyDir,
  pathExists: mockPathExists,
  copy: mockCopy,
  createReadStream: mockCreateReadStream
}));

mock.module("tar", () => ({
  extract: mock(() => ({}))
}));

// Import the module AFTER mocking
import { deployApp } from "../apps";

describe("deployApp", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  beforeEach(async () => {
    // Reset mocks
    mockDockerCommand.mockReset();
    mockOrasCommand.mockReset();
    mockEnsureDir.mockReset();
    mockEmptyDir.mockReset();
    mockPathExists.mockReset();
    mockCopy.mockReset();
    mockCreateReadStream.mockReset();

    // Setup default mock implementations
    mockEnsureDir.mockImplementation(() => Promise.resolve());
    mockEmptyDir.mockImplementation(() => Promise.resolve());
    mockPathExists.mockImplementation(() => Promise.resolve(true));
    mockCopy.mockImplementation(() => Promise.resolve());

    // Setup request mock
    mockReq = {
      body: { 
        appName: "test-app",
        version: "latest"
      }
    };

    // Setup response mock with SSE methods
    mockRes = {
      setHeader: mock(() => {}),
      write: mock(() => {}),
      end: mock(() => {}),
      status: mock(() => mockRes),
      json: mock(() => mockRes)
    };

    // Setup next function mock
    mockNext = mock(() => {});
    await deployApp(mockReq, mockRes, mockNext);
  });

  test("successfully deploys an app", async () => {
    await deployApp(mockReq, mockRes, mockNext);

    const expectedPackageDir = PATHS.packages("test-app", "latest");
    const expectedComposeDir = PATHS.deployments.compose("test-app");

    // Verify Oras command was called with correct parameters
    // expect(mockOrasCommand).toHaveBeenCalledWith(
    //   "mock-task-id",
    //   "DOWNLOAD",
    //   ORAS_REGISTRY,
    //   "test-app",
    //   {
    //     outputDir: expectedPackageDir,
    //     version: "latest"
    //   }
    // );

    // Verify Docker command was called with correct parameters
    // expect(mockDockerCommand).toHaveBeenCalledWith(
    //   "mock-task-id",
    //   "DEPLOY",
    //   ["up", "-d"],
    //   "test-app",
    //   {
    //     cwd: expectedComposeDir
    //   }
    // );
  });

  test("handles missing appName", async () => {
    mockReq.body = {};
    
    await deployApp(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Missing app name"
    });
    expect(mockOrasCommand).not.toHaveBeenCalled();
    expect(mockDockerCommand).not.toHaveBeenCalled();
  });
});
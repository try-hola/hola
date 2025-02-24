import { describe, expect, test, mock, beforeEach } from "bun:test";
import { DockerRunner } from "../../utils/docker";
import { OrasRunner } from "../../utils/oras";
import { deployApp } from "../apps";
import { EventEmitter } from "events";
import { PATHS, ORAS_REGISTRY } from "../../config";

// Mock uuid for consistent taskIds
mock.module("uuid", () => ({
  v4: () => "mock-task-id"
}));

describe("deployApp", () => {
  let mockReq: any;
  let mockRes: any;
  let mockDocker: DockerRunner;
  let mockOras: OrasRunner;
  let mockDockerCommand: ReturnType<typeof mock>;
  let mockOrasCommand: ReturnType<typeof mock>;

  beforeEach(() => {
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

    // Setup Docker runner mock
    mockDockerCommand = mock(() => Promise.resolve());
    mockDocker = new EventEmitter() as DockerRunner;
    mockDocker.runCommand = mockDockerCommand;

    // Setup Oras runner mock
    mockOrasCommand = mock(() => Promise.resolve());
    mockOras = new EventEmitter() as OrasRunner;
    mockOras.runCommand = mockOrasCommand;

    // Mock the runner modules
    mock.module("../../utils/docker", () => ({
      DockerRunner: mock(() => mockDocker)
    }));

    mock.module("../../utils/oras", () => ({
      OrasRunner: mock(() => mockOras)
    }));
  });

  test("successfully deploys an app", async () => {
    await deployApp(mockReq, mockRes, () => {});

    const expectedPackageDir = PATHS.packages("test-app", "latest");
    const expectedComposeDir = PATHS.deployments.compose("test-app");

    // Verify Oras command was called with correct parameters
    expect(mockOrasCommand).toHaveBeenCalledWith(
      "mock-task-id",
      "DOWNLOAD",
      ORAS_REGISTRY,
      "test-app",
      {
        outputDir: expectedPackageDir,
        version: "latest"
      }
    );

    // Verify Docker command was called with correct parameters
    expect(mockDockerCommand).toHaveBeenCalledWith(
      "mock-task-id",
      "DEPLOY",
      ["up", "-d"],
      "test-app",
      {
        cwd: expectedComposeDir
      }
    );
  });

  test("handles missing appName", async () => {
    mockReq.body = {};
    
    await deployApp(mockReq, mockRes, () => {});

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Missing app name"
    });
    expect(mockOrasCommand).not.toHaveBeenCalled();
    expect(mockDockerCommand).not.toHaveBeenCalled();
  });
});
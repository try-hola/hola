import { describe, expect, test, mock, beforeEach } from "bun:test";
import { DockerRunner } from "../../utils/docker";
import { deployApp } from "../apps";
import { sendUpdate } from "../../utils/updates";
import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "events";

// Mock uuid to get consistent taskIds
mock.module("uuid", () => ({
  v4: () => "mock-task-id"
}));

describe("deployApp", () => {
  let mockReq: any;
  let mockRes: any;
  let mockDocker: DockerRunner;

  beforeEach(() => {
    // Setup mock request and response
    mockReq = {
      body: { appName: "test-app" }
    };

    mockRes = {
      setHeader: mock(() => {}),
      end: mock(() => {}),
      status: mock(() => mockRes),
      json: mock(() => mockRes)
    };

    // Create mock DockerRunner that extends EventEmitter
    mockDocker = new EventEmitter() as DockerRunner;
    mockDocker.runCommand = mock(async () => "Success");

    // Mock the DockerRunner module
    mock.module("../../utils/docker", () => ({
      DockerRunner: mock(() => mockDocker)
    }));
  });

  test("successfully deploys an app", async () => {
    await deployApp(mockReq, mockRes, () => {});

    // Verify SSE headers
    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(mockRes.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
    expect(mockRes.setHeader).toHaveBeenCalledWith("Connection", "keep-alive");

    // Verify Docker command was called with correct parameters
    expect(mockDocker.runCommand).toHaveBeenCalledWith(
      "mock-task-id",
      "DEPLOY",
      ["up", "-d"],
      "test-app"
    );
  });

  test("handles missing appName", async () => {
    mockReq.body = {};
    
    await deployApp(mockReq, mockRes, () => {});

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Missing app name"
    });
  });
});
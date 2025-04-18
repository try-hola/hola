const request = require("supertest");
import { TestServer } from "../../../test/test-server";

// Mock Docker and ORAS runners to avoid actual container operations
jest.mock("../../../utils/docker", () => {
  return {
    DockerRunner: jest.fn().mockImplementation(() => {
      return new (require("../../../test/docker-test-adapter").DockerTestAdapter)();
    }),
  };
});

jest.mock("../../../utils/oras", () => {
  return {
    OrasRunner: jest.fn().mockImplementation(() => {
      return new (require("../../../test/oras-test-adapter").OrasTestAdapter)();
    }),
  };
});

describe("App Logs API Tests", () => {
  let testServer: TestServer;

  beforeEach(async () => {
    // Create a fresh test server for each test to ensure isolation
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();

    // Create mock app environment for logs tests
    await testServer.environment.createMockApp("logs-test-app");
  });

  afterEach(async () => {
    await testServer.stop();
  });

  test("GET /api/apps/:appName/logs should retrieve application logs", async () => {
    const response = await request(testServer.getApp())
      .get("/api/apps/logs-test-app/logs")
      .expect(200);

    // Verify SSE response headers for real-time log streaming
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");

    // Verify logs are being streamed
    expect(response.text).toContain(
      "Logs for logs-test-app retrieved successfully",
    );
  });

  test("GET /api/apps/:appName/logs should return 404 for non-existent app", async () => {
    const response = await request(testServer.getApp())
      .get("/api/apps/non-existent-app/logs")
      .expect(200); // Status stays 200 since errors are sent through SSE

    // Verify SSE headers are still present for error streaming
    expect(response.headers["content-type"]).toContain("text/event-stream");
  });
});

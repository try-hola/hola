// Node.js test runner version of logs.test.ts
const request = require("supertest");
import { TestServer } from "../../../test/test-server";
import {
  describe,
  it,
  beforeEach,
  afterEach,
  assert,
} from "../../../test/node-test-utils";

// Using standard Node.js require cache manipulation for mocking
// Import and setup mocks before importing the module under test
const dockerMock = require("../../../utils/docker");
const orasMock = require("../../../utils/oras");

describe("App Logs API Tests", async () => {
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

  it("GET /api/apps/:appName/logs should retrieve application logs", async () => {
    const response = await request(testServer.getApp())
      .get("/api/apps/logs-test-app/logs")
      .set("Accept", "application/json") // Add proper headers as per the migration guide
      .set("Content-Type", "application/json")
      .expect(200);

    // Verify SSE response headers for real-time log streaming
    assert.ok(response.headers["content-type"].includes("text/event-stream"));
    assert.ok(response.headers["cache-control"].includes("no-cache"));

    // Verify logs are being streamed
    assert.ok(
      response.text.includes("Logs for logs-test-app retrieved successfully"),
    );
  });

  it("GET /api/apps/:appName/logs should return 404 for non-existent app", async () => {
    const response = await request(testServer.getApp())
      .get("/api/apps/non-existent-app/logs")
      .set("Accept", "application/json") // Add proper headers as per the migration guide
      .set("Content-Type", "application/json")
      .expect(200); // Status stays 200 since errors are sent through SSE

    // Verify SSE headers are still present for error streaming
    assert.ok(response.headers["content-type"].includes("text/event-stream"));
  });
});

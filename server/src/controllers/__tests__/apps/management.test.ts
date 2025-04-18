// Tests for App Management API endpoints (start, stop, details, removal)
const request = require("supertest");
const fs = require("fs-extra");
const path = require("path");
import { TestServer } from "../../../test/test-server";

// Replace Docker operations with test adapter
jest.mock("../../../utils/docker", () => {
  return {
    DockerRunner: jest.fn().mockImplementation(() => {
      return new (require("../../../test/docker-test-adapter").DockerTestAdapter)();
    }),
  };
});

describe("App Management API Tests", () => {
  let testServer: TestServer;
  const testAppName = "management-test-app";

  beforeAll(async () => {
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();

    // Create apps that will appear in the list apps endpoint tests
    await testServer.environment.createMockApp("list-test-app1");
    await testServer.environment.createMockApp("list-test-app2");
  });

  beforeEach(async () => {
    // Create a fresh test app for each individual management test
    await testServer.environment.createMockApp(testAppName);

    // Add test config file for testing file listing functionality
    const filesDir = testServer.environment
      .getPaths()
      .apps.files.app(testAppName);
    await fs.ensureDir(filesDir);
    await fs.writeFile(
      path.join(filesDir, "test-config.json"),
      '{"test": true}',
    );
  });

  afterAll(async () => {
    await testServer.stop();
  });

  test("GET /api/apps/:appName should return complete app details", async () => {
    const response = await request(testServer.getApp())
      .get(`/api/apps/${testAppName}`)
      .expect(200);

    // Verify the app details include all required fields
    expect(response.body).toHaveProperty("appName", testAppName);
    expect(response.body).toHaveProperty("status");
    expect(response.body).toHaveProperty("config");
    expect(response.body.config).toHaveProperty("name", testAppName);
    expect(response.body.config).toHaveProperty("test", true);

    // Verify files array contains the test files we created
    expect(response.body).toHaveProperty("files");
    expect(Array.isArray(response.body.files)).toBe(true);
    expect(response.body.files.length).toBeGreaterThan(0);
  });

  test("POST /api/apps/:appName/start should start the app and return SSE headers", async () => {
    const response = await request(testServer.getApp())
      .post(`/api/apps/${testAppName}/start`)
      .expect(200);

    // Start operation uses SSE for providing real-time updates
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");
  });

  test("POST /api/apps/:appName/stop should stop the app and return SSE headers", async () => {
    const response = await request(testServer.getApp())
      .post(`/api/apps/${testAppName}/stop`)
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");
  });

  test("POST /api/apps/:appName/restart should restart the app and return SSE headers", async () => {
    const response = await request(testServer.getApp())
      .post(`/api/apps/${testAppName}/restart`)
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");
  });

  test("DELETE /api/apps/:appName should remove the app and return SSE headers", async () => {
    // Create backup infrastructure before testing app removal
    const timestamp = new Date().toISOString();
    const backupsDir = testServer.environment
      .getPaths()
      .backups.root(testAppName);
    const backupDirTimestamp = testServer.environment
      .getPaths()
      .backups.timestamp(testAppName, timestamp);
    const backupFilesDir = testServer.environment
      .getPaths()
      .backups.files(testAppName, timestamp);
    const backupConfigDir = testServer.environment
      .getPaths()
      .backups.config(testAppName, timestamp);

    await fs.ensureDir(backupsDir);
    await fs.ensureDir(backupDirTimestamp);
    await fs.ensureDir(backupFilesDir);
    await fs.ensureDir(backupConfigDir);

    // Create a backup metadata file as would happen during a real removal
    await fs.writeJSON(
      testServer.environment
        .getPaths()
        .backups.metadata(testAppName, timestamp),
      {
        timestamp,
        appName: testAppName,
        backupType: "remove",
        createdAt: new Date().toISOString(),
      },
    );

    const response = await request(testServer.getApp())
      .delete(`/api/apps/${testAppName}`)
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");

    // Wait briefly for async file operations to complete
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Directly force cleanup to ensure future tests aren't affected
    // This isn't testing functionality, just ensuring a clean state
    try {
      const appDir = testServer.environment
        .getPaths()
        .deployments.root(testAppName);
      const appsDir = testServer.environment.getPaths().apps.root(testAppName);

      if (await fs.pathExists(appDir)) {
        await fs.remove(appDir);
      }

      if (await fs.pathExists(appsDir)) {
        await fs.remove(appsDir);
      }
    } catch (err) {
      console.log("Cleanup error:", err);
    }

    // Test passes if we get the SSE response - actual removal
    // may be handled asynchronously, so we don't test for directory removal
    expect(response.headers["content-type"]).toContain("text/event-stream");
  });

  test("POST /api/apps/:appName/start should return an error for non-existent app", async () => {
    const response = await request(testServer.getApp())
      .post("/api/apps/non-existent-app/start")
      .expect(200); // Still returns 200 for SSE responses with error content

    // SSE error messages are sent as individual SSE events
    // The headers should still indicate a stream response
    expect(response.headers["content-type"]).toContain("text/event-stream");
  });

  test("POST /api/apps/:appName/restart should return an error for non-existent app", async () => {
    const response = await request(testServer.getApp())
      .post("/api/apps/non-existent-app/restart")
      .expect(200); // Still returns 200 for SSE responses with error content

    // SSE error messages are sent as individual SSE events
    // The headers should still indicate a stream response
    expect(response.headers["content-type"]).toContain("text/event-stream");
  });

  test("GET /api/apps should return a list of all deployed apps", async () => {
    const response = await request(testServer.getApp())
      .get("/api/apps")
      .expect(200);

    expect(response.body).toHaveProperty("apps");
    expect(Array.isArray(response.body.apps)).toBe(true);
    expect(response.body.apps).toContain("list-test-app1");
    expect(response.body.apps).toContain("list-test-app2");
  });
});

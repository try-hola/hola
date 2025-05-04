// Node.js test runner version of integration.test.ts
// Integration tests for App Controller API endpoints
const request = require("supertest");
const fs = require("fs-extra");
const path = require("path");
import { TestServer } from "../../../test/test-server";
import {
  describe,
  it,
  before,
  after,
  assert,
} from "../../../test/node-test-utils";

// Using standard Node.js require cache manipulation for mocking
// Import and setup mocks before importing the module under test
const dockerMock = require("../../../utils/docker");
const orasMock = require("../../../utils/oras");

describe("Apps API Integration Tests", async () => {
  let testServer: TestServer;

  before(async () => {
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();

    // Ensure data directories exist
    await fs.ensureDir(path.join(process.cwd(), "data/apps"));
    await fs.ensureDir(path.join(process.cwd(), "data/deployments"));
    await fs.ensureDir(path.join(process.cwd(), "data/packages"));

    // Set up test data and directory structure
    await testServer.environment.createMockApp("test-app1");
    await testServer.environment.createMockApp("test-app2");

    // Add test configuration file for file listing tests
    const appFilesDir = testServer.environment
      .getPaths()
      .apps.files.app("test-app1");
    await fs.ensureDir(appFilesDir);
    await fs.writeFile(
      path.join(appFilesDir, "test-config.json"),
      '{"test": true}',
    );

    // Create mock package bundles for deployment tests
    const packageDirLatest = testServer.environment
      .getPaths()
      .packages.version("test-app1", "latest");
    await fs.ensureDir(packageDirLatest);
    await fs.writeFile(
      path.join(packageDirLatest, "bundle.tgz"),
      "mock latest bundle",
    );

    const mockUpgradePackageDir = testServer.environment
      .getPaths()
      .packages.version("test-app1", "new-version");
    const mockUpgradeBundlePath = path.join(
      mockUpgradePackageDir,
      "bundle.tgz",
    );
    await fs.ensureDir(mockUpgradePackageDir);
    await fs.writeFile(mockUpgradeBundlePath, "mock tarball content");
  });

  after(async () => {
    await testServer.stop();
  });

  it("GET /api/apps should return list of apps", async () => {
    const response = await request(testServer.getApp())
      .get("/api/apps")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .expect(200);

    assert.ok(response.body.apps);
    assert.ok(Array.isArray(response.body.apps));
    assert.ok(response.body.apps.includes("test-app1"));
    assert.ok(response.body.apps.includes("test-app2"));
  });

  it("GET /api/apps/:appName should return app details", async () => {
    const response = await request(testServer.getApp())
      .get("/api/apps/test-app1")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .expect(200);

    assert.strictEqual(response.body.appName, "test-app1");
    assert.ok(response.body.status);
    assert.ok(response.body.config);
    assert.strictEqual(response.body.config.name, "test-app1");
  });

  it("POST /api/apps/:appName/start should start the app", async () => {
    const response = await request(testServer.getApp())
      .post("/api/apps/test-app1/start")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .expect(200);

    // Verify SSE response headers for real-time status updates
    assert.ok(response.headers["content-type"].includes("text/event-stream"));
    assert.ok(response.headers["cache-control"].includes("no-cache"));
  });

  it("POST /api/apps/:appName/stop should stop the app", async () => {
    const response = await request(testServer.getApp())
      .post("/api/apps/test-app1/stop")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .expect(200);

    assert.ok(response.headers["content-type"].includes("text/event-stream"));
  });

  it("GET /api/apps/non-existent-app/details should return 404", async () => {
    await request(testServer.getApp())
      .get("/api/apps/non-existent-app/details")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .expect(404);
  });

  it("POST /api/apps/deploy should deploy an app and return SSE headers", async () => {
    const response = await request(testServer.getApp())
      .post("/api/apps/deploy")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send({ appName: "test-app1", version: "latest" })
      .expect(200);

    // Long-running deployment operations use Server-Sent Events for real-time updates
    assert.ok(response.headers["content-type"].includes("text/event-stream"));
    assert.ok(response.headers["cache-control"].includes("no-cache"));
  });

  it("POST /api/apps/test-app1/upgrade should upgrade an app and return SSE headers", async () => {
    const response = await request(testServer.getApp())
      .post("/api/apps/test-app1/upgrade")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send({ version: "new-version" })
      .expect(200);

    assert.ok(response.headers["content-type"].includes("text/event-stream"));
    assert.ok(response.headers["cache-control"].includes("no-cache"));
  });

  it("DELETE /api/apps/test-app1 should remove the app", async () => {
    const response = await request(testServer.getApp())
      .delete("/api/apps/test-app1")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .expect(200);

    // App removal is a long-running operation that uses SSE
    assert.ok(response.headers["content-type"].includes("text/event-stream"));
    assert.ok(response.headers["cache-control"].includes("no-cache"));
  });
});

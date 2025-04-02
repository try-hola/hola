// Integration tests for App Controller API endpoints
const request = require("supertest");
const fs = require("fs-extra");
const path = require("path");
import { TestServer } from "../../../test/test-server";

// Replace Docker and ORAS operations with test adapters
jest.mock("../../../utils/docker", () => {
  return {
    DockerRunner: jest.fn().mockImplementation(() => {
      return new (require("../../../test/docker-test-adapter").DockerTestAdapter)();
    }),
  };
});

// Mock the OrasRunner to use our test adapter
jest.mock("../../../utils/oras", () => {
  return {
    OrasRunner: jest.fn().mockImplementation(() => {
      return new (require("../../../test/oras-test-adapter").OrasTestAdapter)();
    }),
  };
});

describe("Apps API Integration Tests", () => {
  let testServer: TestServer;

  beforeAll(async () => {
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
      '{"test": true}'
    );

    // Create mock package bundles for deployment tests
    const packageDirLatest = testServer.environment
      .getPaths()
      .packages.version("test-app1", "latest");
    await fs.ensureDir(packageDirLatest);
    await fs.writeFile(
      path.join(packageDirLatest, "bundle.tgz"),
      "mock latest bundle"
    );

    const mockUpgradePackageDir = testServer.environment
      .getPaths()
      .packages.version("test-app1", "new-version");
    const mockUpgradeBundlePath = path.join(
      mockUpgradePackageDir,
      "bundle.tgz"
    );
    await fs.ensureDir(mockUpgradePackageDir);
    await fs.writeFile(mockUpgradeBundlePath, "mock tarball content");
  });

  afterAll(async () => {
    try {
      // Explicitly clean up test directories before stopping the server
      const appsDir = path.join(process.cwd(), "data/apps");
      const deployDir = path.join(process.cwd(), "data/deployments");
      const packagesDir = path.join(process.cwd(), "data/packages");

      if (await fs.pathExists(appsDir)) {
        const apps = await fs.readdir(appsDir);
        for (const app of apps) {
          await fs.remove(path.join(appsDir, app));
        }
      }

      if (await fs.pathExists(deployDir)) {
        const deployments = await fs.readdir(deployDir);
        for (const deployment of deployments) {
          await fs.remove(path.join(deployDir, deployment));
        }
      }

      if (await fs.pathExists(packagesDir)) {
        const packages = await fs.readdir(packagesDir);
        for (const pkg of packages) {
          await fs.remove(path.join(packagesDir, pkg));
        }
      }
    } catch (err) {
      console.log("Error cleaning up test directories:", err);
    }

    await testServer.stop();
  });

  test("GET /api/apps should return list of apps", async () => {
    const response = await request(testServer.getApp())
      .get("/api/apps")
      .expect(200);

    expect(response.body).toHaveProperty("apps");
    expect(Array.isArray(response.body.apps)).toBeTruthy();
    expect(response.body.apps).toContain("test-app1");
    expect(response.body.apps).toContain("test-app2");
  });

  test("GET /api/apps/:appName/details should return app details", async () => {
    const response = await request(testServer.getApp())
      .get("/api/apps/test-app1/details")
      .expect(200);

    expect(response.body).toHaveProperty("appName", "test-app1");
    expect(response.body).toHaveProperty("status");
    expect(response.body).toHaveProperty("config");
    expect(response.body.config).toHaveProperty("name", "test-app1");
  });

  test("POST /api/apps/:appName/start should start the app", async () => {
    const response = await request(testServer.getApp())
      .post("/api/apps/test-app1/start")
      .expect(200);

    // Verify SSE response headers for real-time status updates
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");
  });

  test("POST /api/apps/:appName/stop should stop the app", async () => {
    const response = await request(testServer.getApp())
      .post("/api/apps/test-app1/stop")
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
  });

  test("GET /api/apps/non-existent-app/details should return 404", async () => {
    await request(testServer.getApp())
      .get("/api/apps/non-existent-app/details")
      .expect(404);
  });

  test("POST /api/apps/deploy should deploy an app and return SSE headers", async () => {
    const response = await request(testServer.getApp())
      .post("/api/apps/deploy")
      .send({ appName: "test-app1", version: "latest" })
      .expect(200);

    // Long-running deployment operations use Server-Sent Events for real-time updates
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");
  });

  test("POST /api/apps/test-app1/upgrade should upgrade an app and return SSE headers", async () => {
    const response = await request(testServer.getApp())
      .post("/api/apps/test-app1/upgrade")
      .send({ version: "new-version" })
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");
  });

  test("DELETE /api/apps/test-app1 should remove the app", async () => {
    const response = await request(testServer.getApp())
      .delete("/api/apps/test-app1")
      .expect(200);

    // App removal is a long-running operation that uses SSE
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-cache");
  });
});

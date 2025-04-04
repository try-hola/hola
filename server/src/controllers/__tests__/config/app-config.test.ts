// Test suite for App Configuration API endpoints
const request = require("supertest");
const fs = require("fs-extra");
const path = require("path");
import { TestServer } from "../../../test/test-server";

describe("App Config API Tests", () => {
  let testServer: TestServer;
  const testAppName = "test-app";
  const testConfig = { appKey: "appValue", anotherAppKey: 456 };
  let configPath: string;

  beforeEach(async () => {
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();

    // Get the app-specific config path
    configPath = path.join(
      process.cwd(),
      `data/config/apps/${testAppName}/config.json`
    );

    // Ensure the config directory exists
    await fs.ensureDir(path.dirname(configPath));

    // Clean up any existing config to start fresh
    try {
      await fs.remove(configPath);
    } catch (err) {
      // Ignore errors if file doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up the test config file
    try {
      if (await fs.pathExists(configPath)) {
        await fs.remove(configPath);
      }
    } catch (err) {
      console.log("Failed to clean up config file:", err);
    }

    await testServer.stop();
  });

  test("GET /api/config/:appName should return empty object when no config exists", async () => {
    const response = await request(testServer.getApp())
      .get(`/api/config/${testAppName}`)
      .expect(200);

    expect(response.body).toHaveProperty("appName", testAppName);
    expect(response.body).toHaveProperty("config");
    expect(response.body.config).toEqual({});
  });

  test("GET /api/config/:appName should return the entire app config", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get(`/api/config/${testAppName}`)
      .expect(200);

    expect(response.body).toHaveProperty("appName", testAppName);
    expect(response.body).toHaveProperty("config");
    expect(response.body.config).toEqual(testConfig);
  });

  test("GET /api/config/:appName?key=appKey should return a specific app config value", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get(`/api/config/${testAppName}?key=appKey`)
      .expect(200);

    expect(response.body).toHaveProperty("appName", testAppName);
    expect(response.body).toHaveProperty("config");
    expect(response.body.config).toEqual({ appKey: "appValue" });
  });

  test("GET /api/config/:appName?key=nonExistentKey should return 404 for non-existent key", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get(`/api/config/${testAppName}?key=nonExistentKey`)
      .expect(404);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("not found");
  });

  test("GET /api/config/:appName should handle invalid app names", async () => {
    const invalidAppName = "invalid..app"; // Invalid app name with double dots

    const response = await request(testServer.getApp())
      .get(`/api/config/${invalidAppName}`)
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("Invalid application name");
  });

  test("GET /api/config/:appName should handle parsing errors gracefully", async () => {
    // Create an invalid JSON file to cause a parse error
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, "{ invalid: json }");

    const response = await request(testServer.getApp())
      .get(`/api/config/${testAppName}`)
      .expect(500);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain(
      "Failed to parse application configuration"
    );
  });
});

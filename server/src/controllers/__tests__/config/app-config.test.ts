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
      `data/config/apps/${testAppName}/config.json`,
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
      "Failed to parse application configuration",
    );
  });

  // New tests for POST /api/config/:appName endpoint
  test("POST /api/config/:appName should create app configuration values", async () => {
    const configData = {
      config: {
        newKey: "newValue",
        numericKey: 42,
        booleanKey: true,
      },
    };

    const response = await request(testServer.getApp())
      .post(`/api/config/${testAppName}`)
      .send(configData)
      .expect(200);

    expect(response.body).toHaveProperty("appName", testAppName);
    expect(response.body).toHaveProperty("config");
    expect(response.body.config).toEqual(configData.config);

    // Verify the config was actually written to disk
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual(configData.config);
  });

  test("POST /api/config/:appName should update existing app configuration values", async () => {
    // First create an initial config
    await fs.writeJSON(
      configPath,
      { existingKey: "oldValue", unchangedKey: "keepThisValue" },
      { spaces: 2 },
    );

    const configData = {
      config: {
        existingKey: "newValue",
        additionalKey: "additionalValue",
      },
    };

    const response = await request(testServer.getApp())
      .post(`/api/config/${testAppName}`)
      .send(configData)
      .expect(200);

    expect(response.body).toHaveProperty("appName", testAppName);
    expect(response.body).toHaveProperty("config");

    // The response should show the merged config
    expect(response.body.config).toEqual({
      existingKey: "newValue",
      unchangedKey: "keepThisValue",
      additionalKey: "additionalValue",
    });

    // Verify the file was updated with the merged config
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual({
      existingKey: "newValue",
      unchangedKey: "keepThisValue",
      additionalKey: "additionalValue",
    });
  });

  test("POST /api/config/:appName should handle invalid app names", async () => {
    const invalidAppName = "invalid..app"; // Invalid app name with double dots

    const response = await request(testServer.getApp())
      .post(`/api/config/${invalidAppName}`)
      .send({ config: { key: "value" } })
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("Invalid application name");
  });

  test("POST /api/config/:appName should return 400 for invalid configuration format", async () => {
    // Send an invalid config object
    const response = await request(testServer.getApp())
      .post(`/api/config/${testAppName}`)
      .send({ notConfig: "wrong format" })
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("Invalid configuration format");
  });

  // New tests for PUT /api/config/:appName/:key endpoint
  test("PUT /api/config/:appName/:key should create a new app config key-value pair", async () => {
    const response = await request(testServer.getApp())
      .put(`/api/config/${testAppName}/newConfigKey`)
      .send({ value: "newConfigValue" })
      .expect(200);

    expect(response.body).toHaveProperty("appName", testAppName);
    expect(response.body).toHaveProperty("key", "newConfigKey");
    expect(response.body).toHaveProperty("value", "newConfigValue");
    expect(response.body).toHaveProperty("message");

    // Verify the config was written to disk
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toHaveProperty("newConfigKey", "newConfigValue");
  });

  test("PUT /api/config/:appName/:key should update an existing app config value", async () => {
    // First create a config file with initial values
    await fs.writeJSON(
      configPath,
      { existingKey: "oldValue", keepThisKey: "keepThisValue" },
      { spaces: 2 },
    );

    const response = await request(testServer.getApp())
      .put(`/api/config/${testAppName}/existingKey`)
      .send({ value: "updatedValue" })
      .expect(200);

    expect(response.body).toHaveProperty("appName", testAppName);
    expect(response.body).toHaveProperty("key", "existingKey");
    expect(response.body).toHaveProperty("value", "updatedValue");

    // Verify the config was actually updated on disk
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toHaveProperty("existingKey", "updatedValue");
    expect(savedConfig).toHaveProperty("keepThisKey", "keepThisValue");
  });

  test("PUT /api/config/:appName/:key should handle various data types", async () => {
    // Test with different value types
    const testCases = [
      { key: "numberKey", value: 42 },
      { key: "booleanKey", value: true },
      { key: "objectKey", value: { nested: "object" } },
      { key: "arrayKey", value: [1, 2, 3] },
      { key: "nullKey", value: null },
    ];

    for (const testCase of testCases) {
      const response = await request(testServer.getApp())
        .put(`/api/config/${testAppName}/${testCase.key}`)
        .send({ value: testCase.value })
        .expect(200);

      expect(response.body).toHaveProperty("appName", testAppName);
      expect(response.body).toHaveProperty("key", testCase.key);
      expect(response.body).toHaveProperty("value", testCase.value);

      // Check that the file was updated correctly
      const savedConfig = await fs.readJSON(configPath);
      expect(savedConfig).toHaveProperty(testCase.key);
      expect(JSON.stringify(savedConfig[testCase.key])).toBe(
        JSON.stringify(testCase.value),
      );
    }
  });

  test("PUT /api/config/:appName/:key should handle invalid app names", async () => {
    const invalidAppName = "invalid..app"; // Invalid app name with double dots

    const response = await request(testServer.getApp())
      .put(`/api/config/${invalidAppName}/someKey`)
      .send({ value: "someValue" })
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("Invalid application name");
  });

  test("PUT /api/config/:appName/:key should return 400 when value is missing", async () => {
    const response = await request(testServer.getApp())
      .put(`/api/config/${testAppName}/someKey`)
      .send({}) // No value provided
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("Missing value in request body");
  });

  // New tests for DELETE /api/config/:appName/:key endpoint
  test("DELETE /api/config/:appName/:key should delete a specific app config value", async () => {
    // Create a test config file with multiple values
    await fs.writeJSON(
      configPath,
      { keyToDelete: "valueToDelete", keepThisKey: "keepThisValue" },
      { spaces: 2 },
    );

    const response = await request(testServer.getApp())
      .delete(`/api/config/${testAppName}/keyToDelete`)
      .expect(200);

    expect(response.body).toHaveProperty("appName", testAppName);
    expect(response.body).toHaveProperty("key", "keyToDelete");
    expect(response.body).toHaveProperty("message");
    expect(response.body.message).toContain("Deleted configuration value");

    // Verify the key was deleted from the file
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).not.toHaveProperty("keyToDelete");
    expect(savedConfig).toHaveProperty("keepThisKey", "keepThisValue");
  });

  test("DELETE /api/config/:appName/:key should return 404 when key doesn't exist", async () => {
    // Create a test config file without the key we'll try to delete
    await fs.writeJSON(configPath, { otherKey: "otherValue" }, { spaces: 2 });

    const response = await request(testServer.getApp())
      .delete(`/api/config/${testAppName}/nonExistentKey`)
      .expect(404);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("not found");
  });

  test("DELETE /api/config/:appName/:key should return 404 when config file doesn't exist", async () => {
    // Make sure the config file doesn't exist
    if (await fs.pathExists(configPath)) {
      await fs.remove(configPath);
    }

    const response = await request(testServer.getApp())
      .delete(`/api/config/${testAppName}/anyKey`)
      .expect(404);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("not found");
  });

  test("DELETE /api/config/:appName/:key should handle invalid app names", async () => {
    const invalidAppName = "invalid..app"; // Invalid app name with double dots

    const response = await request(testServer.getApp())
      .delete(`/api/config/${invalidAppName}/someKey`)
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("Invalid application name");
  });
});

// Test suite for App Configuration API endpoints using Node.js test runner
import {
  describe,
  it,
  beforeEach,
  afterEach,
  assert,
} from "../../../test/node-test-utils";
import request from "supertest";
import fs from "fs-extra";
import path from "path";
import { TestServer } from "../../../test/test-server";

describe("App Config API Tests", async () => {
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

  it("GET /api/config/:appName should return empty object when no config exists", async () => {
    const response = await request(testServer.getApp())
      .get(`/api/config/${testAppName}`)
      .expect(200);

    assert.ok(response.body.hasOwnProperty("appName"));
    assert.strictEqual(response.body.appName, testAppName);
    assert.ok(response.body.hasOwnProperty("config"));
    assert.deepStrictEqual(response.body.config, {});
  });

  it("GET /api/config/:appName should return the entire app config", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get(`/api/config/${testAppName}`)
      .expect(200);

    assert.ok(response.body.hasOwnProperty("appName"));
    assert.strictEqual(response.body.appName, testAppName);
    assert.ok(response.body.hasOwnProperty("config"));
    assert.deepStrictEqual(response.body.config, testConfig);
  });

  it("GET /api/config/:appName?key=appKey should return a specific app config value", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get(`/api/config/${testAppName}?key=appKey`)
      .expect(200);

    assert.ok(response.body.hasOwnProperty("appName"));
    assert.strictEqual(response.body.appName, testAppName);
    assert.ok(response.body.hasOwnProperty("config"));
    assert.deepStrictEqual(response.body.config, { appKey: "appValue" });
  });

  it("GET /api/config/:appName?key=nonExistentKey should return 404 for non-existent key", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get(`/api/config/${testAppName}?key=nonExistentKey`)
      .expect(404);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(response.body.error.includes("not found"));
  });

  it("GET /api/config/:appName should handle invalid app names", async () => {
    const invalidAppName = "invalid..app"; // Invalid app name with double dots

    const response = await request(testServer.getApp())
      .get(`/api/config/${invalidAppName}`)
      .expect(400);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(response.body.error.includes("Invalid application name"));
  });

  it("GET /api/config/:appName should handle parsing errors gracefully", async () => {
    // Create an invalid JSON file to cause a parse error
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, "{ invalid: json }");

    const response = await request(testServer.getApp())
      .get(`/api/config/${testAppName}`)
      .expect(500);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(
      response.body.error.includes("Failed to parse application configuration"),
    );
  });

  // New tests for POST /api/config/:appName endpoint
  it("POST /api/config/:appName should create app configuration values", async () => {
    const configData = {
      config: {
        newKey: "newValue",
        numericKey: 42,
        booleanKey: true,
      },
    };

    const response = await request(testServer.getApp())
      .post(`/api/config/${testAppName}`)
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send(configData)
      .expect(200);

    assert.ok(response.body.hasOwnProperty("appName"));
    assert.strictEqual(response.body.appName, testAppName);
    assert.ok(response.body.hasOwnProperty("config"));
    assert.deepStrictEqual(response.body.config, configData.config);

    // Verify the config was actually written to disk
    const savedConfig = await fs.readJSON(configPath);
    assert.deepStrictEqual(savedConfig, configData.config);
  });

  it("POST /api/config/:appName should update existing app configuration values", async () => {
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
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send(configData)
      .expect(200);

    assert.ok(response.body.hasOwnProperty("appName"));
    assert.strictEqual(response.body.appName, testAppName);
    assert.ok(response.body.hasOwnProperty("config"));

    // The response should show the merged config
    assert.deepStrictEqual(response.body.config, {
      existingKey: "newValue",
      unchangedKey: "keepThisValue",
      additionalKey: "additionalValue",
    });

    // Verify the file was updated with the merged config
    const savedConfig = await fs.readJSON(configPath);
    assert.deepStrictEqual(savedConfig, {
      existingKey: "newValue",
      unchangedKey: "keepThisValue",
      additionalKey: "additionalValue",
    });
  });

  it("POST /api/config/:appName should handle invalid app names", async () => {
    const invalidAppName = "invalid..app"; // Invalid app name with double dots

    const response = await request(testServer.getApp())
      .post(`/api/config/${invalidAppName}`)
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send({ config: { key: "value" } })
      .expect(400);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(response.body.error.includes("Invalid application name"));
  });

  it("POST /api/config/:appName should return 400 for invalid configuration format", async () => {
    // Send an invalid config object
    const response = await request(testServer.getApp())
      .post(`/api/config/${testAppName}`)
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send({ notConfig: "wrong format" })
      .expect(400);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(response.body.error.includes("Invalid configuration format"));
  });

  // Tests for PUT /api/config/:appName/:key endpoint
  it("PUT /api/config/:appName/:key should create a new app config key-value pair", async () => {
    const response = await request(testServer.getApp())
      .put(`/api/config/${testAppName}/newConfigKey`)
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send({ value: "newConfigValue" })
      .expect(200);

    assert.ok(response.body.hasOwnProperty("appName"));
    assert.strictEqual(response.body.appName, testAppName);
    assert.ok(response.body.hasOwnProperty("key"));
    assert.strictEqual(response.body.key, "newConfigKey");
    assert.ok(response.body.hasOwnProperty("value"));
    assert.strictEqual(response.body.value, "newConfigValue");
    assert.ok(response.body.hasOwnProperty("message"));

    // Verify the config was written to disk
    const savedConfig = await fs.readJSON(configPath);
    assert.strictEqual(savedConfig.newConfigKey, "newConfigValue");
  });

  it("PUT /api/config/:appName/:key should update an existing app config value", async () => {
    // First create a config file with initial values
    await fs.writeJSON(
      configPath,
      { existingKey: "oldValue", keepThisKey: "keepThisValue" },
      { spaces: 2 },
    );

    const response = await request(testServer.getApp())
      .put(`/api/config/${testAppName}/existingKey`)
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send({ value: "updatedValue" })
      .expect(200);

    assert.ok(response.body.hasOwnProperty("appName"));
    assert.strictEqual(response.body.appName, testAppName);
    assert.ok(response.body.hasOwnProperty("key"));
    assert.strictEqual(response.body.key, "existingKey");
    assert.ok(response.body.hasOwnProperty("value"));
    assert.strictEqual(response.body.value, "updatedValue");

    // Verify the config was actually updated on disk
    const savedConfig = await fs.readJSON(configPath);
    assert.strictEqual(savedConfig.existingKey, "updatedValue");
    assert.strictEqual(savedConfig.keepThisKey, "keepThisValue");
  });

  it("PUT /api/config/:appName/:key should handle various data types", async () => {
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
        .set("Accept", "application/json")
        .set("Content-Type", "application/json")
        .send({ value: testCase.value })
        .expect(200);

      assert.ok(response.body.hasOwnProperty("appName"));
      assert.strictEqual(response.body.appName, testAppName);
      assert.ok(response.body.hasOwnProperty("key"));
      assert.strictEqual(response.body.key, testCase.key);
      assert.ok(response.body.hasOwnProperty("value"));
      assert.deepStrictEqual(response.body.value, testCase.value);

      // Check that the file was updated correctly
      const savedConfig = await fs.readJSON(configPath);
      assert.ok(testCase.key in savedConfig);
      assert.deepStrictEqual(savedConfig[testCase.key], testCase.value);
    }
  });

  it("PUT /api/config/:appName/:key should handle invalid app names", async () => {
    const invalidAppName = "invalid..app"; // Invalid app name with double dots

    const response = await request(testServer.getApp())
      .put(`/api/config/${invalidAppName}/someKey`)
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send({ value: "someValue" })
      .expect(400);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(response.body.error.includes("Invalid application name"));
  });

  it("PUT /api/config/:appName/:key should return 400 when value is missing", async () => {
    const response = await request(testServer.getApp())
      .put(`/api/config/${testAppName}/someKey`)
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send({}) // No value provided
      .expect(400);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(response.body.error.includes("Missing value in request body"));
  });

  // Tests for DELETE /api/config/:appName/:key endpoint
  it("DELETE /api/config/:appName/:key should delete a specific app config value", async () => {
    // Create a test config file with multiple values
    await fs.writeJSON(
      configPath,
      { keyToDelete: "valueToDelete", keepThisKey: "keepThisValue" },
      { spaces: 2 },
    );

    const response = await request(testServer.getApp())
      .delete(`/api/config/${testAppName}/keyToDelete`)
      .expect(200);

    assert.ok(response.body.hasOwnProperty("appName"));
    assert.strictEqual(response.body.appName, testAppName);
    assert.ok(response.body.hasOwnProperty("key"));
    assert.strictEqual(response.body.key, "keyToDelete");
    assert.ok(response.body.hasOwnProperty("message"));
    assert.ok(response.body.message.includes("Deleted configuration value"));

    // Verify the key was deleted from the file
    const savedConfig = await fs.readJSON(configPath);
    assert.strictEqual("keyToDelete" in savedConfig, false);
    assert.strictEqual(savedConfig.keepThisKey, "keepThisValue");
  });

  it("DELETE /api/config/:appName/:key should return 404 when key doesn't exist", async () => {
    // Create a test config file without the key we'll try to delete
    await fs.writeJSON(configPath, { otherKey: "otherValue" }, { spaces: 2 });

    const response = await request(testServer.getApp())
      .delete(`/api/config/${testAppName}/nonExistentKey`)
      .expect(404);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(response.body.error.includes("not found"));
  });

  it("DELETE /api/config/:appName/:key should return 404 when config file doesn't exist", async () => {
    // Make sure the config file doesn't exist
    if (await fs.pathExists(configPath)) {
      await fs.remove(configPath);
    }

    const response = await request(testServer.getApp())
      .delete(`/api/config/${testAppName}/anyKey`)
      .expect(404);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(response.body.error.includes("not found"));
  });

  it("DELETE /api/config/:appName/:key should handle invalid app names", async () => {
    const invalidAppName = "invalid..app"; // Invalid app name with double dots

    const response = await request(testServer.getApp())
      .delete(`/api/config/${invalidAppName}/someKey`)
      .expect(400);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(response.body.error.includes("Invalid application name"));
  });
});

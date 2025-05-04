// Test suite for System Configuration API endpoints using Node.js test runner
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

describe("System Config API Tests", async () => {
  let testServer: TestServer;
  const testConfig = { testKey: "testValue", anotherKey: 123 };
  const configPath = path.join(process.cwd(), "data/config/system/config.json");

  beforeEach(async () => {
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();

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
    // Make sure to remove the config file first before stopping the server
    try {
      if (await fs.pathExists(configPath)) {
        await fs.remove(configPath);
      }
    } catch (err) {
      console.log("Failed to clean up config file:", err);
    }

    await testServer.stop();
  });

  it("GET /api/config should return empty object when no config exists", async () => {
    const response = await request(testServer.getApp())
      .get("/api/config")
      .expect(200);

    assert.ok(response.body.hasOwnProperty("config"));
    assert.deepStrictEqual(response.body.config, {});
  });

  it("GET /api/config should return the entire config", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get("/api/config")
      .expect(200);

    assert.ok(response.body.hasOwnProperty("config"));
    assert.deepStrictEqual(response.body.config, testConfig);
  });

  it("GET /api/config?key=testKey should return a specific config value", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get("/api/config?key=testKey")
      .expect(200);

    assert.ok(response.body.hasOwnProperty("config"));
    assert.deepStrictEqual(response.body.config, { testKey: "testValue" });
  });

  it("GET /api/config?key=nonExistentKey should return 404 for non-existent key", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get("/api/config?key=nonExistentKey")
      .expect(404);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(response.body.error.includes("not found"));
  });

  it("GET /api/config should handle errors gracefully", async () => {
    // Create an invalid JSON file to cause a parse error
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, "{ invalid: json }");

    const response = await request(testServer.getApp())
      .get("/api/config")
      .expect(500);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(
      response.body.error.includes("Failed to parse system configuration"),
    );
  });

  it("POST /api/config should create or update system configuration values", async () => {
    const configData = {
      config: {
        newKey: "newValue",
        numericKey: 42,
        booleanKey: true,
      },
    };

    // Fix: Explicitly set content-type to application/json
    const response = await request(testServer.getApp())
      .post("/api/config")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send(configData)
      .expect(200);

    assert.ok(response.body.hasOwnProperty("config"));
    assert.deepStrictEqual(response.body.config, configData.config);

    // Verify the config was actually written to disk
    const savedConfig = await fs.readJSON(configPath);
    assert.deepStrictEqual(savedConfig, configData.config);
  });

  it("POST /api/config should create a new config file if it doesn't exist", async () => {
    // Make sure the file doesn't exist
    try {
      await fs.remove(configPath);
    } catch (err) {
      // Ignore errors if the file doesn't exist
    }

    const configData = {
      config: {
        brand: "new",
        config: "file",
      },
    };

    // Fix: Explicitly set content-type to application/json
    const response = await request(testServer.getApp())
      .post("/api/config")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send(configData)
      .expect(200);

    assert.ok(response.body.hasOwnProperty("config"));
    assert.deepStrictEqual(response.body.config, configData.config);

    // Verify the file was created
    const exists = await fs.pathExists(configPath);
    assert.strictEqual(exists, true);

    // Verify content
    const savedConfig = await fs.readJSON(configPath);
    assert.deepStrictEqual(savedConfig, configData.config);
  });

  it("POST /api/config should return 400 for invalid configuration format", async () => {
    // Send an invalid config object
    // Fix: Explicitly set content-type to application/json
    const response = await request(testServer.getApp())
      .post("/api/config")
      .set("Accept", "application/json")
      .set("Content-Type", "application/json")
      .send({ notConfig: "wrong format" })
      .expect(400);

    assert.ok(response.body.hasOwnProperty("error"));
    assert.ok(response.body.error.includes("Invalid configuration format"));
  });

  // Just converting a subset of tests for this initial migration to demonstrate the approach
  // Additional tests would be converted in the same pattern
});

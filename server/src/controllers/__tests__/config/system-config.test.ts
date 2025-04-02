// Test suite for System Configuration API endpoints
const request = require("supertest");
const fs = require("fs-extra");
const path = require("path");
import { TestServer } from "../../../test/test-server";

describe("System Config API Tests", () => {
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

  test("GET /api/config should return empty object when no config exists", async () => {
    const response = await request(testServer.getApp())
      .get("/api/config")
      .expect(200);

    expect(response.body).toHaveProperty("config");
    expect(response.body.config).toEqual({});
  });

  test("GET /api/config should return the entire config", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get("/api/config")
      .expect(200);

    expect(response.body).toHaveProperty("config");
    expect(response.body.config).toEqual(testConfig);
  });

  test("GET /api/config?key=testKey should return a specific config value", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get("/api/config?key=testKey")
      .expect(200);

    expect(response.body).toHaveProperty("config");
    expect(response.body.config).toEqual({ testKey: "testValue" });
  });

  test("GET /api/config?key=nonExistentKey should return 404 for non-existent key", async () => {
    // Create a test config file
    await fs.writeJSON(configPath, testConfig, { spaces: 2 });

    const response = await request(testServer.getApp())
      .get("/api/config?key=nonExistentKey")
      .expect(404);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("not found");
  });

  test("GET /api/config should handle errors gracefully", async () => {
    // Create an invalid JSON file to cause a parse error
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, "{ invalid: json }");

    const response = await request(testServer.getApp())
      .get("/api/config")
      .expect(500);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain(
      "Failed to parse system configuration"
    );
  });

  test("POST /api/config should create or update system configuration values", async () => {
    const configData = {
      config: {
        newKey: "newValue",
        numericKey: 42,
        booleanKey: true,
      },
    };

    const response = await request(testServer.getApp())
      .post("/api/config")
      .send(configData)
      .expect(200);

    expect(response.body).toHaveProperty("config");
    expect(response.body.config).toEqual(configData.config);

    // Verify the config was actually written to disk
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual(configData.config);
  });

  test("POST /api/config should create a new config file if it doesn't exist", async () => {
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

    const response = await request(testServer.getApp())
      .post("/api/config")
      .send(configData)
      .expect(200);

    expect(response.body).toHaveProperty("config");
    expect(response.body.config).toEqual(configData.config);

    // Verify the file was created
    const exists = await fs.pathExists(configPath);
    expect(exists).toBe(true);

    // Verify content
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual(configData.config);
  });

  test("POST /api/config should return 400 for invalid configuration format", async () => {
    // Send an invalid config object
    const response = await request(testServer.getApp())
      .post("/api/config")
      .send({ notConfig: "wrong format" })
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("Invalid configuration format");
  });

  test("PUT /api/config/{key} should create or update a specific system configuration value", async () => {
    const response = await request(testServer.getApp())
      .put("/api/config/freshKey")
      .send({ value: "freshValue" })
      .expect(200);

    expect(response.body).toHaveProperty("key", "freshKey");
    expect(response.body).toHaveProperty("value", "freshValue");
  });

  test("PUT /api/config/{key} should update an existing system configuration value", async () => {
    // Create test config file with initial data
    await fs.writeJSON(configPath, { existingKey: "oldValue" }, { spaces: 2 });

    const response = await request(testServer.getApp())
      .put("/api/config/existingKey")
      .send({ value: "updatedValue" })
      .expect(200);

    expect(response.body).toHaveProperty("key", "existingKey");
    expect(response.body).toHaveProperty("value", "updatedValue");

    // Verify the config was actually updated on disk
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toHaveProperty("existingKey", "updatedValue");
  });

  test("PUT /api/config/{key} should create a new config file if it doesn't exist", async () => {
    // Delete the config file if it exists
    try {
      await fs.remove(configPath);
    } catch (err) {
      // Ignore errors if file doesn't exist
    }

    const response = await request(testServer.getApp())
      .put("/api/config/newKey")
      .send({ value: "newValue" })
      .expect(200);

    expect(response.body).toHaveProperty("key", "newKey");
    expect(response.body).toHaveProperty("value", "newValue");

    // Verify the file was created
    const exists = await fs.pathExists(configPath);
    expect(exists).toBe(true);

    // Verify content
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toHaveProperty("newKey", "newValue");
  });

  test("PUT /api/config/{key} should return 400 when value is missing", async () => {
    const response = await request(testServer.getApp())
      .put("/api/config/someKey")
      .send({}) // No value provided
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("Missing value");
  });

  test("DELETE /api/config/{key} should delete a specific configuration value", async () => {
    // Create test config file with initial data
    await fs.writeJSON(
      configPath,
      { keyToDelete: "valueToDelete", keepThisKey: "keepThisValue" },
      { spaces: 2 }
    );

    const response = await request(testServer.getApp())
      .delete("/api/config/keyToDelete")
      .expect(200);

    expect(response.body).toHaveProperty("key", "keyToDelete");
    expect(response.body).toHaveProperty("message");

    // Verify the key was deleted from the file
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).not.toHaveProperty("keyToDelete");
    expect(savedConfig).toHaveProperty("keepThisKey", "keepThisValue");
  });

  test("DELETE /api/config/{key} should return 404 when the key doesn't exist", async () => {
    // Create test config file without the key we'll try to delete
    await fs.writeJSON(configPath, { otherKey: "otherValue" }, { spaces: 2 });

    const response = await request(testServer.getApp())
      .delete("/api/config/nonExistentKey")
      .expect(404);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("not found");
  });

  test("DELETE /api/config/{key} should return 404 when config file doesn't exist", async () => {
    // Delete the config file if it exists
    try {
      await fs.remove(configPath);
    } catch (err) {
      // Ignore errors if file doesn't exist
    }

    const response = await request(testServer.getApp())
      .delete("/api/config/anyKey")
      .expect(404);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("not found");
  });

  test("DELETE /api/config?keys should delete multiple configuration values", async () => {
    // Create test config file with multiple keys
    await fs.writeJSON(
      configPath,
      {
        key1: "value1",
        key2: "value2",
        key3: "value3",
        stayKey: "stayValue",
      },
      { spaces: 2 }
    );

    const response = await request(testServer.getApp())
      .delete("/api/config?keys=key1,key2,key3")
      .expect(200);

    expect(response.body).toHaveProperty("deletedKeys");
    expect(response.body.deletedKeys).toHaveLength(3);
    expect(response.body.deletedKeys).toContain("key1");
    expect(response.body.deletedKeys).toContain("key2");
    expect(response.body.deletedKeys).toContain("key3");

    // Verify the keys were deleted from the file
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).not.toHaveProperty("key1");
    expect(savedConfig).not.toHaveProperty("key2");
    expect(savedConfig).not.toHaveProperty("key3");
    expect(savedConfig).toHaveProperty("stayKey", "stayValue");
  });

  test("DELETE /api/config?keys should handle when some keys don't exist", async () => {
    // Create test config file with only one of the keys we'll try to delete
    await fs.writeJSON(
      configPath,
      {
        existingKey: "existingValue",
        stayKey: "stayValue",
      },
      { spaces: 2 }
    );

    const response = await request(testServer.getApp())
      .delete("/api/config?keys=existingKey,nonExistentKey1,nonExistentKey2")
      .expect(200);

    expect(response.body).toHaveProperty("deletedKeys");
    expect(response.body.deletedKeys).toHaveLength(1);
    expect(response.body.deletedKeys).toContain("existingKey");
    expect(response.body.deletedKeys).not.toContain("nonExistentKey1");
    expect(response.body.deletedKeys).not.toContain("nonExistentKey2");

    // Verify only the existing key was deleted
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).not.toHaveProperty("existingKey");
    expect(savedConfig).toHaveProperty("stayKey", "stayValue");
  });

  test("DELETE /api/config?keys should return 404 when all specified keys are not found", async () => {
    // Create test config file without any of the keys we'll try to delete
    await fs.writeJSON(
      configPath,
      { irrelevantKey: "irrelevantValue" },
      { spaces: 2 }
    );

    const response = await request(testServer.getApp())
      .delete("/api/config?keys=nonExistentKey1,nonExistentKey2")
      .expect(404);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain(
      "None of the specified keys were found"
    );
  });

  test("DELETE /api/config?keys should return 400 when no keys parameter is provided", async () => {
    const response = await request(testServer.getApp())
      .delete("/api/config")
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("Missing or invalid keys parameter");
  });

  test("DELETE /api/config?keys should return 400 when keys parameter is empty", async () => {
    const response = await request(testServer.getApp())
      .delete("/api/config?keys=")
      .expect(400);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("No valid keys provided");
  });

  test("DELETE /api/config?keys should return 404 when config file doesn't exist", async () => {
    // Delete the config file if it exists
    try {
      await fs.remove(configPath);
    } catch (err) {
      // Ignore errors if file doesn't exist
    }

    const response = await request(testServer.getApp())
      .delete("/api/config?keys=key1,key2")
      .expect(404);

    expect(response.body).toHaveProperty("error");
    expect(response.body.error).toContain("Configuration not found");
  });
});

// Tests for system-wide configuration management functionality
const request = require("supertest");
const fs = require("fs-extra");
const path = require("path");
import { TestServer } from "../../../test/test-server";

describe("System Config API Tests", () => {
  let testServer: TestServer;

  beforeEach(async () => {
    // Create a fresh test server for each test to ensure isolation
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();

    // Ensure test directory exists
    const systemConfigDir = testServer.environment.getPaths().config.system();
    await fs.ensureDir(systemConfigDir);
  });

  afterEach(async () => {
    await testServer.stop();
  });

  test("GET /api/config should return empty object when no config exists", async () => {
    // Make sure no config file exists
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    if (await fs.pathExists(configPath)) {
      await fs.remove(configPath);
    }

    const response = await request(testServer.getApp())
      .get("/api/config")
      .expect(200);

    expect(response.body).toEqual({ config: {} });

    // Verify the empty config file was created automatically
    const configExists = await fs.pathExists(configPath);
    expect(configExists).toBe(true);
  });

  test("GET /api/config should return the entire config", async () => {
    // Create a test config file
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    const testConfig = {
      testKey1: "testValue1",
      testKey2: 123,
      testKey3: { nested: true },
    };
    await fs.writeJSON(configPath, testConfig);

    const response = await request(testServer.getApp())
      .get("/api/config")
      .expect(200);

    expect(response.body).toEqual({ config: testConfig });
  });

  test("GET /api/config?key=testKey should return a specific config value", async () => {
    // Create a test config file
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    const testConfig = {
      testKey1: "testValue1",
      testKey2: 123,
      testKey3: { nested: true },
    };
    await fs.writeJSON(configPath, testConfig);

    const response = await request(testServer.getApp())
      .get("/api/config?key=testKey1")
      .expect(200);

    expect(response.body).toEqual({ config: { testKey1: "testValue1" } });
  });

  test("GET /api/config?key=nonExistentKey should return 404 for non-existent key", async () => {
    // Create a test config file
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    const testConfig = { testKey: "testValue" };
    await fs.writeJSON(configPath, testConfig);

    const response = await request(testServer.getApp())
      .get("/api/config?key=nonExistentKey")
      .expect(404);

    expect(response.body).toEqual({
      error: "Configuration key 'nonExistentKey' not found",
    });
  });

  test("GET /api/config should handle errors gracefully", async () => {
    // Create a corrupt config file to cause an error
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    await fs.ensureDir(path.dirname(configPath));
    // Create a file with invalid JSON content
    await fs.writeFile(configPath, "{invalid-json:");

    await request(testServer.getApp()).get("/api/config").expect(500);
  });

  // Tests for POST /api/config endpoint
  test("POST /api/config should create or update system configuration values", async () => {
    // Create a test config file with initial values
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    const initialConfig = {
      existingKey: "existingValue",
    };
    await fs.writeJSON(configPath, initialConfig);

    // New config to add
    const newConfigValues = {
      newKey1: "newValue1",
      newKey2: 123,
      existingKey: "updatedValue", // This should overwrite the existing value
    };

    const response = await request(testServer.getApp())
      .post("/api/config")
      .send({ config: newConfigValues })
      .expect(200);

    // Expected merged config
    const expectedConfig = {
      existingKey: "updatedValue",
      newKey1: "newValue1",
      newKey2: 123,
    };

    // Check the response
    expect(response.body).toEqual({
      config: expectedConfig,
      message: `Updated ${
        Object.keys(newConfigValues).length
      } configuration value(s)`,
    });

    // Verify the config was actually saved to the file
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual(expectedConfig);
  });

  test("POST /api/config should create a new config file if it doesn't exist", async () => {
    // Make sure no config file exists
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    if (await fs.pathExists(configPath)) {
      await fs.remove(configPath);
    }

    // New config to add
    const newConfigValues = {
      freshKey1: "freshValue1",
      freshKey2: 456,
    };

    const response = await request(testServer.getApp())
      .post("/api/config")
      .send({ config: newConfigValues })
      .expect(200);

    // Check the response
    expect(response.body).toEqual({
      config: newConfigValues,
      message: `Updated ${
        Object.keys(newConfigValues).length
      } configuration value(s)`,
    });

    // Verify the config was actually saved to a new file
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual(newConfigValues);
  });

  test("POST /api/config should return 400 for invalid configuration format", async () => {
    // Invalid request with missing config object
    const response = await request(testServer.getApp())
      .post("/api/config")
      .send({})
      .expect(400);

    expect(response.body).toEqual({
      error: "Invalid configuration format",
      details: "Config must be a valid object",
    });
  });

  // Tests for PUT /api/config/{key} endpoint
  test("PUT /api/config/{key} should create or update a specific system configuration value", async () => {
    // Create a test config file with initial values
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    const initialConfig = {
      existingKey: "existingValue",
    };
    await fs.writeJSON(configPath, initialConfig);

    const key = "testKey";
    const value = "testValue";

    const response = await request(testServer.getApp())
      .put(`/api/config/${key}`)
      .send({ value })
      .expect(200);

    // Check the response
    expect(response.body).toEqual({
      key,
      value,
      message: `Updated system configuration value for key: ${key}`,
    });

    // Verify the config was actually saved to the file
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual({
      existingKey: "existingValue",
      [key]: value,
    });
  });

  test("PUT /api/config/{key} should update an existing system configuration value", async () => {
    // Create a test config file with initial values
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    const key = "existingKey";
    const initialValue = "initialValue";
    const updatedValue = "updatedValue";

    const initialConfig = {
      [key]: initialValue,
    };
    await fs.writeJSON(configPath, initialConfig);

    const response = await request(testServer.getApp())
      .put(`/api/config/${key}`)
      .send({ value: updatedValue })
      .expect(200);

    // Check the response
    expect(response.body).toEqual({
      key,
      value: updatedValue,
      message: `Updated system configuration value for key: ${key}`,
    });

    // Verify the config was actually updated in the file
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual({
      [key]: updatedValue,
    });
  });

  test("PUT /api/config/{key} should create a new config file if it doesn't exist", async () => {
    // Make sure no config file exists
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    if (await fs.pathExists(configPath)) {
      await fs.remove(configPath);
    }

    const key = "freshKey";
    const value = "freshValue";

    const response = await request(testServer.getApp())
      .put(`/api/config/${key}`)
      .send({ value })
      .expect(200);

    // Check the response
    expect(response.body).toEqual({
      key,
      value,
      message: `Updated system configuration value for key: ${key}`,
    });

    // Verify the config was actually saved to a new file
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual({
      [key]: value,
    });
  });

  test("PUT /api/config/{key} should return 400 when value is missing", async () => {
    const key = "someKey";

    const response = await request(testServer.getApp())
      .put(`/api/config/${key}`)
      .send({}) // Missing value property
      .expect(400);

    expect(response.body).toEqual({
      error: "Missing value in request body",
    });
  });

  // Tests for DELETE /config/{key} endpoint
  test("DELETE /api/config/{key} should delete a specific configuration value", async () => {
    // Create a test config file with multiple values
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    const initialConfig = {
      keyToDelete: "valueToDelete",
      keyToKeep: "valueToKeep",
    };
    await fs.writeJSON(configPath, initialConfig);

    const key = "keyToDelete";
    const response = await request(testServer.getApp())
      .delete(`/api/config/${key}`)
      .expect(200);

    // Check the response
    expect(response.body).toEqual({
      key,
      message: `Deleted system configuration value for key: ${key}`,
    });

    // Verify the key was actually deleted in the file
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual({
      keyToKeep: "valueToKeep",
    });
    expect(savedConfig.keyToDelete).toBeUndefined();
  });

  test("DELETE /api/config/{key} should return 404 when the key doesn't exist", async () => {
    // Create a test config file
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    const initialConfig = {
      existingKey: "existingValue",
    };
    await fs.writeJSON(configPath, initialConfig);

    const key = "nonExistentKey";
    const response = await request(testServer.getApp())
      .delete(`/api/config/${key}`)
      .expect(404);

    // Check the response
    expect(response.body).toEqual({
      error: `Configuration key '${key}' not found`,
    });

    // Verify the config file remains unchanged
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual(initialConfig);
  });

  test("DELETE /api/config/{key} should return 404 when config file doesn't exist", async () => {
    // Make sure no config file exists
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    if (await fs.pathExists(configPath)) {
      await fs.remove(configPath);
    }

    const key = "anyKey";
    const response = await request(testServer.getApp())
      .delete(`/api/config/${key}`)
      .expect(404);

    // Check the response
    expect(response.body).toEqual({
      error: `Configuration key '${key}' not found`,
    });
  });

  // Tests for DELETE /config?keys=key1,key2 endpoint
  test("DELETE /api/config?keys should delete multiple configuration values", async () => {
    // Create a test config file with multiple values
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    const initialConfig = {
      key1: "value1",
      key2: "value2",
      key3: "value3",
      keyToKeep: "valueToKeep",
    };
    await fs.writeJSON(configPath, initialConfig);

    const response = await request(testServer.getApp())
      .delete("/api/config?keys=key1,key2,key3")
      .expect(200);

    // Check the response
    expect(response.body).toEqual({
      deletedKeys: ["key1", "key2", "key3"],
      message: "Deleted 3 system configuration value(s)",
    });

    // Verify the keys were actually deleted in the file
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual({
      keyToKeep: "valueToKeep",
    });
    expect(savedConfig.key1).toBeUndefined();
    expect(savedConfig.key2).toBeUndefined();
    expect(savedConfig.key3).toBeUndefined();
  });

  test("DELETE /api/config?keys should handle when some keys don't exist", async () => {
    // Create a test config file with multiple values
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    const initialConfig = {
      key1: "value1",
      keyToKeep: "valueToKeep",
    };
    await fs.writeJSON(configPath, initialConfig);

    const response = await request(testServer.getApp())
      .delete("/api/config?keys=key1,nonExistentKey1,nonExistentKey2")
      .expect(200);

    // Check the response (should only include keys that were actually deleted)
    expect(response.body).toEqual({
      deletedKeys: ["key1"],
      message: "Deleted 1 system configuration value(s)",
    });

    // Verify the keys were actually deleted in the file
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual({
      keyToKeep: "valueToKeep",
    });
    expect(savedConfig.key1).toBeUndefined();
  });

  test("DELETE /api/config?keys should return 404 when all specified keys are not found", async () => {
    // Create a test config file with multiple values
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    const initialConfig = {
      key1: "value1",
      key2: "value2",
    };
    await fs.writeJSON(configPath, initialConfig);

    const response = await request(testServer.getApp())
      .delete("/api/config?keys=nonExistentKey1,nonExistentKey2")
      .expect(404);

    // Check the response
    expect(response.body).toEqual({
      error: "None of the specified keys were found",
    });

    // Verify the config file remains unchanged
    const savedConfig = await fs.readJSON(configPath);
    expect(savedConfig).toEqual(initialConfig);
  });

  test("DELETE /api/config?keys should return 400 when no keys parameter is provided", async () => {
    const response = await request(testServer.getApp())
      .delete("/api/config")
      .expect(400);

    expect(response.body).toEqual({
      error: "Missing keys query parameter",
    });
  });

  test("DELETE /api/config?keys should return 400 when keys parameter is empty", async () => {
    const response = await request(testServer.getApp())
      .delete("/api/config?keys=")
      .expect(400);

    expect(response.body).toEqual({
      error: "Missing keys query parameter",
    });
  });

  test("DELETE /api/config?keys should return 404 when config file doesn't exist", async () => {
    // Make sure no config file exists
    const configPath = path.join(
      testServer.environment.getPaths().config.system(),
      "config.json"
    );
    if (await fs.pathExists(configPath)) {
      await fs.remove(configPath);
    }

    const response = await request(testServer.getApp())
      .delete("/api/config?keys=key1,key2")
      .expect(404);

    expect(response.body).toEqual({
      error: "Configuration not found",
    });
  });
});

const Conf = require("conf");
const path = require("path");
const os = require("os");
const fs = require("fs-extra");
const { ConfigStore } = require("../types");

const CONFIG_DEFAULTS = {
  server_url: "http://localhost:3000",
  api_key: "",
  timeout: 60000,
  output_format: "table",
  color: "auto",
  log_level: "info",
  auto_update_check: true,
};

/**
 * Manages persistent configuration for the CLI client.
 * Stores and retrieves configuration values from disk.
 */
class ConfigManager {
  constructor() {
    // Create config directory if it doesn't exist
    const configDir = path.join(os.homedir(), ".hola");
    fs.ensureDirSync(configDir);

    this.config = new Conf({
      projectName: "hola",
      configName: "config",
      defaults: CONFIG_DEFAULTS,
      schema: {
        server_url: {
          type: "string",
        },
        api_key: {
          type: "string",
        },
        timeout: {
          type: "number",
          minimum: 1000,
          maximum: 300000,
        },
        output_format: {
          type: "string",
          enum: ["table", "json", "yaml"],
        },
        color: {
          type: "string",
          enum: ["auto", "always", "never"],
        },
        log_level: {
          type: "string",
          enum: ["debug", "info", "warn", "error"],
        },
        auto_update_check: {
          type: "boolean",
        },
      },
    });
  }

  /**
   * Returns all configuration values as an object.
   */
  getConfig(): typeof ConfigStore {
    return this.config.store;
  }

  /**
   * Returns a specific configuration value by key.
   * @param key - Configuration key to retrieve
   * @param defaultValue - Value to return if key does not exist
   */
  get(key: string, defaultValue: any = undefined) {
    return this.config.get(key, defaultValue);
  }

  /**
   * Sets a configuration value by key.
   * @param key - Configuration key to set
   * @param value - Value to store
   */
  set(key: string, value: any) {
    return this.config.set(key, value);
  }

  /**
   * Deletes a configuration value by key.
   * @param key - Configuration key to delete
   */
  delete(key: string) {
    return this.config.delete(key);
  }

  /**
   * Checks if a configuration key exists.
   * @param key - Configuration key to check
   */
  has(key: string) {
    return this.config.has(key);
  }

  /**
   * Resets all configuration values to their defaults.
   */
  reset() {
    return this.config.clear();
  }
}

/**
 * Exports a singleton instance of the configuration manager for use throughout the CLI.
 */
module.exports = new ConfigManager();

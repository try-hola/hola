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
   * Get all configuration values
   */
  getConfig(): typeof ConfigStore {
    return this.config.store;
  }

  /**
   * Get a specific configuration value
   * @param {string} key - Configuration key to retrieve
   * @param {any} defaultValue - Default value if key doesn't exist
   */
  get(key: string, defaultValue: any = undefined) {
    return this.config.get(key, defaultValue);
  }

  /**
   * Set a configuration value
   * @param {string} key - Configuration key to set
   * @param {any} value - Value to store
   */
  set(key: string, value: any) {
    return this.config.set(key, value);
  }

  /**
   * Delete a configuration value
   * @param {string} key - Configuration key to delete
   */
  delete(key: string) {
    return this.config.delete(key);
  }

  /**
   * Check if a configuration value exists
   * @param {string} key - Configuration key to check
   */
  has(key: string) {
    return this.config.has(key);
  }

  /**
   * Reset all configuration to defaults
   */
  reset() {
    return this.config.clear();
  }
}

module.exports = new ConfigManager();

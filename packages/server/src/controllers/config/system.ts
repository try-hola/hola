const path = require("path");
import * as fs from "fs-extra";
const { logEvent } = require("../../utils/logger");
const { PATHS } = require("../../config");
import { Request, Response } from "express";

/**
 * Retrieves system configuration.
 *
 * @param req - The request object, can include a 'key' query parameter to retrieve specific configuration.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the system configuration is retrieved.
 */
interface GetSystemConfigQueryParams {
  key?: string;
}

interface GetSystemConfigResponse {
  config: Record<string, any>;
}

interface SystemConfigErrorResponse {
  error: string;
  details?: string;
}

const getSystemConfig = async (
  req: Request<{}, {}, {}, GetSystemConfigQueryParams>,
  res: Response<GetSystemConfigResponse | SystemConfigErrorResponse>,
): Promise<void> => {
  const { key } = req.query;
  const configPath = path.join(PATHS.config.system(), "config.json");

  try {
    // Create the directory if it doesn't exist (especially for tests)
    await fs.ensureDir(path.dirname(configPath));

    // Use empty object as fallback when file doesn't exist
    let config: Record<string, any> = {};

    // Read the configuration file if it exists
    if (await fs.pathExists(configPath)) {
      try {
        const configData = await fs.readFile(configPath, "utf8");
        config = JSON.parse(configData);
      } catch (parseError: any) {
        logEvent("CONFIG", "error", `Failed to parse system config JSON`, {
          path: configPath,
          error: parseError.message,
        });
        res.status(500).json({
          error: "Failed to parse system configuration",
          details: parseError.message,
        });
        return;
      }
    }

    // If a specific key was requested, return just that key-value pair
    if (key) {
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        res.status(200).json({
          config: { [key]: config[key] },
        });
      } else {
        res.status(404).json({ error: `Configuration key '${key}' not found` });
      }
    } else {
      // Return the entire configuration
      res.status(200).json({
        config,
      });
    }
  } catch (error: any) {
    logEvent("CONFIG", "error", `Failed to retrieve system configuration`, {
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to retrieve system configuration",
      details: error.message,
    });
  }
};

/**
 * Creates or updates multiple system configuration values.
 *
 * @param req - The request object containing the configuration values in the body.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the system configuration is updated.
 */
interface CreateSystemConfigRequestBody {
  config: Record<string, any>;
}

interface CreateSystemConfigResponse {
  config: Record<string, any>;
  message: string;
}

const createSystemConfig = async (
  req: Request<{}, {}, CreateSystemConfigRequestBody>,
  res: Response<CreateSystemConfigResponse | SystemConfigErrorResponse>,
): Promise<void> => {
  try {
    const { config } = req.body;

    if (!config || typeof config !== "object") {
      res.status(400).json({
        error: "Invalid configuration format",
        details: "Config must be a valid object",
      });
      return;
    }

    // Define config path from the system config directory
    const configPath = path.join(PATHS.config.system(), "config.json");
    const configDir = path.dirname(configPath);

    // Ensure directory exists
    await fs.ensureDir(configDir);

    // Initialize existingConfig as empty object
    let existingConfig = {};

    // Check if the config file exists and read it if it does
    if (await fs.pathExists(configPath)) {
      try {
        existingConfig = await fs.readJSON(configPath);
      } catch (readError: any) {
        // If there's an error reading the file (corrupted JSON, etc.),
        // log it but continue with an empty object
        logEvent(
          "CONFIG",
          "warning",
          `Error reading existing config, creating new file`,
          {
            path: configPath,
            error: readError.message,
          },
        );
        // We'll create a new file with just the new config
      }
    }

    // Merge the new config with the existing one (or empty object if no existing config)
    const updatedConfig = { ...existingConfig, ...config };

    // Write the updated config back to the file
    await fs.writeJSON(configPath, updatedConfig, { spaces: 2 });

    logEvent("CONFIG", "info", "Updated system configuration", {
      updatedKeys: Object.keys(config),
      configPath,
    });

    // Return the updated config
    res.status(200).json({
      config: updatedConfig,
      message: `Updated ${Object.keys(config).length} configuration value(s)`,
    });
  } catch (error: any) {
    logEvent("CONFIG", "error", "Failed to update system config", {
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to update system configuration",
      details: error.message,
    });
  }
};

/**
 * Creates or updates a specific system configuration value.
 *
 * @param req - The request object containing the key in params and value in body.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the system configuration value is updated.
 */
interface UpdateSystemConfigValueRequestParams {
  key: string;
}

interface UpdateSystemConfigValueRequestBody {
  value: any;
}

interface UpdateSystemConfigValueResponse {
  key: string;
  value: any;
  message: string;
}

const updateSystemConfigValue = async (
  req: Request<
    UpdateSystemConfigValueRequestParams,
    {},
    UpdateSystemConfigValueRequestBody
  >,
  res: Response<UpdateSystemConfigValueResponse | SystemConfigErrorResponse>,
): Promise<void> => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      res.status(400).json({
        error: "Missing value in request body",
      });
      return;
    }

    // Define config path from the system config directory
    const configPath = path.join(PATHS.config.system(), "config.json");

    // Check if the config file exists, if not create it
    if (!(await fs.pathExists(configPath))) {
      await fs.ensureDir(path.dirname(configPath));
      await fs.writeJSON(configPath, {}, { spaces: 2 });
    }

    // Read the existing config
    let existingConfig = await fs.readJSON(configPath);

    // Update the specific key
    existingConfig[key] = value;

    // Write the updated config back to the file
    await fs.writeJSON(configPath, existingConfig, { spaces: 2 });

    logEvent("CONFIG", "info", `Updated system config value for key: ${key}`, {
      value,
    });

    // Return the updated value
    res.status(200).json({
      key,
      value,
      message: `Updated system configuration value for key: ${key}`,
    });
  } catch (error: any) {
    logEvent("CONFIG", "error", "Failed to update system config value", {
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to update system configuration value",
      details: error.message,
    });
  }
};

/**
 * Deletes a specific system configuration value.
 *
 * @param req - The request object containing the key in params.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the system configuration value is deleted.
 */
interface DeleteSystemConfigValueRequestParams {
  key: string;
}

interface DeleteSystemConfigValueResponse {
  key: string;
  message: string;
}

const deleteSystemConfigValue = async (
  req: Request<DeleteSystemConfigValueRequestParams>,
  res: Response<DeleteSystemConfigValueResponse | SystemConfigErrorResponse>,
): Promise<void> => {
  try {
    const { key } = req.params;

    // Define config path from the system config directory
    const configPath = path.join(PATHS.config.system(), "config.json");

    // Check if the config file exists
    if (!(await fs.pathExists(configPath))) {
      res.status(404).json({ error: `Configuration key '${key}' not found` });
      return;
    }

    // Read the config file
    let config = await fs.readJSON(configPath);

    // Check if the key exists
    if (!config.hasOwnProperty(key)) {
      res.status(404).json({ error: `Configuration key '${key}' not found` });
      return;
    }

    // Delete the key
    delete config[key];

    // Write the updated config back to the file
    await fs.writeJSON(configPath, config, { spaces: 2 });

    logEvent("CONFIG", "info", `Deleted system config value for key: ${key}`);

    // Return success response
    res.status(200).json({
      key,
      message: `Deleted system configuration value for key: ${key}`,
    });
  } catch (error: any) {
    logEvent("CONFIG", "error", "Failed to delete system config value", {
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to delete system configuration value",
      details: error.message,
    });
  }
};

/**
 * Deletes multiple system configuration values.
 *
 * @param req - The request object containing the keys to delete in the query parameter.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the system configuration values are deleted.
 */
interface DeleteMultipleSystemConfigValuesQuery {
  keys: string;
}

interface DeleteMultipleSystemConfigValuesResponse {
  deletedKeys: string[];
  message: string;
}

const deleteMultipleSystemConfigValues = async (
  req: Request<{}, {}, {}, DeleteMultipleSystemConfigValuesQuery>,
  res: Response<
    DeleteMultipleSystemConfigValuesResponse | SystemConfigErrorResponse
  >,
): Promise<void> => {
  try {
    const { keys } = req.query;

    // Split the keys string into an array and filter out any empty values
    const keyArray = keys
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key);

    if (keyArray.length === 0) {
      res.status(400).json({
        error: "No valid keys provided",
        details: "Keys parameter must contain at least one valid key",
      });
      return;
    }

    // Define config path from the system config directory
    const configPath = path.join(PATHS.config.system(), "config.json");

    // Check if the config file exists
    if (!(await fs.pathExists(configPath))) {
      res.status(404).json({ error: "Configuration not found" });
      return;
    }

    // Read the config file
    let config = await fs.readJSON(configPath);

    // Keep track of which keys were actually deleted
    const deletedKeys: string[] = [];

    // Delete each key
    keyArray.forEach((key) => {
      if (config.hasOwnProperty(key)) {
        delete config[key];
        deletedKeys.push(key);
      }
    });

    if (deletedKeys.length === 0) {
      res.status(404).json({ error: "None of the specified keys were found" });
      return;
    }

    // Write the updated config back to the file
    await fs.writeJSON(configPath, config, { spaces: 2 });

    logEvent(
      "CONFIG",
      "info",
      `Deleted ${deletedKeys.length} system config value(s)`,
      {
        keys: deletedKeys,
      },
    );

    // Return success response
    res.status(200).json({
      deletedKeys,
      message: `Deleted ${deletedKeys.length} system configuration value(s)`,
    });
  } catch (error: any) {
    logEvent("CONFIG", "error", "Failed to delete system config values", {
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to delete system configuration values",
      details: error.message,
    });
  }
};

// Export using CommonJS syntax
module.exports = {
  getSystemConfig,
  createSystemConfig,
  updateSystemConfigValue,
  deleteSystemConfigValue,
  deleteMultipleSystemConfigValues,
};

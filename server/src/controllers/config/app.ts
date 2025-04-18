const path = require("path");
import * as fs from "fs-extra";
const { logEvent } = require("../../utils/logger");
const { PATHS, isValidAppName } = require("../../config");
const { encryptValue, decryptValue } = require("../../utils/encryption");
import { Request, Response } from "express";

/**
 * Retrieves application configuration.
 *
 * @param req - The request object, can include a 'key' query parameter to retrieve specific configuration.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the app configuration is retrieved.
 */
interface GetAppConfigQueryParams {
  key?: string;
}

interface GetAppConfigRequestParams {
  appName: string;
}

interface GetAppConfigResponse {
  appName: string;
  config: Record<string, any>;
}

interface AppConfigErrorResponse {
  error: string;
  details?: string;
}

const getAppConfig = async (
  req: Request<GetAppConfigRequestParams, {}, {}, GetAppConfigQueryParams>,
  res: Response<GetAppConfigResponse | AppConfigErrorResponse>,
): Promise<void> => {
  const { appName } = req.params;
  const { key } = req.query;

  if (!isValidAppName(appName)) {
    res.status(400).json({
      error: "Invalid application name",
      details: "Application name contains invalid characters",
    });
    return;
  }

  const configPath = path.join(PATHS.config.app(appName), "config.json");

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
        logEvent("CONFIG", "error", `Failed to parse app config JSON`, {
          appName,
          path: configPath,
          error: parseError.message,
        });
        res.status(500).json({
          error: "Failed to parse application configuration",
          details: parseError.message,
        });
        return;
      }
    }

    // If a specific key was requested, return just that key-value pair
    if (key) {
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        res.status(200).json({
          appName,
          config: { [key]: config[key] },
        });
      } else {
        res.status(404).json({
          error: `Configuration key '${key}' not found for application '${appName}'`,
        });
      }
    } else {
      // Return the entire configuration
      res.status(200).json({
        appName,
        config,
      });
    }
  } catch (error: any) {
    logEvent("CONFIG", "error", `Failed to retrieve app configuration`, {
      appName,
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to retrieve application configuration",
      details: error.message,
    });
  }
};

/**
 * Creates or updates multiple application configuration values.
 *
 * @param req - The request object containing the application name in params and configuration values in body.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application configuration is updated.
 */
interface CreateAppConfigRequestParams {
  appName: string;
}

interface CreateAppConfigRequestBody {
  config: Record<string, any>;
}

interface CreateAppConfigResponse {
  appName: string;
  config: Record<string, any>;
  message: string;
}

const createAppConfig = async (
  req: Request<CreateAppConfigRequestParams, {}, CreateAppConfigRequestBody>,
  res: Response<CreateAppConfigResponse | AppConfigErrorResponse>,
): Promise<void> => {
  try {
    const { appName } = req.params;
    const { config } = req.body;

    if (!isValidAppName(appName)) {
      res.status(400).json({
        error: "Invalid application name",
        details: "Application name contains invalid characters",
      });
      return;
    }

    if (!config || typeof config !== "object") {
      res.status(400).json({
        error: "Invalid configuration format",
        details: "Config must be a valid object",
      });
      return;
    }

    // Define config path from the app config directory
    const configPath = path.join(PATHS.config.app(appName), "config.json");
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
          `Error reading existing app config, creating new file`,
          {
            appName,
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

    logEvent("CONFIG", "info", `Updated configuration for app: ${appName}`, {
      updatedKeys: Object.keys(config),
      configPath,
    });

    // Return the updated config
    res.status(200).json({
      appName,
      config: updatedConfig,
      message: `Updated ${
        Object.keys(config).length
      } configuration value(s) for ${appName}`,
    });
  } catch (error: any) {
    logEvent("CONFIG", "error", `Failed to update app config`, {
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to update application configuration",
      details: error.message,
    });
  }
};

/**
 * Updates or creates a specific application configuration value.
 *
 * @param req - The request object containing the application name and key in params, and value in body.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application configuration value is updated.
 */
interface UpdateAppConfigValueRequestParams {
  appName: string;
  key: string;
}

interface UpdateAppConfigValueRequestBody {
  value: any;
}

interface UpdateAppConfigValueResponse {
  appName: string;
  key: string;
  value: any;
  message: string;
}

const updateAppConfigValue = async (
  req: Request<
    UpdateAppConfigValueRequestParams,
    {},
    UpdateAppConfigValueRequestBody
  >,
  res: Response<UpdateAppConfigValueResponse | AppConfigErrorResponse>,
): Promise<void> => {
  try {
    const { appName, key } = req.params;
    const { value } = req.body;

    if (!isValidAppName(appName)) {
      res.status(400).json({
        error: "Invalid application name",
        details: "Application name contains invalid characters",
      });
      return;
    }

    if (value === undefined) {
      res.status(400).json({
        error: "Missing value in request body",
      });
      return;
    }

    // Define config path from the app config directory
    const configPath = path.join(PATHS.config.app(appName), "config.json");
    const configDir = path.dirname(configPath);

    // Ensure directory exists
    await fs.ensureDir(configDir);

    // Initialize with empty object if file doesn't exist
    let existingConfig: Record<string, any> = {};

    // Check if the config file exists and read it if it does
    if (await fs.pathExists(configPath)) {
      try {
        existingConfig = await fs.readJSON(configPath);
      } catch (readError: unknown) {
        // If there's an error reading the file (corrupted JSON, etc.),
        // log it but continue with an empty object
        logEvent(
          "CONFIG",
          "warning",
          `Error reading existing app config, creating new file`,
          {
            appName,
            path: configPath,
            error:
              readError instanceof Error
                ? readError.message
                : String(readError),
          },
        );
        // We'll create a new file with just the new config
      }
    }

    // Update the specific key
    existingConfig[key] = value;

    // Write the updated config back to the file
    await fs.writeJSON(configPath, existingConfig, { spaces: 2 });

    logEvent("CONFIG", "info", `Updated app config value for key: ${key}`, {
      appName,
      key,
      value,
    });

    // Return success response
    res.status(200).json({
      appName,
      key,
      value,
      message: `Updated configuration value for ${appName}: ${key}`,
    });
  } catch (error: any) {
    logEvent("CONFIG", "error", "Failed to update app config value", {
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to update application configuration value",
      details: error.message,
    });
  }
};

/**
 * Deletes multiple application configuration values.
 *
 * @param req - The request object containing the application name in params and keys to delete in the query parameter.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application configuration values are deleted.
 */
interface DeleteMultipleAppConfigValuesParams {
  appName: string;
}

interface DeleteMultipleAppConfigValuesQuery {
  keys: string;
}

interface DeleteMultipleAppConfigValuesResponse {
  appName: string;
  deletedKeys: string[];
  message: string;
}

const deleteMultipleAppConfigValues = async (
  req: Request<
    DeleteMultipleAppConfigValuesParams,
    {},
    {},
    DeleteMultipleAppConfigValuesQuery
  >,
  res: Response<DeleteMultipleAppConfigValuesResponse | AppConfigErrorResponse>,
): Promise<void> => {
  try {
    const { appName } = req.params;
    const { keys } = req.query;

    if (!isValidAppName(appName)) {
      res.status(400).json({
        error: "Invalid application name",
        details: "Application name contains invalid characters",
      });
      return;
    }

    if (!keys || typeof keys !== "string" || keys.trim().length === 0) {
      res.status(400).json({
        error: "Missing or invalid keys parameter",
        details: "Keys must be provided as a comma-separated string",
      });
      return;
    }

    // Parse the keys string into an array
    const keysList = keys
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key);

    if (keysList.length === 0) {
      res.status(400).json({
        error: "No valid keys provided",
        details: "Keys parameter must contain at least one valid key",
      });
      return;
    }

    // Define config path from the app config directory
    const configPath = path.join(PATHS.config.app(appName), "config.json");

    // Check if the config file exists
    if (!(await fs.pathExists(configPath))) {
      res.status(404).json({
        error: `Configuration not found for application '${appName}'`,
      });
      return;
    }

    // Read the config file
    let config: Record<string, any>;
    try {
      config = await fs.readJSON(configPath);
    } catch (readError: any) {
      logEvent("CONFIG", "error", `Failed to read app config file`, {
        appName,
        path: configPath,
        error: readError.message,
      });
      res.status(500).json({
        error: "Failed to read application configuration",
        details: readError.message,
      });
      return;
    }

    // Track successfully deleted keys
    const deletedKeys: string[] = [];

    // Delete each key if it exists
    for (const key of keysList) {
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        delete config[key];
        deletedKeys.push(key);
      }
    }

    // If no keys were deleted, return 404
    if (deletedKeys.length === 0) {
      res.status(404).json({
        error: "None of the specified keys were found",
      });
      return;
    }

    // Write the updated config back to the file
    await fs.writeJSON(configPath, config, { spaces: 2 });

    logEvent(
      "CONFIG",
      "info",
      `Deleted ${deletedKeys.length} app config value(s)`,
      {
        appName,
        keys: deletedKeys,
      },
    );

    // Return success response
    res.status(200).json({
      appName,
      deletedKeys,
      message: `Deleted ${deletedKeys.length} configuration value(s) for ${appName}`,
    });
  } catch (error: any) {
    logEvent("CONFIG", "error", "Failed to delete app config values", {
      error: error.message,
      appName: req.params.appName,
    });
    res.status(500).json({
      error: "Failed to delete application configuration values",
      details: error.message,
    });
  }
};

/**
 * Deletes a specific application configuration value.
 *
 * @param req - The request object containing the application name and key in params.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application configuration value is deleted.
 */
interface DeleteAppConfigValueRequestParams {
  appName: string;
  key: string;
}

interface DeleteAppConfigValueResponse {
  appName: string;
  key: string;
  message: string;
}

const deleteAppConfigValue = async (
  req: Request<DeleteAppConfigValueRequestParams>,
  res: Response<DeleteAppConfigValueResponse | AppConfigErrorResponse>,
): Promise<void> => {
  try {
    const { appName, key } = req.params;

    if (!isValidAppName(appName)) {
      res.status(400).json({
        error: "Invalid application name",
        details: "Application name contains invalid characters",
      });
      return;
    }

    // Define config path from the app config directory
    const configPath = path.join(PATHS.config.app(appName), "config.json");

    // Check if the config file exists
    if (!(await fs.pathExists(configPath))) {
      res.status(404).json({
        error: `Configuration key '${key}' not found for application '${appName}'`,
      });
      return;
    }

    // Read the config file
    let config: Record<string, any>;
    try {
      config = await fs.readJSON(configPath);
    } catch (readError: any) {
      logEvent("CONFIG", "error", `Failed to read app config file`, {
        appName,
        path: configPath,
        error: readError.message,
      });
      res.status(500).json({
        error: "Failed to read application configuration",
        details: readError.message,
      });
      return;
    }

    // Check if the key exists
    if (!config.hasOwnProperty(key)) {
      res.status(404).json({
        error: `Configuration key '${key}' not found for application '${appName}'`,
      });
      return;
    }

    // Delete the key
    delete config[key];

    // Write the updated config back to the file
    await fs.writeJSON(configPath, config, { spaces: 2 });

    logEvent("CONFIG", "info", `Deleted app config value for key: ${key}`, {
      appName,
      key,
    });

    // Return success response
    res.status(200).json({
      appName,
      key,
      message: `Deleted configuration value for ${appName}: ${key}`,
    });
  } catch (error: any) {
    logEvent("CONFIG", "error", "Failed to delete app config value", {
      error: error.message,
      appName: req.params.appName,
    });
    res.status(500).json({
      error: "Failed to delete application configuration value",
      details: error.message,
    });
  }
};

/**
 * Deletes application-specific configuration.
 *
 * @param req - The request object containing the application name in the params.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application configuration is deleted.
 */
interface DeleteAppConfigRequestParams {
  appName: string;
}

interface DeleteAppConfigResponse {
  appName: string;
  message: string;
}

const deleteAppConfig = async (
  req: Request<DeleteAppConfigRequestParams>,
  res: Response<DeleteAppConfigResponse | AppConfigErrorResponse>,
): Promise<void> => {
  try {
    const { appName } = req.params;

    if (!isValidAppName(appName)) {
      res.status(400).json({
        error: "Invalid application name",
        details: "Application name contains invalid characters",
      });
      return;
    }

    // Define config path from the app config directory
    const configPath = path.join(PATHS.config.app(appName), "config.json");

    // Check if the config file exists
    if (!(await fs.pathExists(configPath))) {
      res.status(404).json({
        error: `Configuration not found for application '${appName}'`,
      });
      return;
    }

    // Delete the config file
    await fs.remove(configPath);

    logEvent("CONFIG", "info", `Deleted configuration for app: ${appName}`);

    // Return success response
    res.status(200).json({
      appName,
      message: `Deleted configuration for ${appName}`,
    });
  } catch (error: any) {
    logEvent("CONFIG", "error", `Failed to delete app config`, {
      error: error.message,
      appName: req.params.appName,
    });
    res.status(500).json({
      error: "Failed to delete application configuration",
      details: error.message,
    });
  }
};

// Export using CommonJS syntax
module.exports = {
  getAppConfig,
  createAppConfig,
  updateAppConfigValue,
  deleteAppConfigValue,
  deleteMultipleAppConfigValues,
  deleteAppConfig,
};

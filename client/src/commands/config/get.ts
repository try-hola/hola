const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { ConfigGetOptions, ApiResponse } = require("../../types");

/**
 * Handles retrieval of configuration values from the remote API (system or app-specific).
 * @param {ConfigGetOptions} options - Command options
 * @returns {Promise<ApiResponse<any>>}
 */
async function handler(
  options: import("../../types").ConfigGetOptions,
): Promise<import("../../types").ApiResponse> {
  try {
    const { app, key, secret } = options;
    let endpoint = "";
    let params = key ? { key } : {};
    let response;

    if (app) {
      endpoint = secret ? `/api/config/${app}/encrypted` : `/api/config/${app}`;
      response = await apiClient.get(endpoint, params);
      if (response && response.data) {
        const outputData =
          key && response.data.config
            ? response.data.config[key]
            : response.data.config;
        outputFormatter.formatOutput(outputData, options.output);
        return { success: true, data: response.data };
      }
    } else {
      endpoint = "/api/config";
      response = await apiClient.get(endpoint, params);
      if (response && response.data) {
        const outputData =
          key && response.data.config
            ? response.data.config[key]
            : response.data.config;
        outputFormatter.formatOutput(outputData, options.output);
        return { success: true, data: response.data };
      }
    }
    outputFormatter.formatOutput(
      { error: "No configuration found." },
      options.output,
    );
    return {
      success: false,
      error: { code: "NOT_FOUND", message: "No configuration found." },
    };
  } catch (error) {
    outputFormatter.formatOutput(
      { error: error.message || "Unknown error" },
      "table",
    );
    return {
      success: false,
      error: {
        code: error.code || "GET_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
    };
  }
}

/**
 * Builder function for configuring command-line options for the get command.
 * @param yargs - Yargs instance
 * @returns Yargs instance with options configured
 */
function builder(yargs) {
  return yargs
    .option("app", {
      describe: "Target application name",
      type: "string",
    })
    .option("key", {
      describe: "Specific configuration key to retrieve",
      type: "string",
    })
    .option("secret", {
      describe: "Operate on encrypted values",
      type: "boolean",
    });
}

/**
 * CLI command string for getting configuration values.
 */
const command = "get";

/**
 * Description for the get command.
 */
const describe = "Get configuration values";

/**
 * Registers the get command with the Commander configCommand instance.
 */
module.exports = {
  command,
  describe,
  builder,
  handler,
  // Export commander.js configuration function
  default: function (configCommand) {
    return configCommand
      .command(command)
      .description(describe)
      .option("--app <name>", "Target application name")
      .option("--key <name>", "Specific configuration key to retrieve")
      .option("--secret", "Operate on encrypted values")
      .action(handler)
      .addHelpText(
        "after",
        `
Examples:
  $ hola config get                        Get all client configuration values
  $ hola config get --key server_url       Get specific client configuration value
  $ hola config get --app myapp            Get all configuration values for an application
  $ hola config get --app myapp --key port Get specific configuration value for an application
  $ hola config get --app myapp --secret   Get all encrypted values for an application`,
      );
  },
};

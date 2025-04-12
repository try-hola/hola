const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { ConfigSetOptions, ApiResponse } = require("../../types");

/**
 * Handles setting of configuration values via the remote API (system or app-specific).
 * @param {Array<string>} keyValues - Array of key=value pairs
 * @param {ConfigSetOptions} options - Command options
 * @returns {Promise<ApiResponse<any>>}
 */
async function handler(keyValues: string[], options: import("../../types").ConfigSetOptions): Promise<import("../../types").ApiResponse> {
  try {
    const { app, secret } = options;
    const configValues = keyValues.reduce((acc, pair) => {
      const [key, value] = pair.split("=");
      if (!key || value === undefined) {
        throw new Error(`Invalid key=value pair: ${pair}`);
      }
      acc[key] = value;
      return acc;
    }, {});
    let endpoint = "";
    let response;
    if (app) {
      endpoint = secret ? `/api/config/${app}/encrypted` : `/api/config/${app}`;
      response = await apiClient.post(endpoint, { config: configValues });
      outputFormatter.formatOutput({ message: `Configuration for app '${app}' updated successfully.` }, options.output);
    } else {
      endpoint = "/api/config";
      response = await apiClient.post(endpoint, { config: configValues });
      outputFormatter.formatOutput({ message: "System configuration updated successfully." }, options.output);
    }
    return { success: true, data: response && response.data ? response.data : undefined };
  } catch (error) {
    outputFormatter.formatOutput({ error: error.message || "Unknown error" }, "table");
    return {
      success: false,
      error: {
        code: error.code || "SET_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
    };
  }
}

/**
 * Builder function for configuring command-line options for the set command.
 * @param yargs - Yargs instance
 * @returns Yargs instance with options configured
 */
function builder(yargs) {
  return yargs
    .option("app", {
      describe: "Target application name",
      type: "string"
    })
    .option("secret", {
      describe: "Store values with encryption",
      type: "boolean"
    });
}

/**
 * CLI command string for setting configuration values.
 */
const command = "set [keyValues..]";

/**
 * Description for the set command.
 */
const describe = "Set configuration values";

/**
 * Registers the set command with the Commander configCommand instance.
 */
module.exports = {
  command,
  describe,
  builder,
  handler,
  default: function(configCommand) {
    return configCommand
      .command("set <keyValues...>")
      .description(describe)
      .option("--app <name>", "Target application name")
      .option("--secret", "Store values with encryption")
      .action(handler)
      .addHelpText('after', `\nExamples:\n  $ hola config set server_url=http://localhost:3000    Set system config value\n  $ hola config set --app myapp DB_USER=admin DB_PASS=password    Set multiple app config values`);
  }
};

const apiClient = require("../../utils/api-client");
const configManager = require("../../utils/config-manager");
const { handleCommandError } = require("../../utils/error-handler");
const outputFormatter = require("../../utils/output-formatter");

/**
 * Set configuration values
 * @param {Array<string>} keyValues - Array of key=value pairs
 * @param {{ app?: string; secret?: boolean }} options - Command options
 */
async function handler(keyValues, options) {
  try {
    const { app, secret } = options;
    // Parse key=value pairs into an object
    const configValues = keyValues.reduce((acc, pair) => {
      const [key, value] = pair.split("=");
      if (!key || value === undefined) {
        throw new Error(`Invalid key=value pair: ${pair}`);
      }
      acc[key] = value;
      return acc;
    }, {});
    if (app) {
      // Set app-specific configuration on the server
      const endpoint = secret ? `/api/config/${app}/encrypted` : `/api/config/${app}`;
      await apiClient.post(endpoint, { config: configValues });
      outputFormatter.formatOutput({ message: `Configuration for app '${app}' updated successfully.` }, options.output);
    } else {
      // Set system-wide configuration locally
      Object.entries(configValues).forEach(([key, value]) => {
        configManager.set(key, value);
      });
      outputFormatter.formatOutput({ message: "System configuration updated successfully." }, options.output);
    }
    return { success: true };
  } catch (error) {
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

const command = "set [keyValues..]";
const describe = "Set configuration values";

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

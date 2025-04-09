const configManager = require("../../utils/config-manager");
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");

/**
 * Set configuration values
 * @param {Array<string>} keyValues - Array of key=value pairs
 * @param {Object} options - Command options
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
      console.log(`Configuration for app '${app}' updated successfully.`);
    } else {
      // Set system-wide configuration locally
      Object.entries(configValues).forEach(([key, value]) => {
        configManager.set(key, value);
      });
      console.log("System configuration updated successfully.");
    }

    return { success: true };
  } catch (error) {
    return handleCommandError(error);
  }
}

// Commander.js builder function equivalent for tests
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

// Define command structure for tests
const command = "set [keyValues..]";
const describe = "Set configuration values";

// Export for tests
module.exports = {
  command,
  describe,
  builder,
  handler,
  // Export Commander.js configuration function for actual CLI usage
  default: function(configCommand) {
    return configCommand
      .command("set <keyValues...>")
      .description(describe)
      .option("--app <name>", "Target application name")
      .option("--secret", "Store values with encryption")
      .action(handler)
      .addHelpText('after', `
Examples:
  $ hola config set server_url=http://localhost:3000    Set system config value
  $ hola config set --app myapp DB_USER=admin DB_PASS=password    Set multiple app config values`);
  }
};

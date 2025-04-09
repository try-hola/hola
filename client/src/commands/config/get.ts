const configManager = require("../../utils/config-manager");
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");

/**
 * Get configuration values
 * @param {Object} options - Command options
 */
async function handler(options) {
  try {
    const { app, key, secret } = options;

    // If app is specified, get app-specific config from server
    if (app) {
      logger.debug(`Getting config for app: ${app}, key: ${key || 'all'}, secret: ${!!secret}`);
      let endpoint = `/api/config/${app}`;
      
      // If requesting encrypted values
      if (secret) {
        endpoint = `/api/config/${app}/encrypted`;
      }
      
      const params = key ? { key } : {};
      const response = await apiClient.get(endpoint, params);

      // Format and display the response data
      const outputData = key && response.data ? response.data[key] : response.data;
      outputFormatter.formatOutput(outputData, options.output);
      
      return { success: true, data: response.data };
    } else {
      // If no app specified, get local client config or system config from server
      if (key === 'api_key') {
        // Don't show the full API key, mask it for security
        const apiKey = configManager.get('api_key');
        const maskedKey = apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : '';
        outputFormatter.formatOutput({ api_key: maskedKey }, options.output);
        return { success: true, data: { api_key: maskedKey } };
      } else if (key) {
        // Get a specific local config value
        const value = configManager.get(key);
        outputFormatter.formatOutput({ [key]: value }, options.output);
        return { success: true, data: { [key]: value } };
      } else {
        // Get all local config values (with masked api_key)
        const config = configManager.getConfig();
        if (config.api_key) {
          config.api_key = `${config.api_key.substring(0, 4)}...${config.api_key.substring(config.api_key.length - 4)}`;
        }
        outputFormatter.formatOutput(config, options.output);
        return { success: true, data: config };
      }
    }
  } catch (error) {
    return handleCommandError(error);
  }
}

/**
 * Builder function for command options
 */
function builder(yargs) {
  return yargs
    .option("app", {
      describe: "Target application name",
      type: "string"
    })
    .option("key", {
      describe: "Specific configuration key to retrieve",
      type: "string"
    })
    .option("secret", {
      describe: "Operate on encrypted values",
      type: "boolean"
    });
}

// Command definition properties
const command = "get";
const describe = "Get configuration values";

// Export command specification for testing
module.exports = {
  command,
  describe,
  builder,
  handler,
  // Export commander.js configuration function 
  default: function(configCommand) {
    return configCommand
      .command(command)
      .description(describe)
      .option("--app <name>", "Target application name")
      .option("--key <name>", "Specific configuration key to retrieve")
      .option("--secret", "Operate on encrypted values")
      .action(handler)
      .addHelpText('after', `
Examples:
  $ hola config get                        Get all client configuration values
  $ hola config get --key server_url       Get specific client configuration value
  $ hola config get --app myapp            Get all configuration values for an application
  $ hola config get --app myapp --key port Get specific configuration value for an application
  $ hola config get --app myapp --secret   Get all encrypted values for an application`);
  }
};

const configManager = require("../../utils/config-manager");
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");

/**
 * Delete configuration values
 * @param {Array<string>} keys - Array of keys to delete
 * @param {Object} options - Command options
 */
async function execute(keys, options) {
  try {
    const { app, secret } = options;

    // To be implemented
    // Will delete configuration values either locally or from the remote server
    if (app) {
      console.log(
        `Deleting keys for app: ${app} ${
          secret ? "(encrypted)" : ""
        } (to be implemented)`
      );
    } else {
      console.log(`Deleting system config keys (to be implemented)`);
    }

    console.log("Keys to delete:", keys);
    return { success: true };
  } catch (error) {
    return handleCommandError(error);
  }
}

module.exports = function(configCommand) {
  return configCommand
    .command("delete <keys...>")
    .description("Delete configuration values")
    .option("--app <name>", "Target application name")
    .option("--secret", "Operate on encrypted values")
    .action(execute)
    .addHelpText('after', `
Examples:
  $ hola config delete server_url             Delete system config value
  $ hola config delete --app myapp DB_USER DB_PASS    Delete multiple app config values`);
};

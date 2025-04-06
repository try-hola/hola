const configManager = require("../../utils/config-manager");
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");

/**
 * Get configuration values
 * @param {Object} argv - Command arguments
 */
async function execute(argv) {
  try {
    const { app, key, secret } = argv;

    // To be implemented
    // Will fetch configuration values from either local config or remote server
    if (app) {
      console.log(
        `Getting ${key ? `key '${key}'` : "all keys"} for app: ${app} ${
          secret ? "(encrypted)" : ""
        } (to be implemented)`
      );
    } else {
      console.log(
        `Getting ${
          key ? `key '${key}'` : "all"
        } system config values (to be implemented)`
      );
    }

    return { success: true };
  } catch (error) {
    return handleCommandError(error);
  }
}

module.exports = {
  command: "get",
  describe: "Get configuration values",
  builder: (yargs) => {
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
  },
  handler: execute,
};

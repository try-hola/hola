const configManager = require("../../utils/config-manager");
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");

/**
 * Delete configuration values
 * @param {Object} argv - Command arguments
 */
async function execute(argv: any) {
  try {
    const { app, secret, keys } = argv;

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

module.exports = {
  command: "delete [keys..]",
  describe: "Delete configuration values",
  builder: (yargs: any) => {
    return yargs
      .option("app", {
        describe: "Target application name",
        type: "string",
      })
      .option("secret", {
        describe: "Operate on encrypted values",
        type: "boolean",
      })
      .example("hola config delete server_url", "Delete system config value")
      .example(
        "hola config delete --app myapp DB_USER DB_PASS",
        "Delete multiple app config values"
      )
      .demandOption("keys", "You must provide at least one key to delete");
  },
  handler: execute,
};

const configManager = require("../../utils/config-manager");
const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");

/**
 * Set configuration values
 * @param {Object} argv - Command arguments
 */
async function execute(argv) {
  try {
    const { app, secret, keyValues } = argv;

    // To be implemented
    // Will set configuration values either locally or on the remote server
    if (app) {
      console.log(
        `Setting values for app: ${app} ${
          secret ? "(encrypted)" : ""
        } (to be implemented)`
      );
    } else {
      console.log(`Setting system config values (to be implemented)`);
    }

    console.log("Values:", keyValues);
    return { success: true };
  } catch (error) {
    return handleCommandError(error);
  }
}

module.exports = {
  command: "set [keyValues..]",
  describe: "Set configuration values",
  builder: (yargs) => {
    return yargs
      .option("app", {
        describe: "Target application name",
        type: "string",
      })
      .option("secret", {
        describe: "Store values with encryption",
        type: "boolean",
      })
      .example(
        "hola config set server_url=http://localhost:3000",
        "Set system config value"
      )
      .example(
        "hola config set --app myapp DB_USER=admin DB_PASS=password",
        "Set multiple app config values"
      )
      .demandOption(
        "keyValues",
        "You must provide at least one key=value pair"
      );
  },
  handler: execute,
};

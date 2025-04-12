const outputFormatter = require("../../utils/output-formatter");
const configManager = require("../../utils/config-manager");

/**
 * Implements `hola settings get [--key <key>]`.
 * Retrieves all or a specific local client setting from ~/.hola/config.json.
 */
module.exports = function registerSettingsGet(program) {
  program
    .command("get")
    .description("Get a client setting or all settings")
    .option("--key <key>", "Setting key to retrieve")
    .action(async (options) => {
      try {
        const config = await configManager.loadConfig();
        if (options.key) {
          if (Object.prototype.hasOwnProperty.call(config, options.key)) {
            outputFormatter.formatOutput({ [options.key]: config[options.key] }, "table");
          } else {
            outputFormatter.formatOutput({
              error: {
                code: "NOT_FOUND",
                message: `Setting '${options.key}' not found.`,
              },
            }, "json");
            process.exit(1);
          }
        } else {
          outputFormatter.formatOutput(config, "table");
        }
      } catch (err) {
        outputFormatter.formatOutput({
          error: {
            code: "SETTINGS_GET_ERROR",
            message: err.message || "Failed to load settings.",
          },
        }, "json");
        process.exit(1);
      }
    });
};

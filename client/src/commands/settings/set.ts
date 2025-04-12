const outputFormatter = require("../../utils/output-formatter");
const configManager = require("../../utils/config-manager");

/**
 * Implements `hola settings set <key>=<value>...`.
 * Updates or adds local client settings in ~/.hola/config.json.
 */
module.exports = function registerSettingsSet(program) {
  program
    .command("set")
    .description("Set one or more client settings (key=value ...)")
    .argument("<pairs...>", "Setting pairs in key=value format")
    .action(async (pairs) => {
      try {
        const updates = {};
        for (const pair of pairs) {
          const idx = pair.indexOf("=");
          if (idx === -1) {
            outputFormatter.formatOutput({
              error: {
                code: "INVALID_ARGUMENT",
                message: `Invalid setting format: '${pair}'. Use key=value.`,
              },
            }, "json");
            process.exit(1);
          }
          const key = pair.slice(0, idx);
          const value = pair.slice(idx + 1);
          updates[key] = value;
        }
        const config = await configManager.loadConfig();
        Object.assign(config, updates);
        await configManager.saveConfig(config);
        outputFormatter.formatOutput({ success: true, updated: updates }, "json");
      } catch (err) {
        outputFormatter.formatOutput({
          error: {
            code: "SETTINGS_SET_ERROR",
            message: err.message || "Failed to update settings.",
          },
        }, "json");
        process.exit(1);
      }
    });
};

/**
 * Config Manager Delete Command
 *
 * Handles deletion of configuration values, both local and remote app-specific settings.
 */

const apiClient = require("../../utils/api-client");
const configManager = require("../../utils/config-manager");

/**
 * Delete configuration values
 * @param {string[]} keys - Keys to delete
 * @param {{ app?: string; secret?: boolean }} options - Command options
 */
async function handler(
  keys: string[],
  options: { app?: string; secret?: boolean }
) {
  try {
    if (!options.app) {
      for (const key of keys) {
        if (key === "api_key") {
          console.warn("Warning: Deleting api_key is not recommended");
        }
        await configManager.delete(key);
      }
      console.log("Local configuration deleted successfully.");
    } else {
      const app = options.app;
      if (options.secret) {
        for (const key of keys) {
          const endpoint = `/api/config/${app}/encrypted/${key}`;
          await apiClient.delete(endpoint);
        }
      } else if (keys.length === 1) {
        const endpoint = `/api/config/${app}/${keys[0]}`;
        await apiClient.delete(endpoint);
      } else {
        const endpoint = `/api/config/${app}`;
        await apiClient.delete(endpoint, {
          params: { keys: keys.join(",") },
        });
      }
      console.log(`Configuration for app '${app}' deleted successfully.`);
    }
    return { success: true };
  } catch (error) {
    console.error("Delete failed:", error.message || error);
    return { success: false, error };
  }
}

/**
 * Builder function for tests (optional)
 */
function builder(yargs: any) {
  return yargs
    .option("app", {
      alias: "a",
      describe: "Application name",
      type: "string",
    })
    .option("secret", {
      alias: "s",
      describe: "Delete encrypted configuration values",
      type: "boolean",
    });
}

const command = "delete <keys...>";
const describe = "Delete configuration values";

module.exports = {
  command,
  describe,
  builder,
  handler,
  default: function (configCommand: import("commander").Command) {
    return configCommand
      .command("delete <keys...>")
      .description(describe)
      .option("-a, --app <name>", "Application name")
      .option("-s, --secret", "Delete encrypted configuration values")
      .action(handler)
      .addHelpText(
        "after",
        `
Examples:
  $ hola config delete api_key
  $ hola config delete server_url db_host
  $ hola config delete --app myapp DB_USER DB_PASS
  $ hola config delete --app myapp --secret SECRET_KEY`
      );
  },
};

/**
 * Config Manager Delete Command
 *
 * Handles deletion of configuration values, both local and remote app-specific settings.
 */

const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { ConfigDeleteOptions, ApiResponse } = require("../../types");

/**
 * Handles deletion of configuration values via the remote API (system or app-specific).
 * @param keys - Keys to delete
 * @param options - Command options
 * @returns ApiResponse indicating success or error
 */
async function handler(
  keys: string[],
  options: import("../../types").ConfigDeleteOptions
): Promise<import("../../types").ApiResponse> {
  try {
    let endpoint = "";
    let response;
    if (options.app) {
      const app = options.app;
      if (options.secret) {
        for (const key of keys) {
          endpoint = `/api/config/${app}/encrypted/${key}`;
          await apiClient.delete(endpoint);
        }
        outputFormatter.formatOutput({ message: `Encrypted configuration for app '${app}' deleted successfully.` }, "table");
      } else if (keys.length === 1) {
        endpoint = `/api/config/${app}/${keys[0]}`;
        await apiClient.delete(endpoint);
        outputFormatter.formatOutput({ message: `Configuration key '${keys[0]}' for app '${app}' deleted successfully.` }, "table");
      } else {
        endpoint = `/api/config/${app}`;
        await apiClient.delete(endpoint, {
          params: { keys: keys.join(",") },
        });
        outputFormatter.formatOutput({ message: `Configuration keys [${keys.join(", ")}] for app '${app}' deleted successfully.` }, "table");
      }
    } else {
      if (keys.length === 1) {
        endpoint = `/api/config/${keys[0]}`;
        await apiClient.delete(endpoint);
        outputFormatter.formatOutput({ message: `System configuration key '${keys[0]}' deleted successfully.` }, "table");
      } else {
        endpoint = `/api/config`;
        await apiClient.delete(endpoint, {
          params: { keys: keys.join(",") },
        });
        outputFormatter.formatOutput({ message: `System configuration keys [${keys.join(", ")}] deleted successfully.` }, "table");
      }
    }
    return { success: true };
  } catch (error) {
    outputFormatter.formatOutput({ error: error.message || "Delete failed" }, "table");
    return {
      success: false,
      error: {
        code: error.code || "DELETE_ERROR",
        message: error.message || "Delete failed",
        details: error.details,
      },
    };
  }
}

/**
 * Builder function for configuring command-line options for the delete command.
 * @param yargs - Yargs instance
 * @returns Yargs instance with options configured
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

/**
 * CLI command string for deleting configuration values.
 */
const command = "delete <keys...>";

/**
 * Description for the delete command.
 */
const describe = "Delete configuration values";

module.exports = {
  command,
  describe,
  builder,
  handler,
  /**
   * Registers the delete command with the Commander configCommand instance.
   */
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

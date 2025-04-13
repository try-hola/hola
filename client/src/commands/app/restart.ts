const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");
const { ApiResponse } = require("../../types");

/**
 * Handler to restart an application.
 * Sends a restart request to the server for the specified app.
 * @param appName - Name of the application to restart
 * @param options - Command options
 * @returns ApiResponse with restart result
 */
interface RestartOptions {}
async function handler(appName: string, options: RestartOptions): Promise<typeof ApiResponse> {
  try {
    logger.debug(`Restarting application: ${appName}`);
    const response = await apiClient.post(`/api/apps/${appName}/restart`);
    if (response.success) {
      outputFormatter.formatOutput({ message: `Application '${appName}' restarted successfully.` }, "table");
      return response;
    } else {
      outputFormatter.formatOutput({ error: { code: response.error?.code || "RESTART_FAILED", message: response.error?.message || "Application restart failed", details: response.error?.details } }, "table");
      return {
        success: false,
        error: {
          code: response.error?.code || "RESTART_FAILED",
          message: response.error?.message || "Application restart failed",
          details: response.error?.details,
        },
      };
    }
  } catch (error) {
    outputFormatter.formatOutput({ error: { code: error.code || "RESTART_ERROR", message: error.message || "Unknown error", details: error.details } }, "table");
    return {
      success: false,
      error: {
        code: error.code || "RESTART_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
    };
  }
}

const command = "restart <appName>";
const describe = "Restart an application";

function builder(yargs) {
  return yargs;
}

module.exports = {
  command,
  describe,
  builder,
  handler,
  default: function (appCommand) {
    return appCommand.command(command).description(describe).action(handler);
  },
};

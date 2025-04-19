const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");
const { ApiResponse } = require("../../types");

/**
 * Handler to stop an application.
 * Sends a stop request to the server for the specified app.
 * @param appName - Name of the application to stop
 * @param options - Command options
 * @returns ApiResponse with stop result
 */
interface StopOptions {}
async function handler(
  appName: string,
  options: StopOptions,
): Promise<typeof ApiResponse> {
  try {
    logger.debug(`Stopping application: ${appName}`);
    const response = await apiClient.post(`/api/apps/${appName}/stop`);
    if (response.success) {
      outputFormatter.formatOutput(
        { message: `Application '${appName}' stopped successfully.` },
        "table",
      );
      return response;
    } else {
      outputFormatter.formatOutput(
        {
          error: {
            code: response.error?.code || "STOP_FAILED",
            message: response.error?.message || "Application stop failed",
            details: response.error?.details,
          },
        },
        "table",
      );
      return {
        success: false,
        error: {
          code: response.error?.code || "STOP_FAILED",
          message: response.error?.message || "Application stop failed",
          details: response.error?.details,
        },
      };
    }
  } catch (error) {
    outputFormatter.formatOutput(
      {
        error: {
          code: error.code || "STOP_ERROR",
          message: error.message || "Unknown error",
          details: error.details,
        },
      },
      "table",
    );
    return {
      success: false,
      error: {
        code: error.code || "STOP_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
    };
  }
}

const command = "stop <appName>";
const describe = "Stop an application";

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

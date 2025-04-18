const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");
const { ApiResponse } = require("../../types");

/**
 * Handler to start an application.
 * Sends a start request to the server for the specified app.
 * @param appName - Name of the application to start
 * @param options - Command options
 * @returns ApiResponse with start result
 */
interface StartOptions {}
async function handler(
  appName: string,
  options: StartOptions,
): Promise<typeof ApiResponse> {
  try {
    logger.debug(`Starting application: ${appName}`);

    const response = await apiClient.post(`/api/apps/${appName}/start`);

    if (response.success) {
      outputFormatter.formatOutput(
        { message: `Application '${appName}' started successfully.` },
        "table",
      );
      return response;
    } else {
      outputFormatter.formatOutput(
        {
          error: {
            code: response.error?.code || "START_FAILED",
            message: `Failed to start application '${appName}'.`,
            details: response.error?.details,
          },
        },
        "table",
      );

      return {
        success: false,
        error: {
          code: response.error?.code || "START_FAILED",
          message: response.error?.message || "Application start failed",
          details: response.error?.details,
        },
      };
    }
  } catch (error) {
    outputFormatter.formatOutput(
      {
        error: {
          code: error.code || "START_ERROR",
          message: error.message || "Unknown error",
          details: error.details,
        },
      },
      "table",
    );

    // Always return ApiResponse error structure
    return {
      success: false,
      error: {
        code: error.code || "START_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
    };
  }
}

/**
 * CLI command string for starting an application.
 */
const command = "start <appName>";

/**
 * Description for the start command.
 */
const describe = "Start an application";

function builder(yargs) {
  return yargs;
}

/**
 * Registers the start command with the Commander appCommand instance.
 */
module.exports = {
  command,
  describe,
  builder,
  handler,
  default: function (appCommand) {
    return appCommand.command(command).description(describe).action(handler);
  },
};

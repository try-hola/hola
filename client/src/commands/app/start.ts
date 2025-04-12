const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");
const { ApiResponse } = require("../../types");

/**
 * Handler to start an application
 * @param {string} appName - Name of the application to start
 * @param {StartOptions} options - Command options
 * @returns {Promise<ApiResponse>}
 */
interface StartOptions {}
async function handler(appName: string, options: StartOptions): Promise<typeof ApiResponse> {
  try {
    logger.debug(`Starting application: ${appName}`);

    const response = await apiClient.post(`/api/apps/${appName}/start`);

    if (response.success) {
      console.log(`Application '${appName}' started successfully.`);
      return response;
    } else {
      console.error(`Failed to start application '${appName}'.`);
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

const command = "start <appName>";
const describe = "Start an application";

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

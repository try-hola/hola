const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const logger = require("../../utils/logger");
const { ApiResponse } = require("../../types");

/**
 * Handler to delete an application.
 * Sends a delete request to the server for the specified app.
 * @param appName - Name of the application to delete
 * @param options - Command options
 * @returns ApiResponse with delete result
 */
interface DeleteOptions {}
async function handler(
  appName: string,
  options: DeleteOptions,
): Promise<typeof ApiResponse> {
  try {
    logger.debug(`Deleting application: ${appName}`);
    const response = await apiClient.delete(`/api/apps/${appName}`);
    if (response.success) {
      outputFormatter.formatOutput(
        { message: `Application '${appName}' deleted successfully.` },
        "table",
      );
      return response;
    } else {
      outputFormatter.formatOutput(
        {
          error: {
            code: response.error?.code || "DELETE_FAILED",
            message: response.error?.message || "Application delete failed",
            details: response.error?.details,
          },
        },
        "table",
      );
      return {
        success: false,
        error: {
          code: response.error?.code || "DELETE_FAILED",
          message: response.error?.message || "Application delete failed",
          details: response.error?.details,
        },
      };
    }
  } catch (error) {
    outputFormatter.formatOutput(
      {
        error: {
          code: error.code || "DELETE_ERROR",
          message: error.message || "Unknown error",
          details: error.details,
        },
      },
      "table",
    );
    return {
      success: false,
      error: {
        code: error.code || "DELETE_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
    };
  }
}

const command = "delete <appName>";
const describe = "Delete an application";

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

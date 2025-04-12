const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");
const { AppInfoOptions, ApiResponse } = require("../../types");

/**
 * Handler to get detailed information about an application
 * @param {string} appName - Name of the application
 * @param {AppInfoOptions} options - Command options
 * @returns {Promise<ApiResponse<any>>}
 */
async function handler(appName: string, options: typeof AppInfoOptions): Promise<typeof ApiResponse> {
  try {
    logger.debug(`Fetching details for app: ${appName}`);

    const response = await apiClient.get(`/api/apps/${appName}`);

    if (response.success && response.data) {
      if (options.output === "json") {
        outputFormatter.formatOutput(response.data, "json");
      } else {
        const appDetails = response.data;

        if (appDetails.createdAt) {
          appDetails.createdAt = new Date(
            appDetails.createdAt
          ).toLocaleString();
        }

        if (appDetails.status) {
          appDetails.status =
            appDetails.status === "running"
              ? `${appDetails.status} ✓`
              : appDetails.status;
        }

        // Use formatOutput for heading and table
        outputFormatter.formatOutput(
          [{ property: "Application", value: appName }],
          "table"
        );
        const tableData = Object.entries(appDetails).map(([key, value]) => {
          if (typeof value === "object" && value !== null) {
            value = JSON.stringify(value);
          }
          return { property: key, value };
        });

        outputFormatter.formatOutput(tableData, "table");
      }

      return response;
    } else {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `No information found for application '${appName}'`,
        },
      };
    }
  } catch (error) {
    return {
      success: false,
      error: {
        code: error.code || "INFO_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
    };
  }
}

const command = "info <appName>";
const describe = "Show detailed information about an application";

function builder(yargs) {
  return yargs.option("output", {
    alias: "o",
    describe: "output format (table, json)",
    default: "table",
    type: "string",
  });
}

module.exports = {
  command,
  describe,
  builder,
  handler,
  default: function (appCommand) {
    return appCommand
      .command(command)
      .description(describe)
      .option("-o, --output <format>", "output format (table, json)", "table")
      .action(handler);
  },
};

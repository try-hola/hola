const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");
const { AppListOptions, ApiResponse } = require("../../types");

/**
 * Handler to list all deployed applications
 * @param {AppListOptions} options - Command options
 * @returns {Promise<ApiResponse<string[]>>}
 */
const handler = async (options: import("../../types").AppListOptions): Promise<import("../../types").ApiResponse> => {
  try {
    logger.debug("Fetching app list");

    const response = await apiClient.get("/api/apps");

    if (response.success && response.data && response.data.apps) {
      const apps = response.data.apps;
      outputFormatter.formatOutput(
        apps.length === 0
          ? { message: "No applications deployed" }
          : apps.map((name) => ({ name })),
        options.output
      );
      return { success: true, data: apps };
    } else {
      return {
        success: false,
        error: {
          code: response.error?.code || "LIST_FAILED",
          message: response.error?.message || "Failed to retrieve application list",
          details: response.error?.details,
        },
      };
    }
  } catch (error) {
    return {
      success: false,
      error: {
        code: error.code || "LIST_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
    };
  }
};

const command = "list";
const describe = "List all deployed applications";

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

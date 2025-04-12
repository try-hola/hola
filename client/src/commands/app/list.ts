const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");
const { ApiResponse } = require("../../types");

/**
 * Handler to list all deployed applications
 * @param {Object} options - Command options
 * @param {string} options.output - Output format (table or json)
 * @returns {Promise<ApiResponse>}
 */
const handler = async (options) => {
  try {
    logger.debug("Fetching app list");

    const response = await apiClient.get("/api/apps");

    if (response.success && response.data && response.data.apps) {
      const apps = response.data.apps;
      if (options.output === "json") {
        outputFormatter.json({ apps });
      } else {
        if (apps.length === 0) {
          console.log("No applications deployed");
        } else {
          outputFormatter.table(
            apps.map((name) => ({ name })),
            ["name"],
            { title: "Deployed Applications" }
          );
        }
      }
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

const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");

/**
 * Handler to get detailed information about an application
 * @param {string} appName - Name of the application
 * @param {Object} options - Command options
 * @param {string} options.output - Output format (table or json)
 */
async function handler(appName, options) {
  try {
    logger.debug(`Fetching details for app: ${appName}`);

    const response = await apiClient.get(`/api/apps/${appName}`);

    if (!response.data) {
      console.log(`No information found for application '${appName}'`);
      return {
        success: false,
        error: new Error("No application information found"),
      };
    }

    if (options.output === "json") {
      outputFormatter.formatOutput(response.data, "json");
    } else {
      const appDetails = response.data;

      if (appDetails.createdAt) {
        appDetails.createdAt = new Date(appDetails.createdAt).toLocaleString();
      }

      if (appDetails.status) {
        appDetails.status =
          appDetails.status === "running"
            ? `${appDetails.status} ✓`
            : appDetails.status;
      }

      console.log(`Application: ${appName}`);
      const tableData = Object.entries(appDetails).map(([key, value]) => {
        if (typeof value === "object" && value !== null) {
          value = JSON.stringify(value);
        }
        return { property: key, value };
      });

      outputFormatter.formatOutput(tableData, "table");
    }

    return { success: true, data: response.data };
  } catch (error) {
    return handleCommandError(error);
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

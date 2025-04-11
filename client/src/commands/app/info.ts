const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");

/**
 * Get detailed information about an application
 * @param {string} appName - Name of the application
 * @param {Object} options - Command options
 * @param {string} options.output - Output format (table or json)
 */
async function execute(appName, options) {
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

    // Format the output based on the user's preference
    if (options.output === "json") {
      outputFormatter.formatOutput(response.data, "json");
    } else {
      // Default to table output - we'll format app details in a readable way
      const appDetails = response.data;

      // Format creation date if available
      if (appDetails.createdAt) {
        appDetails.createdAt = new Date(appDetails.createdAt).toLocaleString();
      }

      // Format status to be more descriptive
      if (appDetails.status) {
        appDetails.status =
          appDetails.status === "running"
            ? `${appDetails.status} ✓`
            : appDetails.status;
      }

      // Create a formatted table of the app details
      console.log(`Application: ${appName}`);
      const tableData = Object.entries(appDetails).map(([key, value]) => {
        // Handle nested objects/arrays
        if (typeof value === "object" && value !== null) {
          value = JSON.stringify(value);
        }
        return { property: key, value: value };
      });

      outputFormatter.formatOutput(tableData, "table");
    }

    return { success: true, data: response.data };
  } catch (error) {
    return handleCommandError(error);
  }
}

module.exports = function (appCommand) {
  return appCommand
    .command("info <appName>")
    .description("Show detailed information about an application")
    .option("-o, --output <format>", "output format (table, json)", "table")
    .action(execute);
};

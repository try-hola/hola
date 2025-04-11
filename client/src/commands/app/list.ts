const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");

/**
 * List all deployed applications
 * @param {Object} options - Command options
 * @param {string} options.output - Output format (table or json)
 */
async function execute(options) {
  try {
    logger.debug("Fetching app list");

    // Ensure we're explicitly calling the correct endpoint
    const response = await apiClient.get("/api/apps");

    // Extract apps from response
    const apps = response.data.apps || [];

    if (apps.length === 0) {
      console.log("No applications deployed");
      return { success: true, data: [] };
    }

    // Format the output based on the user's preference
    if (options.output === "json") {
      outputFormatter.json({ apps });
    } else {
      // Default to table output
      const tableData = apps.map((appName) => ({ name: appName }));
      outputFormatter.table(tableData, ["name"], {
        title: "Deployed Applications",
      });
    }

    return { success: true, data: apps };
  } catch (error) {
    return handleCommandError(error);
  }
}

module.exports = function (appCommand) {
  return appCommand
    .command("list")
    .description("List all deployed applications")
    .option("-o, --output <format>", "output format (table, json)", "table")
    .action(execute);
};

const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");

/**
 * List all deployed applications
 */
async function execute(options) {
  try {
    // To be implemented
    // Will fetch applications from the API and display them
    console.log("Listing applications (to be implemented)");
    return { success: true };
  } catch (error) {
    return handleCommandError(error);
  }
}

module.exports = function(appCommand) {
  return appCommand
    .command("list")
    .description("List all deployed applications")
    .option("-o, --output <format>", "output format (table, json)", "table")
    .action(execute);
};

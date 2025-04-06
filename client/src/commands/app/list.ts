const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");

/**
 * List all deployed applications
 */
async function execute() {
  try {
    // To be implemented
    // Will fetch applications from the API and display them
    console.log("Listing applications (to be implemented)");
    return { success: true };
  } catch (error) {
    return handleCommandError(error);
  }
}

module.exports = {
  command: "list",
  describe: "List all deployed applications",
  builder: {},
  handler: execute,
};

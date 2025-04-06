const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");

/**
 * Get details about a deployed application
 * @param {Object} argv - Command arguments
 */
async function execute(argv) {
  try {
    const { appName } = argv;

    // To be implemented
    // Will fetch application details from the API and display them
    console.log(`Getting info for app: ${appName} (to be implemented)`);
    return { success: true };
  } catch (error) {
    return handleCommandError(error);
  }
}

module.exports = {
  command: "info <appName>",
  describe: "Get details about a deployed application",
  builder: {},
  handler: execute,
};

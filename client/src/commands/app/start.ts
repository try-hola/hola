const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");

/**
 * Handler to start an application
 * @param {string} appName - Name of the application to start
 * @param {Object} options - Command options
 */
async function handler(appName, options) {
  try {
    logger.debug(`Starting application: ${appName}`);

    const response = await apiClient.post(`/api/apps/${appName}/start`);

    if (response.data && response.data.success) {
      console.log(`Application '${appName}' started successfully.`);
      return { success: true, data: response.data };
    } else {
      console.error(`Failed to start application '${appName}'.`);
      return {
        success: false,
        error: new Error("Application start failed"),
      };
    }
  } catch (error) {
    return handleCommandError(error);
  }
}

const command = "start <appName>";
const describe = "Start an application";

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

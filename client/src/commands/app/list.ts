const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { handleCommandError } = require("../../utils/error-handler");
const logger = require("../../utils/logger");

/**
 * Handler to list all deployed applications
 * @param {Object} options - Command options
 * @param {string} options.output - Output format (table or json)
 */
async function handler(options) {
  try {
    logger.debug("Fetching app list");

    const response = await apiClient.get("/api/apps");
    const apps = response.data.apps || [];

    if (apps.length === 0) {
      console.log("No applications deployed");
      return { success: true, data: [] };
    }

    if (options.output === "json") {
      outputFormatter.json({ apps });
    } else {
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

/**
 * Logout command for removing authentication tokens
 */
const { Command } = require("commander");
const authManager = require("../../utils/auth-manager");
const configManager = require("../../utils/config-manager");
const outputFormatter = require("../../utils/output-formatter");

async function logoutHandler(options) {
  try {
    if (options.all) {
      const contexts = await configManager.getServerContexts();
      const serverNames = Object.keys(contexts);
      if (serverNames.length === 0) {
        return outputFormatter.formatOutput(
          "info",
          "No server contexts found.",
        );
      }
      for (const name of serverNames) {
        await authManager.logout(name);
      }
      return outputFormatter.formatOutput(
        "success",
        `Logged out from all ${serverNames.length} server contexts.`,
      );
    }
    const serverContext = await configManager.resolveServerContext(
      options.server,
    );
    if (!serverContext) {
      return outputFormatter.formatOutput(
        "error",
        "No server context found. Please specify a valid server with --server.",
      );
    }
    await authManager.logout(serverContext.name);
    outputFormatter.formatOutput(
      "success",
      `Logged out from server: ${serverContext.name}`,
    );
  } catch (error) {
    outputFormatter.formatOutput("error", `Logout failed: ${error.message}`);
  }
}

module.exports = function registerCommand(program) {
  return program
    .command("logout")
    .description("Log out from a Hola server")
    .option("-s, --server <name>", "target server context")
    .option("-a, --all", "log out from all servers")
    .action(logoutHandler);
};

// Export handler for direct testing
module.exports.handler = logoutHandler;

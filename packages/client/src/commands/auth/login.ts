/**
 * Login command for authenticating with a Hola server using OIDC
 */
const { Command } = require("commander");
const authManager = require("../../utils/auth-manager");
const configManager = require("../../utils/config-manager");
const outputFormatter = require("../../utils/output-formatter");

async function loginHandler(options) {
  try {
    const serverContext = await configManager.resolveServerContext(
      options.server,
    );
    if (!serverContext) {
      return outputFormatter.formatOutput(
        "error",
        "No server context found. Please bootstrap a server first.",
      );
    }
    await authManager.authenticate(serverContext);
    outputFormatter.formatOutput(
      "success",
      `Successfully authenticated with server: ${serverContext.name}`,
    );
  } catch (error) {
    outputFormatter.formatOutput("error", `Login failed: ${error.message}`);
  }
}

module.exports = function registerCommand(program) {
  return program
    .command("login")
    .description("Authenticate with a Hola server")
    .option("-s, --server <name>", "target server context")
    .action(loginHandler);
};

// Export handler for direct testing
module.exports.handler = loginHandler;

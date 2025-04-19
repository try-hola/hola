/**
 * Auth commands for the Hola CLI
 * Handles login, logout, and token management
 */
const { Command } = require("commander");

module.exports = function registerAuthCommands(program) {
  const authCommand = new Command("auth").description(
    "Authentication commands",
  );

  // Register all auth subcommands
  require("./login")(authCommand);
  require("./logout")(authCommand);

  program.addCommand(authCommand);
  return program;
};

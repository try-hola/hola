const { Command } = require("commander");

/**
 * Register all commands with the commander program
 */
function registerCommands(program) {
  // Register top-level command groups
  require("./app")(program);
  require("./config")(program);
  require("./settings")(program);
  require("./server")(program);
  require("./auth")(program);

  // Future command groups to be added in later phases
  /*
  require('./file')(program);
  require('./backup')(program);
  require('./logs')(program);
  */

  return program;
}

/**
 * Create and configure the main CLI program
 */
function createProgram() {
  const program = new Command();

  program
    .name("hola")
    .description("Hola CLI for application deployment and management")
    .version("0.1.0");

  // Register all commands
  registerCommands(program);

  // Add global options that apply to all commands
  program
    .option("-s, --server <name>", "target server context")
    .option(
      "-o, --output <format>",
      "output format (table, json, yaml)",
      "table",
    )
    .option("-v, --verbose", "enable verbose output", false);

  return program;
}

module.exports = {
  createProgram,
  registerCommands,
};

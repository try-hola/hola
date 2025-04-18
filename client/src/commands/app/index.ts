const { Command } = require("commander");
const listCommand = require("./list");
const infoCommand = require("./info");
const startCommand = require("./start");
const deployCommand = require("./deploy");
const stopCommand = require("./stop");
const restartCommand = require("./restart");

/**
 * Registers all application-related CLI commands (list, info, start, deploy) with the provided Commander program instance.
 * Adds the 'app' command group and its subcommands to the CLI.
 * @param program Commander program instance
 * @returns The configured Commander program instance
 */
module.exports = function registerAppCommands(program) {
  // Create the app command
  const appCommand = new Command("app").description(
    "Application management commands",
  );

  // Register all app subcommands
  listCommand(appCommand);
  infoCommand(appCommand);
  startCommand(appCommand);
  stopCommand(appCommand);
  restartCommand(appCommand);
  deployCommand(appCommand);

  // Add the app command to the main program
  program.addCommand(appCommand);

  return program;
};

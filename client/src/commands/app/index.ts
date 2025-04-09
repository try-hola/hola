const { Command } = require("commander");
const listCommand = require("./list");
const infoCommand = require("./info");

module.exports = function registerAppCommands(program) {
  // Create the app command
  const appCommand = new Command("app")
    .description("Application management commands");
  
  // Register all app subcommands
  listCommand(appCommand);
  infoCommand(appCommand);
  
  // Add the app command to the main program
  program.addCommand(appCommand);
  
  return program;
};

const { Command } = require("commander");
const getCommand = require("./get");
const setCommand = require("./set");
const deleteCommand = require("./delete");

module.exports = function registerConfigCommands(program) {
  // Create the config command
  const configCommand = new Command("config")
    .description("Configuration management commands");
  
  // Register all config subcommands
  getCommand.default(configCommand);
  setCommand.default(configCommand);
  deleteCommand(configCommand);
  
  // Add the config command to the main program
  program.addCommand(configCommand);
  
  return program;
};

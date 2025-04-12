/**
 * Registers all CLI command groups (app and config) with the provided Commander program instance.
 * @param program Commander program instance
 * @returns The configured Commander program instance
 */
// Register all commands
const appCommands = require("./app");
const configCommands = require("./config");
const settingsCommands = require("./settings");

module.exports = (program) => {
  // Register top-level command groups
  appCommands(program);
  configCommands(program);
  settingsCommands(program);
  
  return program;
};

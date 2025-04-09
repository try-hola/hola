// Register all commands
const appCommands = require("./app");
const configCommands = require("./config");

module.exports = (program) => {
  // Register top-level command groups
  appCommands(program);
  configCommands(program);
  
  return program;
};

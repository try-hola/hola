/**
 * Server command module that aggregates all server-related commands
 * This module will serve as the container for all server management commands,
 * allowing us to easily add more commands as we expand to other server types.
 */
const { Command } = require('commander');

module.exports = function registerServerCommands(program) {
  const serverCommand = new Command('server')
    .description('Server management commands');

  // Register all server subcommands
  require('./bootstrap')(serverCommand);
  require('./add')(serverCommand);
  
  // These commands will be implemented in later phases when we add multi-server support
  // They're stubbed here as placeholders to show the future structure
  /*
  require('./list')(serverCommand);
  require('./current')(serverCommand);
  require('./switch')(serverCommand);
  require('./remove')(serverCommand);
  require('./ping')(serverCommand);
  */
  
  program.addCommand(serverCommand);
  return program;
};
const { Command } = require("commander");

module.exports = function registerSettingsCommands(program) {
  const settingsCommand = new Command("settings").description(
    "Manage local client settings (stored in ~/.hola/config.json)"
  );

  require("./get")(settingsCommand);
  require("./set")(settingsCommand);

  program.addCommand(settingsCommand);
  return program;
};

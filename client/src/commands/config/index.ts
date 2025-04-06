module.exports = {
  command: "config",
  describe: "Configuration management commands",
  builder: (yargs: any) => {
    return yargs
      .command(require("./get"))
      .command(require("./set"))
      .command(require("./delete"))
      .demandCommand(1, "You need to specify a subcommand");
  },
  handler: () => {},
};

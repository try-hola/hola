module.exports = {
  command: "app",
  describe: "Application management commands",
  builder: (yargs: any) => {
    return yargs
      .command(require("./list"))
      .command(require("./info"))
      .demandCommand(1, "You need to specify a subcommand");
  },
  handler: () => {},
};

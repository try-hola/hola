module.exports = (yargs) => {
  return yargs
    .command(require("./app"))
    .command(require("./config"))
    .demandCommand(1, "You need to specify a command")
    .help()
    .alias("h", "help")
    .version()
    .alias("v", "version");
};

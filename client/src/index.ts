#!/usr/bin/env node

const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const registerCommands = require("./commands");
const logger = require("./utils/logger");

// Set up CLI
function main() {
  try {
    // Register all commands
    const cli = yargs(hideBin(process.argv));
    registerCommands(cli);

    // Add global options
    cli
      .option("server", {
        describe: "Specify server to use",
        type: "string",
      })
      .option("output", {
        describe: "Output format (table, json)",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("verbose", {
        describe: "Enable verbose output",
        type: "boolean",
        alias: "V",
      })
      .option("quiet", {
        describe: "Suppress all non-error output",
        type: "boolean",
        alias: "q",
      })
      .strictCommands()
      .epilogue("For more information, visit https://example.com/hola")
      .parse();
  } catch (error) {
    logger.error("CLI error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("An unexpected error occurred:", errorMessage);
    process.exit(1);
  }
}

// Execute main function
main();

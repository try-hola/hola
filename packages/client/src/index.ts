#!/usr/bin/env node

const { Command } = require("commander");
const registerCommands = require("./commands");
const logger = require("./utils/logger");

// Set up CLI
function main() {
  try {
    // Create the program instance
    const program = new Command();

    // Set basic program information
    program
      .name("hola")
      .description("Hola CLI for application deployment and management")
      .version(require("../package.json").version);

    // Register all commands
    registerCommands(program);

    // Add global options
    program
      .option("--server <name>", "Specify server to use")
      .option("-o, --output <format>", "Output format (table, json)", "table")
      .option("-V, --verbose", "Enable verbose output")
      .option("-q, --quiet", "Suppress all non-error output")
      .addHelpText(
        "after",
        "\nFor more information, visit https://example.com/hola",
      );

    // Parse command line arguments
    program.parse(process.argv);
  } catch (error) {
    logger.error("CLI error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("An unexpected error occurred:", errorMessage);
    process.exit(1);
  }
}

// Execute main function
main();

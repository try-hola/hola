const chalk = require("chalk");

class OutputFormatter {
  /**
   * Format output based on requested format
   * @param {any} data - Data to format
   * @param {string} format - Output format (table, json)
   */
  format(data, format = "table") {
    switch (format) {
      case "json":
        return this.formatJson(data);
      case "table":
      default:
        return this.formatTable(data);
    }
  }

  /**
   * Format data as a JSON string
   * @param {any} data - Data to format as JSON
   */
  formatJson(data) {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Format data as an ASCII table
   * @param {Array} data - Array of objects to format as table
   */
  formatTable(data) {
    // To be implemented
    // This will use a table formatting library later
    if (!Array.isArray(data) || data.length === 0) {
      return "No data to display";
    }

    return "Table output to be implemented";
  }

  /**
   * Print success message
   * @param {string} message - Success message
   */
  success(message) {
    console.log(chalk.green("✓"), message);
  }

  /**
   * Print warning message
   * @param {string} message - Warning message
   */
  warn(message) {
    console.log(chalk.yellow("!"), message);
  }

  /**
   * Print error message
   * @param {string} message - Error message
   */
  error(message) {
    console.error(chalk.red("✗"), message);
  }
}

module.exports = new OutputFormatter();

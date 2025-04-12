/**
 * Provides output formatting utilities for CLI commands.
 * Supports table, JSON, and custom formatting for user-facing output.
 */
const chalk = require("chalk");

/**
 * Utility for formatting and printing CLI output in various formats.
 * Supports table and JSON output for consistent user experience.
 */
class OutputFormatter {
  /**
   * Formats data as a string in the requested format.
   * @param {any} data - Data to format
   * @param {string} format - Output format (table, json)
   * @returns {string} Formatted string
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
   * Formats and prints data in the requested format.
   * @param {any} data - Data to format and print
   * @param {string} format - Output format (table, json)
   * @returns {string} Formatted string
   */
  formatOutput(data, format = "table") {
    const output = this.format(data, format);
    console.log(output);
    return output;
  }

  /**
   * Formats data as a pretty-printed JSON string.
   * @param {any} data - Data to format as JSON
   * @returns {string} JSON string
   */
  formatJson(data) {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Formats data as an ASCII table string.
   * @param {any} data - Data to format as table
   * @returns {string} Table string
   */
  formatTable(data) {
    // Handle configuration objects (key-value pairs)
    if (!Array.isArray(data) && typeof data === 'object' && data !== null) {
      // Convert object to array of key-value pairs
      const rows = Object.entries(data).map(([key, value]) => {
        return { Key: key, Value: this.stringifyValue(value) };
      });
      
      if (rows.length === 0) {
        return "No configuration values found";
      }
      
      // Simple table formatting
      const keyWidth = Math.max(...rows.map(row => row.Key.length), 'Key'.length);
      const valueWidth = Math.max(...rows.map(row => row.Value.length), 'Value'.length);
      
      // Table header
      let table = `+-${'-'.repeat(keyWidth)}-+-${'-'.repeat(valueWidth)}-+\n`;
      table += `| ${'Key'.padEnd(keyWidth)} | ${'Value'.padEnd(valueWidth)} |\n`;
      table += `+-${'-'.repeat(keyWidth)}-+-${'-'.repeat(valueWidth)}-+\n`;
      
      // Table rows
      for (const row of rows) {
        table += `| ${row.Key.padEnd(keyWidth)} | ${row.Value.padEnd(valueWidth)} |\n`;
      }
      
      // Table footer
      table += `+-${'-'.repeat(keyWidth)}-+-${'-'.repeat(valueWidth)}-+`;
      
      return table;
    }
    
    // Handle arrays of objects
    if (Array.isArray(data)) {
      if (data.length === 0) {
        return "No data to display";
      }
      
      // For arrays of objects, implement more complex table formatting later
      return this.formatJson(data);
    }
    
    // Handle primitives or other types
    return this.stringifyValue(data);
  }

  /**
   * Converts a value to a string representation for display.
   * @param {any} value - Value to stringify
   * @returns {string} String representation
   */
  stringifyValue(value) {
    if (value === undefined) {
      return '(undefined)';
    }
    if (value === null) {
      return '(null)';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * Prints a success message in green.
   * @param {string} message - Success message
   */
  success(message) {
    console.log(chalk.green("✓"), message);
  }

  /**
   * Prints a warning message in yellow.
   * @param {string} message - Warning message
   */
  warn(message) {
    console.log(chalk.yellow("!"), message);
  }

  /**
   * Prints an error message in red.
   * @param {string} message - Error message
   */
  error(message) {
    console.error(chalk.red("✗"), message);
  }
}

module.exports = new OutputFormatter();

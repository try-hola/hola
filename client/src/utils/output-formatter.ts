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
   * Format and print output based on requested format
   * @param {any} data - Data to format and print
   * @param {string} format - Output format (table, json)
   */
  formatOutput(data, format = "table") {
    const output = this.format(data, format);
    console.log(output);
    return output;
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
   * @param {any} data - Data to format as table
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
   * Convert a value to a string representation
   * @param {any} value - Value to stringify
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

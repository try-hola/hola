/**
 * Provides error handling utilities for CLI commands.
 * Formats errors into the standard ApiResponse structure.
 */
const logger = require("./logger");
const chalk = require("chalk");

/**
 * Handle API errors and provide helpful responses
 * @param {Error} error - Error object from API call
 */
function handleApiError(error) {
  // Extract error details
  const response = error.response;
  let errorCode = "UNKNOWN_ERROR";
  let message = "An unknown error occurred";
  let details = {};

  if (response) {
    errorCode = response.status;
    message = response.data?.error?.message || response.statusText;
    details = response.data?.error?.details || {};
  } else if (error.request) {
    // Request was made but no response received
    errorCode = "CONNECTION_ERROR";
    message = "Unable to connect to the server";
  } else {
    // Something else happened while setting up the request
    errorCode = "REQUEST_ERROR";
    message = error.message;
  }

  // Log the error
  logger.error(`API Error: ${errorCode} - ${message}`);
  logger.debug("Error details:", details);

  // Handle specific error types
  switch (errorCode) {
    case 401:
      console.error(
        chalk.red("Authentication failed. Please log in with your OIDC credentials.")
      );
      console.log(
        "Run: hola auth login"
      );
      break;
    case "CONNECTION_ERROR":
      console.error(chalk.red("Connection failed. Please check:"));
      console.log(" - The server is running and accessible");
      console.log(
        ` - Your server URL is correct: ${chalk.bold(
          require("./config-manager").get("server_url")
        )}`
      );
      console.log(" - Network connectivity is available");
      break;
    default:
      console.error(chalk.red(`Error: ${message}`));
      break;
  }

  // Return consistent error format
  return Promise.reject({
    success: false,
    error: {
      code: errorCode,
      message,
      details,
    },
  });
}

/**
 * Handle command errors consistently
 * @param {Error} error - Error from command execution
 */
function handleCommandError(error) {
  if (error.success === false && error.error) {
    // This is already a formatted API error
    return;
  }

  logger.error("Command error:", error);
  console.error(
    chalk.red("Error:"),
    error.message || "An unknown error occurred"
  );
  process.exit(1);
}

module.exports = {
  handleApiError,
  handleCommandError,
};

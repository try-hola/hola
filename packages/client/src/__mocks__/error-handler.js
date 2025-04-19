/**
 * Mock implementation of the error handler
 */

// Create mock functions for error handling operations
const handleCommandError = jest.fn().mockImplementation((error, errorCode) => {
  return {
    success: false,
    error: {
      code: error.code || errorCode || "UNKNOWN_ERROR",
      message: error.message || "Unknown error",
      details: error.details,
    },
  };
});

const createError = jest.fn().mockImplementation((code, message, details) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
});

// Reset all mocks
const resetMocks = () => {
  handleCommandError.mockReset().mockImplementation((error, errorCode) => {
    return {
      success: false,
      error: {
        code: error.code || errorCode || "UNKNOWN_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
    };
  });

  createError.mockReset().mockImplementation((code, message, details) => {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  });
};

// Export as CommonJS module
module.exports = {
  handleCommandError,
  createError,
  resetMocks,
};

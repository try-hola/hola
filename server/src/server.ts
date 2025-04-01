const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { registerRoutes } = require("./routes");
const { PORT } = require("./config");
const { logEvent } = require("./utils/logger");

/**
 * Sets up and configures the Express server application
 * @returns {import('express').Application} Configured Express application
 */
function setupServer() {
  const app = express();

  // Apply middleware
  app.use(cors());
  app.use(bodyParser.json({ limit: "50mb" }));
  app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

  // Request logging middleware
  app.use((req, res, next) => {
    logEvent("HTTP", "info", `${req.method} ${req.url}`);
    next();
  });

  // API key authentication middleware
  app.use((req, res, next) => {
    // Skip authentication in test environment
    if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) {
      return next();
    }

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      logEvent(
        "SECURITY",
        "warning",
        "No API key is configured. API is unsecured!"
      );
      return next();
    }

    const providedKey = req.headers["x-api-key"];
    if (!providedKey || providedKey !== apiKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    next();
  });

  // Register API routes
  registerRoutes(app);

  // 404 handler for undefined routes
  app.use((req, res) => {
    res.status(404).json({ error: "Not Found", path: req.path });
  });

  // Global error handler for uncaught exceptions
  app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    logEvent("ERROR", "error", `${err.message || "Unknown error"}`);
    console.error(err);

    res.status(statusCode).json({
      error: err.message || "Internal Server Error",
      status: statusCode,
    });
  });

  return app;
}

/**
 * Starts the server and sets up graceful shutdown handlers
 * @returns {import('http').Server} The HTTP server instance
 */
function startServer() {
  const app = setupServer();
  const port = PORT || 3000;

  const server = app.listen(port, () => {
    logEvent("SERVER", "info", `Server started on port ${port}`);
  });

  // Graceful shutdown handler
  function shutdown() {
    logEvent("SERVER", "info", "Server shutting down...");
    server.close(() => {
      logEvent("SERVER", "info", "Server stopped");
      process.exit(0);
    });
  }

  // Handle termination signals
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return server;
}

// Export for use in other modules
module.exports = {
  setupServer,
  startServer,
};

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}

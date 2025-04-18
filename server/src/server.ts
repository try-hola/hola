const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { registerRoutes } = require("./routes");
const { PORT } = require("./config");
const { logEvent } = require("./utils/logger");
import { Request, Response, NextFunction, Application } from "express";
import { Server } from "http";

/**
 * Sets up and configures the Express server application
 * @returns {Application} Configured Express application
 */
function setupServer() {
  const app = express();

  // Apply middleware
  app.use(cors());
  app.use(bodyParser.json({ limit: "50mb" }));
  app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction): void => {
    logEvent("HTTP", "info", `${req.method} ${req.url}`);
    next();
  });

  // Authentication middleware
  app.use(require("./middlewares/auth"));

  // Register API routes
  registerRoutes(app);

  // 404 handler for undefined routes
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "Not Found", path: req.path });
  });

  // Global error handler for uncaught exceptions
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
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
 * @returns {Server} The HTTP server instance
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

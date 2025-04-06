const winston = require("winston");
const path = require("path");
const os = require("os");
const fs = require("fs-extra");
const configManager = require("./config-manager");

// Create logs directory if it doesn't exist
const logsDir = path.join(os.homedir(), ".hola", "logs");
fs.ensureDirSync(logsDir);

const logger = winston.createLogger({
  level: configManager.get("log_level", "info"),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // Write logs to file
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(logsDir, "combined.log"),
    }),
  ],
});

// If not in production, also log to console
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}

module.exports = logger;

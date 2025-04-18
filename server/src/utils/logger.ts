/**
 * Categories for logging events
 */
type LogCategory =
  | "UPLOAD"
  | "DEPLOY"
  | "SECURITY"
  | "CONFIG"
  | "SYSTEM"
  | "TASK"
  | string;

/**
 * Severity levels for logging events
 */
type LogSeverity = "info" | "warning" | "error" | "debug";

/**
 * Logs an event with standardized formatting for consistent log entries
 *
 * @param category - The category of the log event
 * @param severity - The severity of the log event
 * @param message - The message to log
 */
export const logEvent = (
  category: LogCategory,
  severity: LogSeverity,
  message: string,
): void => {
  // Current timestamp in ISO format
  const timestamp = new Date().toISOString();

  // Log to console with proper formatting
  console.log(
    `[${timestamp}] [${category}] [${severity.toUpperCase()}] ${message}`,
  );

  // In a real application, you might want to add additional logging backends here
  // such as writing to a file, sending to a logging service, etc.
};

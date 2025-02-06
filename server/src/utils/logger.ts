export const logEvent = (
    category: string, // e.g., UPLOAD, DEPLOY, SECURITY
    status: "info" | "error" | "warning" | "progress",
    message: string,
    details?: Record<string, any> // Optional metadata
  ) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${category}] [${status.toUpperCase()}] ${message}`;
  
    if (details) {
      console.log(logMessage, JSON.stringify(details, null, 2)); // Pretty print details
    } else {
      console.log(logMessage);
    }
  };
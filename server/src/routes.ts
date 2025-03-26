import express, { Router } from "express";
import { 
  deployApp, 
  upgradeApp, 
  listApps, 
  getAppDetails, 
  removeApp,
  startApp,
  stopApp
} from "./controllers/apps.js";
import { uploadFile, handleFileUpload, getFile } from "./controllers/files.js";

/**
 * Register all application routes to an Express application
 * 
 * @param app Express application instance
 */
export function registerRoutes(app: express.Application): void {
  const router = Router();
  
  // App deployment and management routes
  router.post("/apps", deployApp);                            // Deploy a new app
  router.post("/apps/deploy", deployApp);                     // Alternative deploy endpoint
  router.get("/apps", listApps);                              // List all apps
  router.get("/apps/:appName/details", getAppDetails);        // Get app details
  router.post("/apps/:appName/upgrade", upgradeApp);          // Upgrade app
  router.delete("/apps/:appName", removeApp);                 // Remove app
  router.post("/apps/:appName/start", startApp);              // Start app
  router.post("/apps/:appName/stop", stopApp);                // Stop app
  
  // File management routes
  router.post("/apps/:appName/files", uploadFile, handleFileUpload); // Upload a file
  
  // Use a regular param and parse the full path in the controller
  router.get("/apps/:appName/files/:filePath", getFile);      // Get a file
  
  // Mount the router at the /api path prefix
  app.use("/api", router);
}

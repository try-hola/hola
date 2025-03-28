const express = require("express");
const { Router } = express;
const { 
  deployApp, 
  upgradeApp, 
  listApps, 
  getAppDetails, 
  removeApp,
  startApp,
  stopApp
} = require("./controllers/apps");
const { uploadFile, handleFileUpload, getFile, listFiles, deleteFile } = require("./controllers/files");
import { Express, Request, Response, NextFunction } from "express";

/**
 * Register all application routes to an Express application
 * 
 * @param app Express application instance
 */
// Define interface for controller functions
interface ControllerFunction {
  (req: Request, res: Response, next?: NextFunction): void | Promise<void>;
}

/**
 * Register all application routes to an Express application
 * 
 * @param app Express application instance
 */
function registerRoutes(app: Express): void {
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
  router.get("/apps/:appName/files", listFiles);              // List all files for an app
  
  // Use a regular param and parse the full path in the controller
  router.get("/apps/:appName/files/:filePath", getFile);      // Get a file
  router.delete("/apps/:appName/files/:filePath", deleteFile); // Delete a file
  
  // Mount the router at the /api path prefix
  app.use("/api", router);
}

module.exports = {
  registerRoutes
};

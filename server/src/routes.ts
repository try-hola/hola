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
import { uploadFile, handleFileUpload } from "./controllers/files.js";

/**
 * Register all application routes to an Express application
 * 
 * @param app Express application instance
 */
export function registerRoutes(app: express.Application): void {
  const router = Router();
  
  router.post("/apps", deployApp);
  router.get("/apps", listApps);
  router.get("/apps/:appName", getAppDetails);
  router.put("/apps/:appName", upgradeApp);
  router.delete("/apps/:appName", removeApp);
  router.post("/apps/:appName/start", startApp);
  router.post("/apps/:appName/stop", stopApp);
  router.post("/apps/:appName/files", uploadFile, handleFileUpload);
  
  // Mount the router at the base path
  app.use(router);
}

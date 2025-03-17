import { Router } from "express";
import { 
  deployApp, 
  upgradeApp, 
  listApps, 
  getAppDetails, 
  removeApp,
  startApp,
  stopApp
} from "./controllers/apps";
import { uploadFile, handleFileUpload } from "./controllers/files";

const router = Router();

router.post("/apps", deployApp);
router.get("/apps", listApps);
router.get("/apps/:appName", getAppDetails);
router.put("/apps/:appName", upgradeApp);
router.delete("/apps/:appName", removeApp);
router.post("/apps/:appName/start", startApp);
router.post("/apps/:appName/stop", stopApp);
router.post("/apps/:appName/files", uploadFile, handleFileUpload);

export const configRoutes = router;

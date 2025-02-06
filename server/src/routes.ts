import { Router } from "express";
import { deployApp, upgradeApp } from "./controllers/apps";
import { uploadFile, handleFileUpload } from "./controllers/files";

const router = Router();

router.post("/apps", deployApp);
router.put("/apps/:appName", upgradeApp);
router.post("/apps/:appName/files", uploadFile, handleFileUpload);

export const configRoutes = router;

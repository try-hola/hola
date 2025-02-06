import type { Request, Response } from "express";
import multer, { type Multer } from "multer";
import path from "path";
import fs from "fs-extra";
import { logEvent } from "../utils/logger";

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

// Set up Multer for file handling
const upload = multer({ storage: multer.memoryStorage() });

export const uploadFile = upload.single("file");

export const handleFileUpload = async (req: Request, res: Response) => {
  const { appName } = req.params;
  const { filePath } = req.body;
  const file = req.file as Express.Multer.File | undefined;

  if (!appName || !filePath || !file) {
    logEvent("UPLOAD", "error", `Missing required fields or file for ${appName}`);
    return res.status(400).json({ error: "Missing required fields or file" });
  }

  if (filePath.includes("..")) {
    logEvent("SECURITY", "warning", `Invalid filePath (path traversal attempt) for ${appName}: ${filePath}`);
    return res.status(400).json({ error: "Invalid filePath: Path traversal detected" });
  }

  const appBasePath = path.join("/deployments", appName);
  const targetFilePath = path.join(appBasePath, filePath);

  try {
    await fs.ensureDir(path.dirname(targetFilePath));
    await fs.writeFile(targetFilePath, file.buffer);

    logEvent("UPLOAD", "info", `File uploaded successfully`, { file: file.originalname, path: targetFilePath, size: file.size });
    return res.status(201).json({ message: "File uploaded successfully", path: targetFilePath });
  } catch (err) {
    logEvent("UPLOAD", "error", `Failed to save ${file.originalname} to ${targetFilePath}`, { error: err });
    return res.status(500).json({ error: "File upload failed" });
  }
};


export const getFile = (req: Request, res: Response) => {
    const { appName, filePath } = req.params;
    const fileFullPath = path.join("/deployments", appName, filePath);
  
    if (!fs.existsSync(fileFullPath)) {
      return res.status(404).json({ error: "File not found" });
    }
  
    res.sendFile(fileFullPath);
  };
  
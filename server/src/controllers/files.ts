import type { Request, RequestHandler, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs-extra";
import { logEvent } from "../utils/logger";
import { PATHS, isValidAppName } from "../config";

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

// Set up Multer for file handling
const upload = multer({ storage: multer.memoryStorage() });

export const uploadFile = upload.single("file");

/**
 * Handles file upload for a specific application.
 *
 * @param req - The request object containing the application name and file information.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the file upload is complete.
 */
export const handleFileUpload: RequestHandler = async (req, res) => {
  const { appName } = req.params;
  const { filePath } = req.body;
  const file = req.file;

  if (!appName || !filePath || !file) {
    logEvent("UPLOAD", "error", `Missing required fields or file for ${appName}`);
    res.status(400).json({ error: "Missing required fields or file" });
    return;
  }

  if (!isValidAppName(appName)) {
    logEvent("SECURITY", "warning", `Invalid app name: ${appName}`);
    res.status(400).json({ error: "Invalid app name" });
    return;
  }

  if (filePath.includes("..")) {
    logEvent("SECURITY", "warning", `Invalid filePath (path traversal attempt) for ${appName}: ${filePath}`);
    res.status(400).json({ error: "Invalid filePath: Path traversal detected" });
    return;
  }

  const appBasePath = PATHS.deployments.files(appName);
  const targetFilePath = path.join(appBasePath, filePath);

  try {
    // Ensure the app directory exists
    await fs.ensureDir(appBasePath);
    // Ensure the target directory exists
    await fs.ensureDir(path.dirname(targetFilePath));
    await fs.writeFile(targetFilePath, file.buffer);

    logEvent("UPLOAD", "info", `File uploaded successfully`, { file: file.originalname, path: targetFilePath, size: file.size });
    res.status(201).json({ message: "File uploaded successfully", path: targetFilePath });
  } catch (err) {
    logEvent("UPLOAD", "error", `Failed to save ${file.originalname} to ${targetFilePath}`, { error: err });
    res.status(500).json({ error: "File upload failed" });
  }
};

/**
 * Retrieves a file for a specific application.
 *
 * @param req - The request object containing the application name and file path.
 * @param res - The response object used to send back the requested file or error response.
 * @returns {void} - Does not return a promise; sends the file directly or an error response.
 */
export const getFile = (req: Request, res: Response) => {
  const { appName, filePath } = req.params;

  if (!isValidAppName(appName)) {
    return res.status(400).json({ error: "Invalid app name" });
  }

  const fileFullPath = path.join(PATHS.deployments.files(appName), filePath);

  if (!fs.existsSync(fileFullPath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.sendFile(fileFullPath);
};
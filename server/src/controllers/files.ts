const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");
const { logEvent } = require("../utils/logger");
const { PATHS, isValidAppName } = require("../config");
import type { Request, Response } from "express";

/**
 * Interface for the file object provided by multer
 */
interface MulterFile extends Express.Multer.File {
  /** Buffer containing the file data */
  buffer: Buffer;
}

// Set up Multer for file handling
const upload = multer({ storage: multer.memoryStorage() });

const uploadFile = upload.single("file");

/**
 * Handles file upload for a specific application.
 *
 * @param req - The request object containing the application name and file information.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns A promise that resolves when the file upload is complete.
 */
const handleFileUpload = async (req: Request, res: Response): Promise<void> => {
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
 * Lists all files for a specific application.
 *
 * @param req - The request object containing the application name.
 * @param res - The response object used to send back the list of files.
 * @returns A promise that resolves when the file list is generated.
 */
const listFiles = async (req: Request, res: Response): Promise<void> => {
  const { appName } = req.params;
  
  if (!isValidAppName(appName)) {
    res.status(400).json({ error: "Invalid app name" });
    return;
  }
  
  const appBasePath = PATHS.deployments.files(appName);
  
  try {
    // Ensure the directory exists
    await fs.ensureDir(appBasePath);
    
    // Get all files recursively
    const getFilesRecursively = async (dir: string): Promise<string[]> => {
      const dirEntries = await fs.readdir(dir, { withFileTypes: true });
      const files = await Promise.all(
        dirEntries.map(async (entry) => {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(appBasePath, fullPath);
          return entry.isDirectory() 
            ? await getFilesRecursively(fullPath) 
            : relativePath;
        })
      );
      return Array.prototype.concat(...files);
    };
    
    const filePaths = await getFilesRecursively(appBasePath);
    
    // Convert paths to file objects with path property as expected by tests
    const files = filePaths.map(filePath => ({
      path: filePath,
      name: path.basename(filePath)
    }));
    
    res.status(200).json({ 
      files,
      count: files.length
    });
  } catch (err) {
    logEvent("FILES", "error", `Failed to list files for ${appName}`, { error: err });
    res.status(500).json({ error: "Failed to list files" });
  }
};

/**
 * Deletes a file for a specific application.
 *
 * @param req - The request object containing the application name and file path.
 * @param res - The response object used to send back the response.
 * @returns A promise that resolves when the file deletion is complete.
 */
const deleteFile = async (req: Request, res: Response): Promise<void> => {
  const { appName, filePath } = req.params;
  
  if (!isValidAppName(appName)) {
    res.status(400).json({ error: "Invalid app name" });
    return;
  }
  
  if (filePath.includes("..")) {
    logEvent("SECURITY", "warning", `Invalid filePath (path traversal attempt) for ${appName}: ${filePath}`);
    res.status(400).json({ error: "Invalid filePath: Path traversal detected" });
    return;
  }
  
  const fileFullPath = path.join(PATHS.deployments.files(appName), filePath);
  
  try {
    if (!await fs.pathExists(fileFullPath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    
    await fs.remove(fileFullPath);
    
    logEvent("FILES", "info", `File deleted successfully`, { path: fileFullPath });
    res.status(200).json({ message: "File deleted successfully" });
  } catch (err) {
    logEvent("FILES", "error", `Failed to delete file ${filePath} for ${appName}`, { error: err });
    res.status(500).json({ error: "Failed to delete file" });
  }
};

/**
 * Retrieves a file for a specific application.
 *
 * @param req - The request object containing the application name and file path.
 * @param res - The response object used to send back the requested file or error response.
 */
const getFile = (req: Request, res: Response): void => {
  const { appName, filePath } = req.params;

  if (!isValidAppName(appName)) {
    res.status(400).json({ error: "Invalid app name" });
    return;
  }

  const fileFullPath = path.join(PATHS.deployments.files(appName), filePath);

  if (!fs.existsSync(fileFullPath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.sendFile(fileFullPath);
};

// Export using CommonJS syntax
module.exports = {
  uploadFile,
  handleFileUpload,
  getFile,
  listFiles,
  deleteFile
};
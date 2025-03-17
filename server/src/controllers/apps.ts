import type { RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";
import { DockerRunner } from "../utils/docker.js";
import { sendUpdate } from "../utils/updates.js";
import { OrasRunner } from "../utils/oras.js";
import { PATHS, ORAS_REGISTRY, STORAGE_ROOT } from "../config.js";
import fsExtra from "fs-extra";
import path from "path";
import * as tar from "tar";
import fs from 'fs/promises';

/**
 * Deploys an application.
 *
 * @param req - The request object containing the application name in the body.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the deployment is complete.
 */
export const deployApp: RequestHandler = async (req, res) => {
  const { appName, version = "latest" } = req.body;
  if (!appName) {
    res.status(400).json({ error: "Missing app name" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const taskId = uuidv4();
  const oras = new OrasRunner();
  const docker = new DockerRunner();

  // Handle status updates from both runners
  oras.on("status", (update) => {
    sendUpdate(res, update.taskId, update.taskType, update.status, update.message);
  });

  docker.on("status", (update) => {
    sendUpdate(res, update.taskId, update.taskType, update.status, update.message);
  });

  try {
    // Ensure package directory exists
    const packageDir = PATHS.packages(appName, version);
    await fsExtra.ensureDir(packageDir);

    // First download the app
    await oras.runCommand(
      taskId,
      "DOWNLOAD",
      ORAS_REGISTRY,
      appName,
      {
        outputDir: packageDir,
        version
      }
    );

    // Prepare deployment directories
    const deploymentDir = PATHS.deployments.root(appName);
    const currentDir = PATHS.deployments.current(appName);
    const composeDir = PATHS.deployments.compose(appName);

    await fsExtra.ensureDir(deploymentDir);
    await fsExtra.emptyDir(currentDir);
    await fsExtra.ensureDir(composeDir);

    // Extract the package to current directory
    const packagePath = path.join(packageDir, "bundle.tgz");
    await fsExtra.createReadStream(packagePath).pipe(tar.extract({ cwd: currentDir }));

    // Copy docker-compose file to compose directory
    const composeFile = path.join(currentDir, "docker-compose.yml");
    if (await fsExtra.pathExists(composeFile)) {
      await fsExtra.copy(composeFile, path.join(composeDir, "docker-compose.yml"));
    }

    // Then deploy it using the compose directory
    await docker.runCommand(
      taskId, 
      "DEPLOY", 
      ["up", "-d"], 
      appName,
      {
        cwd: composeDir
      }
    );

    res.end();
  } catch (error) {
    sendUpdate(res, taskId, "DEPLOY", "error", (error as Error).message);
    res.end();
  }
};

/**
 * Upgrades an application to a new version.
 *
 * @param req - The request object containing the application name in the params and the version in the body.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the upgrade is complete.
 */
export const upgradeApp: RequestHandler = async (req, res) => {
  const { appName } = req.params;
  const { version = "latest" } = req.body;
  
  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const taskId = uuidv4();
  const oras = new OrasRunner();
  const docker = new DockerRunner();

  // Handle status updates from both runners
  oras.on("status", (update) => {
    sendUpdate(res, update.taskId, update.taskType, update.status, update.message);
  });

  docker.on("status", (update) => {
    sendUpdate(res, update.taskId, update.taskType, update.status, update.message);
  });

  try {
    // Backup existing deployment
    const backupDir = path.join(PATHS.backups(appName, new Date().toISOString()));
    await fsExtra.ensureDir(backupDir);
    
    const currentDir = PATHS.deployments.current(appName);
    const composeDir = PATHS.deployments.compose(appName);
    
    // Backup current deployment if it exists
    if (await fsExtra.pathExists(currentDir)) {
      await fsExtra.copy(currentDir, path.join(backupDir, "current"));
    }
    
    // Download new version
    const packageDir = PATHS.packages(appName, version);
    await fsExtra.ensureDir(packageDir);
    
    await oras.runCommand(
      taskId,
      "DOWNLOAD",
      ORAS_REGISTRY,
      appName,
      {
        outputDir: packageDir,
        version
      }
    );
    
    // Update deployment directories
    await fsExtra.emptyDir(currentDir);
    
    // Extract the package to current directory
    const packagePath = path.join(packageDir, "bundle.tgz");
    await fsExtra.createReadStream(packagePath).pipe(tar.extract({ cwd: currentDir }));
    
    // Copy docker-compose file to compose directory
    const composeFile = path.join(currentDir, "docker-compose.yml");
    if (await fsExtra.pathExists(composeFile)) {
      await fsExtra.copy(composeFile, path.join(composeDir, "docker-compose.yml"));
    }
    
    // Restart with new version
    await docker.runCommand(
      taskId, 
      "UPGRADE", 
      ["up", "-d"], 
      appName,
      {
        cwd: composeDir
      }
    );
    
    res.end();
  } catch (error) {
    sendUpdate(res, taskId, "UPGRADE", "error", (error as Error).message);
    res.end();
  }
};

/**
 * Lists all deployed applications.
 *
 * @param req - The request object.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the list of applications is retrieved.
 */
export const listApps: RequestHandler = async (req, res) => {
  const taskId = uuidv4();
  const docker = new DockerRunner();
  
  try {
    // Use Docker runner to list containers
    const deploymentsDir = path.join(STORAGE_ROOT, "deployments");
    
    // Just list directories in the deployments folder
    const appDirs = await fs.readdir(deploymentsDir);
    const apps = [];
    for (const dir of appDirs) {
      const fullPath = path.join(deploymentsDir, dir);
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        apps.push(dir);
      }
    }
    
    res.json({ apps });
  } catch (error) {
    res.status(500).json({ error: "Failed to list applications", details: (error as Error).message });
  }
};

/**
 * Retrieves details of a specific application.
 *
 * @param req - The request object containing the application name in the params.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application details are retrieved.
 */
export const getAppDetails: RequestHandler = async (req, res) => {
  const taskId = uuidv4();
  const { appName } = req.params;
  const docker = new DockerRunner();
  
  try {
    // Check if the app directory exists
    const appDir = PATHS.deployments.root(appName);
    if (!await fsExtra.pathExists(appDir)) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    
    // Get running status from Docker
    let containerStatus = "unknown";
    try {
      // Run docker ps to get container info
      const { code, output } = await docker.runCommand(
        taskId,
        "INSPECT",
        ["ps", "--format", "{{.Status}}", "--filter", `name=${appName}`],
        appName
      );
      
      if (code === 0) {
        containerStatus = output.trim() || "not running";
      } else {
        containerStatus = "not running";
      }
    } catch (e) {
      containerStatus = "not running";
    }
    
    // Get configuration files
    const configPath = path.join(PATHS.config(appName), "config.json");
    let config = {};
    
    if (await fsExtra.pathExists(configPath)) {
      config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    }
    
    // List uploaded files
    const filesDir = PATHS.deployments.files(appName);
    let files: string[] = [];
    
    if (await fsExtra.pathExists(filesDir)) {
      // Recursively list files
      files = await fs.readdir(filesDir);
    }
    
    res.json({
      appName,
      status: containerStatus,
      config,
      files
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get application details", details: (error as Error).message });
  }
};

/**
 * Removes a specific application.
 *
 * @param req - The request object containing the application name in the params.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application is removed.
 */
export const removeApp: RequestHandler = async (req, res) => {
  const { appName } = req.params;
  const taskId = uuidv4();
  const docker = new DockerRunner();
  
  try {
    // Set up SSE headers for progress updates
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    docker.on("status", (update) => {
      sendUpdate(res, update.taskId, update.taskType, update.status, update.message);
    });
    
    // Stop and remove containers
    const composeDir = PATHS.deployments.compose(appName);
    
    if (await fsExtra.pathExists(composeDir)) {
      await docker.runCommand(
        taskId,
        "REMOVE",
        ["down", "--volumes", "--remove-orphans"],
        appName,
        {
          cwd: composeDir
        }
      );
    }
    
    // Optionally: keep a backup before removal
    const backupDir = path.join(PATHS.backups(appName, `removal-${new Date().toISOString()}`));
    await fsExtra.ensureDir(path.dirname(backupDir));
    
    const appDir = PATHS.deployments.root(appName);
    if (await fsExtra.pathExists(appDir)) {
      await fsExtra.copy(appDir, backupDir);
      await fsExtra.remove(appDir);
    }
    
    sendUpdate(res, taskId, "REMOVE", "complete", `Application ${appName} removed successfully`);
    res.end();
  } catch (error) {
    sendUpdate(res, taskId, "REMOVE", "error", (error as Error).message);
    res.end();
  }
};

/**
 * Starts a specific application.
 *
 * @param req - The request object containing the application name in the params.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application is started.
 */
export const startApp: RequestHandler = async (req, res) => {
  const { appName } = req.params;
  const taskId = uuidv4();
  const docker = new DockerRunner();
  
  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  docker.on("status", (update) => {
    sendUpdate(res, update.taskId, update.taskType, update.status, update.message);
  });
  
  try {
    const composeDir = PATHS.deployments.compose(appName);
    
    if (!await fsExtra.pathExists(composeDir)) {
      sendUpdate(res, taskId, "START", "error", `Application ${appName} not found`);
      res.end();
      return;
    }
    
    await docker.runCommand(
      taskId,
      "START",
      ["up", "-d"],
      appName,
      {
        cwd: composeDir
      }
    );
    
    sendUpdate(res, taskId, "START", "complete", `Application ${appName} started successfully`);
    res.end();
  } catch (error) {
    sendUpdate(res, taskId, "START", "error", (error as Error).message);
    res.end();
  }
};

/**
 * Stops a specific application.
 *
 * @param req - The request object containing the application name in the params.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application is stopped.
 */
export const stopApp: RequestHandler = async (req, res) => {
  const { appName } = req.params;
  const taskId = uuidv4();
  const docker = new DockerRunner();
  
  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  docker.on("status", (update) => {
    sendUpdate(res, update.taskId, update.taskType, update.status, update.message);
  });
  
  try {
    const composeDir = PATHS.deployments.compose(appName);
    
    if (!await fsExtra.pathExists(composeDir)) {
      sendUpdate(res, taskId, "STOP", "error", `Application ${appName} not found`);
      res.end();
      return;
    }
    
    await docker.runCommand(
      taskId,
      "STOP",
      ["stop"],
      appName,
      {
        cwd: composeDir
      }
    );
    
    sendUpdate(res, taskId, "STOP", "complete", `Application ${appName} stopped successfully`);
    res.end();
  } catch (error) {
    sendUpdate(res, taskId, "STOP", "error", (error as Error).message);
    res.end();
  }
};

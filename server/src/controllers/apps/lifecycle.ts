const { v4: uuidv4 } = require("uuid");
const { DockerRunner } = require("../../utils/docker");
const { sendUpdate } = require("../../utils/updates");
const { OrasRunner } = require("../../utils/oras");
const { logEvent } = require("../../utils/logger");
const { PATHS, ORAS_REGISTRY, isValidAppName } = require("../../config");
import * as fs from "fs-extra";
const path = require("path");
const tar = require("tar");
// Import types directly from @types/express
import { Request, Response } from "express";

/**
 * Interface for deployApp request body
 */
interface DeployAppRequestBody {
  appName: string;
  version?: string;
}

/**
 * Interface for status updates
 */
interface StatusUpdate {
  taskId: string;
  taskType: string;
  status: string;
  message: string;
}

/**
 * Deploys an application.
 *
 * @param req - The request object containing the application name in the body.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the deployment is complete.
 */
const deployApp = async (req: Request, res: Response): Promise<void> => {
  const { appName, version = "latest" } = req.body;
  if (!appName) {
    res.status(400).json({ error: "Missing app name" });
    return;
  }
  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Connection", "keep-alive");

  const taskId: string = uuidv4();
  const oras = new OrasRunner();
  const docker = new DockerRunner();

  // Handle status updates from both runners
  oras.on("status", (update: StatusUpdate) => {
    sendUpdate(
      res,
      update.taskId,
      update.taskType,
      update.status,
      update.message
    );
  });

  docker.on("status", (update: StatusUpdate) => {
    sendUpdate(
      res,
      update.taskId,
      update.taskType,
      update.status,
      update.message
    );
  });

  try {
    // Ensure package directory exists
    const packageDir: string = PATHS.packages.version(appName, version);
    await fs.ensureDir(packageDir);

    // First download the app
    await oras.runCommand(taskId, "DOWNLOAD", ORAS_REGISTRY, appName, {
      outputDir: packageDir,
      version,
    });

    // Prepare deployment directories
    const deploymentDir: string = PATHS.deployments.root(appName);
    const currentDir: string = PATHS.deployments.current(appName);
    const composeDir: string = PATHS.deployments.compose(appName);

    await fs.ensureDir(deploymentDir);
    await fs.emptyDir(currentDir);
    await fs.ensureDir(composeDir);

    // Extract the package to current directory
    const packagePath: string = path.join(packageDir, "bundle.tgz");
    // Create extract directory and extract the tar file
    await fs.ensureDir(currentDir);
    await tar.extract({
      file: packagePath,
      cwd: currentDir,
    });

    // Copy docker-compose file to compose directory
    const composeFile: string = path.join(currentDir, "docker-compose.yml");
    if (await fs.pathExists(composeFile)) {
      await fs.copy(composeFile, path.join(composeDir, "docker-compose.yml"));
    }

    // Then deploy it using the compose directory
    await docker.runCommand(taskId, "DEPLOY", ["up", "-d"], appName, {
      cwd: composeDir,
    });

    res.end();
  } catch (error: any) {
    sendUpdate(res, taskId, "DEPLOY", "error", error.message);
    res.end();
  }
};

/**
 * Interface for upgradeApp request params
 */
interface UpgradeAppRequestParams {
  appName: string;
}

/**
 * Interface for upgradeApp request body
 */
interface UpgradeAppRequestBody {
  version?: string;
}

/**
 * Upgrades an application to a new version.
 *
 * @param req - The request object containing the application name in the params and the version in the body.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the upgrade is complete.
 */
const upgradeApp = async (
  req: Request<UpgradeAppRequestParams, {}, UpgradeAppRequestBody>,
  res: Response
): Promise<void> => {
  const { appName } = req.params;
  const { version = "latest" } = req.body;

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const taskId: string = uuidv4();
  const oras = new OrasRunner();
  const docker = new DockerRunner();

  // Handle status updates from both runners
  oras.on("status", (update: StatusUpdate) => {
    sendUpdate(
      res,
      update.taskId,
      update.taskType,
      update.status,
      update.message
    );
  });

  docker.on("status", (update: StatusUpdate) => {
    sendUpdate(
      res,
      update.taskId,
      update.taskType,
      update.status,
      update.message
    );
  });

  try {
    // Create timestamp for the backup
    const timestamp = new Date().toISOString();

    // Ensure the root backup directory exists first
    const backupsRootDir: string = PATHS.backups.root(appName);
    await fs.ensureDir(backupsRootDir);

    // Create the timestamped backup directory
    const backupDir: string = PATHS.backups.timestamp(appName, timestamp);
    await fs.ensureDir(backupDir);

    // Create files and config directories inside the backup
    const backupFilesDir = PATHS.backups.files(appName, timestamp);
    await fs.ensureDir(backupFilesDir);

    const backupConfigDir = PATHS.backups.config(appName, timestamp);
    await fs.ensureDir(backupConfigDir);

    // Backup existing deployment
    const currentDir: string = PATHS.deployments.current(appName);
    const composeDir: string = PATHS.deployments.compose(appName);

    // Backup current deployment if it exists
    if (await fs.pathExists(currentDir)) {
      await fs.copy(currentDir, path.join(backupFilesDir, "current"));
    }

    // Backup compose files if they exist
    if (await fs.pathExists(composeDir)) {
      await fs.copy(composeDir, path.join(backupConfigDir, "compose"));
    }

    // Create backup metadata file
    const metadata = {
      timestamp,
      appName,
      version: version,
      backupType: "upgrade",
      createdAt: new Date().toISOString(),
    };

    await fs.writeJSON(PATHS.backups.metadata(appName, timestamp), metadata);

    // Double-check that backup directory exists before proceeding
    const backupDirExists = await fs.pathExists(backupDir);
    if (!backupDirExists) {
      sendUpdate(
        res,
        taskId,
        "UPGRADE",
        "warning",
        `Failed to create backup directory: ${backupDir}`
      );
      // Recreate it as a fallback
      await fs.ensureDir(backupDir);
      await fs.ensureDir(backupFilesDir);
      await fs.ensureDir(backupConfigDir);
    }

    // Download new version
    const packageDir: string = PATHS.packages.version(appName, version);
    await fs.ensureDir(packageDir);

    await oras.runCommand(taskId, "DOWNLOAD", ORAS_REGISTRY, appName, {
      outputDir: packageDir,
      version,
    });

    // Update deployment directories
    await fs.emptyDir(currentDir);

    // Extract the package to current directory
    const packagePath: string = path.join(packageDir, "bundle.tgz");
    // Create extract directory and extract the tar file
    await fs.ensureDir(currentDir);
    await tar.extract({
      file: packagePath,
      cwd: currentDir,
    });

    // Copy docker-compose file to compose directory
    const composeFile: string = path.join(currentDir, "docker-compose.yml");
    if (await fs.pathExists(composeFile)) {
      await fs.copy(composeFile, path.join(composeDir, "docker-compose.yml"));
    }

    // Restart with new version
    await docker.runCommand(taskId, "UPGRADE", ["up", "-d"], appName, {
      cwd: composeDir,
    });

    res.end();
  } catch (error: any) {
    sendUpdate(res, taskId, "UPGRADE", "error", error.message);
    res.end();
  }
};

/**
 * Interface for removeApp request params
 */
interface RemoveAppRequestParams {
  appName: string;
}

/**
 * Removes a specific application.
 *
 * @param req - The request object containing the application name in the params.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application is removed.
 */
const removeApp = async (
  req: Request<RemoveAppRequestParams>,
  res: Response
): Promise<void> => {
  const { appName } = req.params;
  const taskId: string = uuidv4();
  const docker = new DockerRunner();

  // Set up SSE headers for progress updates
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  docker.on("status", (update: StatusUpdate) => {
    sendUpdate(
      res,
      update.taskId,
      update.taskType,
      update.status,
      update.message
    );
  });

  try {
    // Create a backup before removing the app
    const timestamp = new Date().toISOString();

    // Ensure the root backup directory exists first
    const backupsRootDir: string = PATHS.backups.root(appName);
    await fs.ensureDir(backupsRootDir);

    // Create the timestamped backup directory
    const backupDir: string = PATHS.backups.timestamp(appName, timestamp);
    await fs.ensureDir(backupDir);

    // Create files and config directories inside the backup
    const backupFilesDir = PATHS.backups.files(appName, timestamp);
    await fs.ensureDir(backupFilesDir);

    const backupConfigDir = PATHS.backups.config(appName, timestamp);
    await fs.ensureDir(backupConfigDir);

    // Back up current deployment files and compose configs
    const currentDir: string = PATHS.deployments.current(appName);
    const composeDir: string = PATHS.deployments.compose(appName);

    if (await fs.pathExists(currentDir)) {
      await fs.copy(currentDir, path.join(backupFilesDir, "current"));
    }

    if (await fs.pathExists(composeDir)) {
      await fs.copy(composeDir, path.join(backupConfigDir, "compose"));
    }

    // Create backup metadata
    const metadata = {
      timestamp,
      appName,
      backupType: "remove",
      createdAt: new Date().toISOString(),
    };

    await fs.writeJSON(PATHS.backups.metadata(appName, timestamp), metadata);

    // Safety check - ensure backup directory was created properly before continuing
    const backupDirExists = await fs.pathExists(backupDir);
    if (!backupDirExists) {
      sendUpdate(
        res,
        taskId,
        "REMOVE",
        "warning",
        `Failed to create backup directory: ${backupDir}`
      );
      // Recreate it as a fallback
      await fs.ensureDir(backupDir);
      await fs.ensureDir(backupFilesDir);
      await fs.ensureDir(backupConfigDir);

      // Recreate metadata file
      await fs.writeJSON(PATHS.backups.metadata(appName, timestamp), metadata);
    }

    // Stop and remove containers
    const composeDirPath: string = PATHS.deployments.compose(appName);

    if (await fs.pathExists(composeDirPath)) {
      await docker.runCommand(
        taskId,
        "REMOVE",
        ["down", "--volumes", "--remove-orphans"],
        appName,
        {
          cwd: composeDirPath,
        }
      );
    }

    // Remove app directory
    const appDir: string = PATHS.deployments.root(appName);
    if (await fs.pathExists(appDir)) {
      await fs.remove(appDir);
    }

    sendUpdate(
      res,
      taskId,
      "REMOVE",
      "complete",
      `Application ${appName} removed successfully`
    );
    res.end();
  } catch (error: any) {
    sendUpdate(res, taskId, "REMOVE", "error", error.message);
    res.end();
  }
};

/**
 * Interface for startApp request params
 */
interface StartAppRequestParams {
  appName: string;
}

/**
 * Starts a specific application.
 *
 * @param req - The request object containing the application name in the params.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application is started.
 */
const startApp = async (
  req: Request<StartAppRequestParams>,
  res: Response
): Promise<void> => {
  const { appName } = req.params;
  const taskId: string = uuidv4();
  const docker = new DockerRunner();

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  docker.on("status", (update: StatusUpdate) => {
    sendUpdate(
      res,
      update.taskId,
      update.taskType,
      update.status,
      update.message
    );
  });

  try {
    const composeDir: string = PATHS.deployments.compose(appName);

    if (!(await fs.pathExists(composeDir))) {
      sendUpdate(
        res,
        taskId,
        "START",
        "error",
        `Application ${appName} not found`
      );
      res.end();
      return;
    }

    await docker.runCommand(taskId, "START", ["up", "-d"], appName, {
      cwd: composeDir,
    });

    sendUpdate(
      res,
      taskId,
      "START",
      "complete",
      `Application ${appName} started successfully`
    );
    res.end();
  } catch (error: any) {
    sendUpdate(res, taskId, "START", "error", error.message);
    res.end();
  }
};

/**
 * Interface for stopApp request params
 */
interface StopAppRequestParams {
  appName: string;
}

/**
 * Stops a specific application.
 *
 * @param req - The request object containing the application name in the params.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application is stopped.
 */
const stopApp = async (
  req: Request<StopAppRequestParams>,
  res: Response
): Promise<void> => {
  const { appName } = req.params;
  const taskId: string = uuidv4();
  const docker = new DockerRunner();

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  docker.on("status", (update: StatusUpdate) => {
    sendUpdate(
      res,
      update.taskId,
      update.taskType,
      update.status,
      update.message
    );
  });

  try {
    const composeDir: string = PATHS.deployments.compose(appName);

    if (!(await fs.pathExists(composeDir))) {
      sendUpdate(
        res,
        taskId,
        "STOP",
        "error",
        `Application ${appName} not found`
      );
      res.end();
      return;
    }

    await docker.runCommand(taskId, "STOP", ["stop"], appName, {
      cwd: composeDir,
    });

    sendUpdate(
      res,
      taskId,
      "STOP",
      "complete",
      `Application ${appName} stopped successfully`
    );
    res.end();
  } catch (error: any) {
    sendUpdate(res, taskId, "STOP", "error", error.message);
    res.end();
  }
};

/**
 * Interface for restartApp request params
 */
interface RestartAppRequestParams {
  appName: string;
}

/**
 * Restarts a specific application.
 *
 * @param req - The request object containing the application name in the params.
 * @param res - The response object used to send back the desired HTTP response.
 * @returns {Promise<void>} - A promise that resolves when the application is restarted.
 */
const restartApp = async (
  req: Request<RestartAppRequestParams>,
  res: Response
): Promise<void> => {
  const { appName } = req.params;
  const taskId: string = uuidv4();
  const docker = new DockerRunner();

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  docker.on("status", (update: StatusUpdate) => {
    sendUpdate(
      res,
      update.taskId,
      update.taskType,
      update.status,
      update.message
    );
  });

  try {
    const composeDir: string = PATHS.deployments.compose(appName);

    if (!(await fs.pathExists(composeDir))) {
      sendUpdate(
        res,
        taskId,
        "RESTART",
        "error",
        `Application ${appName} not found`
      );
      res.end();
      return;
    }

    await docker.runCommand(taskId, "RESTART", ["restart"], appName, {
      cwd: composeDir,
    });

    sendUpdate(
      res,
      taskId,
      "RESTART",
      "complete",
      `Application ${appName} restarted successfully`
    );
    res.end();
  } catch (error: any) {
    sendUpdate(res, taskId, "RESTART", "error", error.message);
    res.end();
  }
};

module.exports = {
  deployApp,
  upgradeApp,
  removeApp,
  startApp,
  stopApp,
  restartApp,
};

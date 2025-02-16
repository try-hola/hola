import type { RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";
import { DockerRunner } from "../utils/docker";
import { sendUpdate } from "../utils/updates";

export const deployApp: RequestHandler = async (req, res) => {
  const { appName } = req.body;
  if (!appName) {
    res.status(400).json({ error: "Missing app name" });
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const taskId = uuidv4();
  const docker = new DockerRunner();

  // Handle status updates
  docker.on("status", (update) => {
    sendUpdate(res, update.taskId, update.taskType, update.status, update.message);
  });

  try {
    await docker.runCommand(taskId, "DEPLOY", ["up", "-d"], appName);
    res.end();
  } catch (error) {
    sendUpdate(res, taskId, "DEPLOY", "error", (error as Error).message);
    res.end();
  }
};

// export const upgradeApp: RequestHandler = (req, res) => {
//   const { appName } = req.params;
//   res.json({ message: `Upgrading ${appName}...` });
// };

// export const listApps: RequestHandler = async (req, res) => {
//   const taskId = uuidv4();
//   try {
//     const apps = await runDockerCommand(res, taskId, "LIST", ["ps", "--all", "--format", "{{.Names}}"]);
//     res.json({ apps });
//   } catch (error) {
//     res.status(500).json({ error: "Failed to list applications" });
//   }
// };

// export const getAppDetails: RequestHandler = async (req, res) => {
//   const taskId = uuidv4();
//   const { appName } = req.params;
//   try {
//     const details = await runDockerCommand(res, taskId, "INSPECT", ["ps", "--format", "{{json .}}", "--filter", `name=${appName}`], appName);
//     if (details) {
//       res.json({ details });
//     } else {
//       res.status(404).json({ error: "Application not found" });
//     }
//     res.json({ details });
//   } catch (error) {
//     res.status(500).json({ error: "Failed to get application details" });
//   }
// };

// export const removeApp: RequestHandler = async (req, res) => {
//   const { appName } = req.params;
//   const taskId = uuidv4();
//   try {
//     await runDockerCommand(res, taskId, "REMOVE", ["down", "--volumes", "--remove-orphans"], appName);
//     res.json({ message: `Application ${appName} removed successfully` });
//   } catch (error) {
//     res.status(500).json({ error: "Failed to remove application" });
//   }
// };

// export const startApp: RequestHandler = async (req, res) => {
//   const { appName } = req.params;
//   const taskId = uuidv4();
//   try {
//     await runDockerCommand(res, taskId, "START", ["start"], appName);
//     res.json({ message: `Application ${appName} started successfully` });
//   } catch (error) {
//     res.status(500).json({ error: "Failed to start application" });
//   }
// };

// export const stopApp: RequestHandler = async (req, res) => {
//   const { appName } = req.params;
//   const taskId = uuidv4();
//   try {
//     await runDockerCommand(res, taskId, "STOP", ["stop"], appName);
//     res.json({ message: `Application ${appName} stopped successfully` });
//   } catch (error) {
//     res.status(500).json({ error: "Failed to stop application" });
//   }
// };

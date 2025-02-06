import type { Response } from "express";
import { spawn } from "child_process";
import { sendUpdate } from "./updates";
import { v4 as uuidv4 } from "uuid";
import { logEvent } from "./logger";

export const runDockerCommand = (res: Response, taskType: string, args: string[], appName: string, rollback = false) => {
  const taskId = uuidv4();

  logEvent("TASK", "info", `Starting ${taskType} task for ${appName}...`, { taskId });

  sendUpdate(res, taskId, taskType, "progress", `Starting ${taskType} for ${appName}...`, 1, 3);

  const dockerProcess = spawn("docker", ["compose", ...args, appName]);

  dockerProcess.stdout.on("data", (data) => {
    sendUpdate(res, taskId, taskType, "progress", data.toString().trim());
  });

  dockerProcess.stderr.on("data", (data) => {
    sendUpdate(res, taskId, taskType, "error", data.toString().trim());
  });

  dockerProcess.on("close", (code) => {
    if (code === 0) {
      sendUpdate(res, taskId, taskType, "completed", `${taskType} for ${appName} completed successfully!`);
    } else {
      sendUpdate(res, taskId, taskType, "failed", `${taskType} for ${appName} failed with exit code ${code}`);
    }
    res.end();
  });

  res.req.on("close", () => {
    logEvent("TASK", "warning", `Client disconnected during ${taskType} for ${appName}.`, { taskId });
    dockerProcess.kill("SIGINT");
  });
};


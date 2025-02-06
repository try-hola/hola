import type { Response } from "express";
import { spawn } from "child_process";
import { sendUpdate } from "./updates";
import { v4 as uuidv4 } from "uuid";

export const runDockerCommand = (res: Response, args: string[], appName: string, rollback = false) => {
    const taskId = uuidv4(); // Generate unique Task ID
  
    console.log(`[TASK ${taskId}] Starting Docker command: docker compose ${args.join(" ")} ${appName}`);
  
    sendUpdate(res, taskId, "progress", `Starting Docker command for ${appName}...`, 1, 3);
  
    const dockerProcess = spawn("docker", ["compose", ...args, appName]);
  
    dockerProcess.stdout.on("data", (data) => {
      sendUpdate(res, taskId, "progress", data.toString().trim());
    });
  
    dockerProcess.stderr.on("data", (data) => {
      sendUpdate(res, taskId, "error", data.toString().trim());
    });
  
    dockerProcess.on("close", (code) => {
      if (code === 0) {
        sendUpdate(res, taskId, "completed", `Docker command '${args.join(" ")}' for ${appName} completed successfully!`);
      } else {
        sendUpdate(res, taskId, "failed", `Docker command '${args.join(" ")}' for ${appName} failed with exit code ${code}`);
      }
      res.end();
    });
  
    res.req.on("close", () => {
      console.log(`[TASK ${taskId}] Client disconnected. Stopping Docker process for ${appName}...`);
      dockerProcess.kill("SIGINT"); // Graceful stop
  
      if (rollback) {
        console.log(`[TASK ${taskId}] Rolling back deployment for ${appName}...`);
        spawn("docker", ["compose", "down", "-v", appName]);
      }
    });
  };

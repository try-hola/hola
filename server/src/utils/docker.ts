import { spawn } from "child_process";
import { logEvent } from "../utils/logger";
import type { Response } from "express";

export const runDockerCommand = async (
  res: Response | null,
  taskId: string,
  taskType: string,
  args: string[],
  appName?: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const commandString = `docker compose ${args.join(" ")}${appName ? ` ${appName}` : ''}`;
    logEvent("TASK", "info", `Running: ${commandString}`, { taskId, taskType });

    // Spawn Docker process
    const dockerProcess = spawn("docker", ["compose", ...args, ...(appName ? [appName] : [])]);

    // Stream output (SSE & STDOUT)
    const sendOutput = (data: Buffer, isError: boolean = false) => {
      const message = data.toString().trim();
      if (message) {
        logEvent("TASK", isError ? "error" : "progress", message, { taskId, taskType });
        if (res) {
          res.write(`data: ${JSON.stringify({ taskId, taskType, status: isError ? "error" : "progress", message })}\n\n`);
        }
      }
    };

    dockerProcess.stdout?.on("data", (data) => sendOutput(data));
    dockerProcess.stderr?.on("data", (data) => sendOutput(data, true));

    dockerProcess.on("close", (code) => {
      if (code === 0) {
        logEvent("TASK", "info", `${taskType}${appName ? ` for ${appName}` : ''} completed successfully!`, { taskId, taskType });
        if (res) {
          res.write(`data: ${JSON.stringify({ taskId, taskType, status: "completed", message: `${taskType}${appName ? ` for ${appName}` : ''} completed successfully!` })}\n\n`);
          res.end();
        }

        resolve(dockerProcess.stdout.read()?.toString() || '');
      } else {
        logEvent("TASK", "error", `${taskType}${appName ? ` for ${appName}` : ''} failed with exit code ${code}`, { taskId, taskType });
        if (res) {
          res.write(`data: ${JSON.stringify({ taskId, taskType, status: "failed", message: `${taskType} failed with exit code ${code}` })}\n\n`);
          res.end();
        }
        reject(new Error(`Docker command failed with exit code ${code}`));
      }
    });

    // Handle client disconnect
    if (res) {
      res.req.on("close", () => {
        logEvent("TASK", "warning", `Client disconnected during ${taskType}${appName ? ` for ${appName}` : ''}.`, { taskId });
        dockerProcess.kill("SIGINT");
      });
    }
  });
};


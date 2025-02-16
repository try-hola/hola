import { EventEmitter } from "events";
import { spawn } from "child_process";
import { logEvent } from "../utils/logger";
import type { Response } from "express";

export class DockerRunner extends EventEmitter {
  async runCommand(
    taskId: string,
    taskType: string,
    args: string[],
    appName?: string
  ): Promise<string> {
    const commandString = `docker compose ${args.join(" ")}${appName ? ` ${appName}` : ''}`;
    this.emit("status", { taskId, taskType, status: "started", message: `Running: ${commandString}` });

    return new Promise((resolve, reject) => {
      const dockerProcess = spawn("docker", ["compose", ...args, ...(appName ? [appName] : [])]);

      dockerProcess.stdout?.on("data", (data) => {
        const message = data.toString().trim();
        if (message) {
          this.emit("status", { taskId, taskType, status: "progress", message });
        }
      });

      dockerProcess.stderr?.on("data", (data) => {
        const message = data.toString().trim();
        if (message) {
          this.emit("status", { taskId, taskType, status: "error", message });
        }
      });

      dockerProcess.on("close", (code) => {
        if (code === 0) {
          this.emit("status", { taskId, taskType, status: "completed", message: `${taskType}${appName ? ` for ${appName}` : ''} completed successfully!` });
          resolve(dockerProcess.stdout.read()?.toString() || '');
        } else {
          this.emit("status", { taskId, taskType, status: "failed", message: `${taskType} failed with exit code ${code}` });
          reject(new Error(`Docker command failed with exit code ${code}`));
        }
      });
    });
  }
}


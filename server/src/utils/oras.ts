import { EventEmitter } from "events";
import { spawn } from "child_process";

interface OrasOptions {
  outputDir?: string;
  version?: string;
}

interface StatusUpdate {
  taskId: string;
  taskType: string;
  status: "starting" | "running" | "complete" | "error";
  message: string;
}

export class OrasRunner extends EventEmitter {
  async runCommand(
    taskId: string,
    taskType: string,
    registry: string,
    appName: string,
    options: OrasOptions = {}
  ): Promise<void> {
    const { outputDir, version = "latest" } = options;
    const bundleName = `${appName}:${version}`;
    
    this.emit("status", {
      taskId,
      taskType,
      status: "starting",
      message: `Downloading ${bundleName} from ${registry}`
    } as StatusUpdate);

    return new Promise((resolve, reject) => {
      const args = [
        "pull",
        `${registry}/${bundleName}`,
        "--output",
        outputDir || "."
      ];

      const process = spawn("oras", args);
      
      process.on("error", (error) => {
        this.emit("status", {
          taskId,
          taskType,
          status: "error",
          message: error.message
        } as StatusUpdate);
        reject(error);
      });

      process.on("close", (code) => {
        if (code === 0) {
          this.emit("status", {
            taskId,
            taskType,
            status: "complete",
            message: `Successfully downloaded ${bundleName}`
          } as StatusUpdate);
          resolve();
        } else {
          reject(new Error(`Oras command failed with code ${code}`));
        }
      });
    });
  }
}
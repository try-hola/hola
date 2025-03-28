const { EventEmitter } = require("events");
const { spawn } = require("child_process");

/**
 * Options for ORAS runner operations
 */
interface OrasOptions {
  /** Directory to output downloaded files */
  outputDir?: string;
  /** Version of the application to download, defaults to "latest" */
  version?: string;
}

/**
 * Status update event payload
 */
interface StatusUpdate {
  /** Unique identifier for the task */
  taskId: string;
  /** Type of task being performed */
  taskType: string;
  /** Current status of the operation */
  status: "starting" | "running" | "complete" | "error";
  /** Human-readable message about the current status */
  message: string;
}

/**
 * Runner for ORAS (OCI Registry As Storage) operations
 * Handles pulling OCI artifacts from registries
 */
class OrasRunner extends EventEmitter {
  /**
   * Executes an ORAS command to download an application bundle
   * 
   * @param taskId - Unique identifier for the task
   * @param taskType - Type of task being performed (e.g., "DOWNLOAD")
   * @param registry - URL of the OCI registry
   * @param appName - Name of the application to download
   * @param options - Additional options for the operation
   * @returns Promise that resolves when the download completes successfully
   */
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
    });

    return new Promise<void>((resolve, reject) => {
      const args = [
        "pull",
        `${registry}/${bundleName}`,
        "--output",
        outputDir || "."
      ];

      const process = spawn("oras", args);
      
      process.on("error", (error: Error) => {
        this.emit("status", {
          taskId,
          taskType,
          status: "error",
          message: error.message
        });
        reject(error);
      });

      process.on("close", (code: number) => {
        if (code === 0) {
          this.emit("status", {
            taskId,
            taskType,
            status: "complete",
            message: `Successfully downloaded ${bundleName}`
          });
          resolve();
        } else {
          reject(new Error(`Oras command failed with code ${code}`));
        }
      });
    });
  }
}

module.exports = {
  OrasRunner
};
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

/**
 * Result of a Docker command execution
 */
interface DockerCommandResult {
  code: number;
  output: string;
}

/**
 * Options for Docker command execution
 */
interface DockerCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Event emitted during Docker command execution
 */
interface DockerStatusEvent {
  taskId: string;
  taskType: string;
  status: "starting" | "running" | "warning" | "complete" | "error";
  message: string;
}

/**
 * Docker runner for executing docker and docker-compose commands
 * Emits events for status updates during command execution
 */
class DockerRunner extends EventEmitter {
  /**
   * Run a Docker command and emit status events
   *
   * @param taskId - Unique ID for this task
   * @param taskType - Type of task (DEPLOY, REMOVE, START, etc.)
   * @param args - Command arguments for docker-compose
   * @param appName - Name of the application
   * @param options - Additional options for command execution
   * @returns Promise resolving to the command result
   */
  async runCommand(
    taskId: string,
    taskType: string,
    args: string[],
    appName: string,
    options: DockerCommandOptions = {}
  ): Promise<DockerCommandResult> {
    return new Promise((resolve, reject) => {
      // Default to docker-compose command
      const command = "docker-compose";

      // Set up environment with any passed options
      const env = {
        ...process.env,
        ...options.env,
      };

      // Emit a starting event
      this.emit("status", {
        taskId,
        taskType,
        status: "starting",
        message: `Running docker-compose ${args.join(" ")} for ${appName}`,
      });

      // Spawn the process
      const dockerProcess = spawn(command, args, {
        cwd: options.cwd,
        env,
      });

      let stdout = "";
      let stderr = "";

      // Collect stdout and emit updates
      dockerProcess.stdout.on("data", (data: Buffer) => {
        const chunk: string = data.toString();
        stdout += chunk;

        this.emit("status", {
          taskId,
          taskType,
          status: "running",
          message: chunk.trim(),
        } as DockerStatusEvent);
      });

      // Collect stderr
      dockerProcess.stderr.on("data", (data: Buffer) => {
        const chunk: string = data.toString();
        stderr += chunk;

        // Emit stderr as a warning status
        this.emit("status", {
          taskId,
          taskType,
          status: "warning",
          message: chunk.trim(),
        } as DockerStatusEvent);
      });

      // Handle process completion
      dockerProcess.on("close", (code: number | null) => {
        if (code === 0) {
          this.emit("status", {
            taskId,
            taskType,
            status: "complete",
            message: `Command completed successfully`,
          } as DockerStatusEvent);

          resolve({
            code,
            output: stdout,
          } as DockerCommandResult);
        } else {
          const errorMessage: string = `Command failed with exit code ${code}: ${stderr}`;

          this.emit("status", {
            taskId,
            taskType,
            status: "error",
            message: errorMessage,
          } as DockerStatusEvent);

          reject(new Error(errorMessage));
        }
      });

      // Handle process errors
      dockerProcess.on("error", (error: Error) => {
        const errorMessage: string = `Failed to execute command: ${error.message}`;

        this.emit("status", {
          taskId,
          taskType,
          status: "error",
          message: errorMessage,
        });

        reject(new Error(errorMessage));
      });
    });
  }
}

module.exports = { DockerRunner };

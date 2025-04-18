const { EventEmitter } = require("events");

export interface DockerCommandResult {
  code: number;
  output: string;
}

export interface DockerCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Test adapter for Docker CLI operations
 * Supports both mocked responses and real Docker integration
 */
export class DockerTestAdapter extends EventEmitter {
  private useMock: boolean;

  constructor(options: { useMock?: boolean } = {}) {
    super();
    this.useMock = options.useMock !== false;
  }

  /**
   * Executes a Docker command or simulates it in mock mode
   *
   * @param taskId - Unique identifier for the task
   * @param taskType - The type of Docker operation
   * @param args - Docker CLI arguments
   * @param appName - The application name
   * @param options - Command options including working directory and environment
   * @returns Promise resolving to command result with exit code and output
   */
  async runCommand(
    taskId: string,
    taskType: string,
    args: string[],
    appName: string,
    options?: DockerCommandOptions,
  ): Promise<DockerCommandResult> {
    if (this.useMock) {
      // Simulate a delay for mock responses
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Emit status updates like the real implementation would
      this.emit("status", {
        taskId,
        taskType,
        status: "starting",
        message: `Running docker-compose ${args.join(" ")} for ${appName}`,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      this.emit("status", {
        taskId,
        taskType,
        status: "running",
        message: "Command in progress...",
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Mock common Docker command responses based on command arguments
      let result: DockerCommandResult;

      if (args.includes("ps")) {
        result = { code: 0, output: "Up 2 hours" };
      } else if (args.includes("down")) {
        result = { code: 0, output: "Removed network test-app_default" };
      } else if (args.includes("up")) {
        result = {
          code: 0,
          output:
            "Creating network test-app_default\nCreating test-app_app_1 ... done",
        };
      } else if (args.includes("stop")) {
        result = { code: 0, output: "Stopping test-app_app_1 ... done" };
      } else {
        result = { code: 0, output: "Command executed successfully" };
      }

      this.emit("status", {
        taskId,
        taskType,
        status: "complete",
        message: `Command completed with code ${result.code}`,
      });

      return result;
    } else {
      // Real Docker implementation would be implemented here
      throw new Error("Real Docker implementation not available in test mode");
    }
  }
}

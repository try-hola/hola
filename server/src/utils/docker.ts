const { EventEmitter } = require("events");
const { spawn } = require("child_process");

interface DockerOptions {
  cwd?: string;
}

interface StatusUpdate {
  taskId: string;
  taskType: string;
  status: "starting" | "running" | "complete" | "error";
  message: string;
}

interface CommandResult {
  code: number;
  output: string;
}

class DockerRunner extends EventEmitter {
  async runCommand(
    taskId: string,
    taskType: string,
    args: string[],
    appName: string,
    options: DockerOptions = {}
  ): Promise<CommandResult> {
    this.emit("status", {
      taskId,
      taskType,
      status: "starting",
      message: `Running docker-compose ${args.join(" ")} for ${appName}`
    } as StatusUpdate);

    return new Promise((resolve, reject) => {
      const childProcess = spawn("docker-compose", args, {
        cwd: options.cwd,
        env: { ...process.env, PATH: process.env.PATH }
      });

      let output = "";

      childProcess.stdout.on("data", (data: Buffer) => {
        output += data.toString();
        this.emit("status", {
          taskId,
          taskType,
          status: "running",
          message: data.toString()
        } as StatusUpdate);
      });

      childProcess.stderr.on("data", (data: Buffer) => {
        output += data.toString();
        this.emit("status", {
          taskId,
          taskType,
          status: "running",
          message: data.toString()
        } as StatusUpdate);
      });

      childProcess.on("error", (error: Error) => {
        this.emit("status", {
          taskId,
          taskType,
          status: "error",
          message: error.message
        } as StatusUpdate);
        reject(error);
      });

      childProcess.on("close", (code: number) => {
        if (code === 0) {
          this.emit("status", {
        taskId,
        taskType,
        status: "complete",
        message: `Docker compose command completed successfully`
          } as StatusUpdate);
          resolve({ code, output });
        } else {
          this.emit("status", {
        taskId,
        taskType,
        status: "error",
        message: `Docker compose command failed with code ${code}`
          } as StatusUpdate);
          reject(new Error(`Docker compose command failed with code ${code}`));
        }
      });
    });
  }
}

module.exports = {
  DockerRunner
};


// server/src/test/docker-test-adapter.ts
import { EventEmitter } from 'events';

export interface DockerCommandResult {
  code: number;
  output: string;
}

export interface DockerCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Test-friendly Docker adapter that can be used with real Docker or mocked
 */
export class DockerTestAdapter extends EventEmitter {
  private useMock: boolean;

  constructor(options: { useMock?: boolean } = {}) {
    super();
    this.useMock = options.useMock !== false;
  }

  /**
   * Run a Docker command
   */
  async runCommand(
    taskId: string,
    taskType: string,
    args: string[],
    appName: string,
    options?: DockerCommandOptions
  ): Promise<DockerCommandResult> {
    if (this.useMock) {
      // Simulate a delay for mock responses
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Emit status updates like the real implementation would
      this.emit('status', {
        taskId,
        taskType,
        status: 'starting',
        message: `Running docker-compose ${args.join(' ')} for ${appName}`
      });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      this.emit('status', {
        taskId,
        taskType,
        status: 'running',
        message: 'Command in progress...'
      });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Mock common Docker command responses
      let result: DockerCommandResult;
      
      if (args.includes('ps')) {
        result = { code: 0, output: 'Up 2 hours' };
      } else if (args.includes('down')) {
        result = { code: 0, output: 'Removed network test-app_default' };
      } else if (args.includes('up')) {
        result = { code: 0, output: 'Creating network test-app_default\nCreating test-app_app_1 ... done' };
      } else if (args.includes('stop')) {
        result = { code: 0, output: 'Stopping test-app_app_1 ... done' };
      } else {
        result = { code: 0, output: 'Command executed successfully' };
      }
      
      this.emit('status', {
        taskId,
        taskType,
        status: 'complete',
        message: `Command completed with code ${result.code}`
      });
      
      return result;
    } else {
      // For real Docker implementation, import and use the actual DockerRunner
      // This would be implemented to use the real Docker CLI or Docker API
      throw new Error('Real Docker implementation not available in test mode');
    }
  }
}
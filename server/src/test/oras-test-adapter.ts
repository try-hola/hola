// server/src/test/oras-test-adapter.ts
import { EventEmitter } from 'events';

export interface OrasCommandOptions {
  outputDir?: string;
  version?: string;
}

/**
 * Test adapter for the ORAS runner that mocks package downloads
 * and other ORAS operations for integration testing
 */
export class OrasTestAdapter extends EventEmitter {
  /**
   * Run a simulated ORAS command
   * 
   * @param taskId - The unique task identifier
   * @param taskType - The type of operation being performed
   * @param registry - The OCI registry URL
   * @param appName - The application name
   * @param options - Command options including output directory and version
   */
  async runCommand(
    taskId: string,
    taskType: string,
    registry: string,
    appName: string,
    options?: OrasCommandOptions
  ): Promise<void> {
    // Simulate download delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Emit starting status
    this.emit('status', {
      taskId,
      taskType,
      status: 'starting',
      message: `Fetching ${appName}:${options?.version || 'latest'} from ${registry}`
    });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Emit download progress
    this.emit('status', {
      taskId,
      taskType,
      status: 'running',
      message: `Downloading package artifacts...`
    });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Mock successful download completion
    this.emit('status', {
      taskId,
      taskType,
      status: 'complete',
      message: `Downloaded ${appName}:${options?.version || 'latest'} successfully`
    });
  }
}
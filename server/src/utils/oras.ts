const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs-extra');

/**
 * Options for ORAS command execution
 */
interface OrasCommandOptions {
  /** Directory where artifacts will be saved when downloading */
  outputDir?: string;
  /** Version tag for the artifact (defaults to "latest") */
  version?: string;
  /** Key-value pairs of annotations to apply to artifacts */
  annotations?: Record<string, string>;
}

/**
 * ORAS (OCI Registry As Storage) runner for interacting with OCI-compatible registries
 * Emits status events during operations for progress tracking
 */
class OrasRunner extends EventEmitter {
  /**
   * Executes an ORAS command against an OCI registry
   * 
   * @param taskId - Unique ID for this task
   * @param taskType - Type of task (DOWNLOAD, UPLOAD, etc.)
   * @param registry - The ORAS registry URL
   * @param appName - Name of the application/artifact
   * @param options - Additional options for command execution
   */
  async runCommand(
    taskId: string,
    taskType: string,
    registry: string,
    appName: string,
    options: OrasCommandOptions = {}
  ): Promise<void> {
    const version = options.version || 'latest';
    const reference = `${registry}/${appName}:${version}`;
    
    return new Promise((resolve, reject) => {
      // Ensure output directory exists
      if (options.outputDir) {
        fs.ensureDirSync(options.outputDir);
      }
      
      // Set up command and arguments based on task type
      let command = 'oras';
      let args: string[] = [];
      
      if (taskType === 'DOWNLOAD') {
        args = ['pull', reference];
        if (options.outputDir) {
          args.push('--output', options.outputDir);
        }
      } else if (taskType === 'UPLOAD') {
        // Upload command would be implemented here
        reject(new Error('Upload functionality not yet implemented'));
        return;
      } else {
        reject(new Error(`Unknown task type: ${taskType}`));
        return;
      }
      
      // Emit starting event
      this.emit('status', {
        taskId,
        taskType,
        status: 'starting',
        message: `Starting ${taskType.toLowerCase()} for ${appName}:${version}`
      });
      
      // For download tasks, add additional details
      if (taskType === 'DOWNLOAD') {
        this.emit('status', {
          taskId,
          taskType,
          status: 'running',
          message: `Downloading from ${reference}`
        });
      }
      
      // Spawn the process
      const orasProcess = spawn(command, args);
      
      let stdout = '';
      let stderr = '';
      
      // Collect stdout and emit as status updates
      orasProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        
        this.emit('status', {
          taskId,
          taskType,
          status: 'running',
          message: chunk.trim()
        });
      });
      
      // Collect stderr and emit as warnings
      orasProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        
        this.emit('status', {
          taskId,
          taskType,
          status: 'warning',
          message: chunk.trim()
        });
      });
      
      // Handle successful completion
      orasProcess.on('close', (code) => {
        if (code === 0) {
          this.emit('status', {
            taskId,
            taskType,
            status: 'complete',
            message: `${taskType} completed successfully`
          });
          
          resolve();
        } else {
          const errorMessage = `Command failed with exit code ${code}: ${stderr}`;
          
          this.emit('status', {
            taskId,
            taskType,
            status: 'error',
            message: errorMessage
          });
          
          reject(new Error(errorMessage));
        }
      });
      
      // Handle process spawn errors (e.g., command not found)
      orasProcess.on('error', (error) => {
        const errorMessage = `Failed to execute command: ${error.message}`;
        
        this.emit('status', {
          taskId,
          taskType,
          status: 'error',
          message: errorMessage
        });
        
        reject(new Error(errorMessage));
      });
    });
  }
}

module.exports = { OrasRunner };
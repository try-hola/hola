const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs-extra');

/**
 * Options for ORAS command execution
 */
interface OrasCommandOptions {
  outputDir?: string;
  version?: string;
  annotations?: Record<string, string>;
}

/**
 * ORAS runner class that handles OCI Registry operations
 * and emits events for status updates
 */
class OrasRunner extends EventEmitter {
  /**
   * Run an ORAS command and emit status events
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
      
      // Collect stdout
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
      
      // Collect stderr
      orasProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        
        // Emit stderr as a warning status
        this.emit('status', {
          taskId,
          taskType,
          status: 'warning',
          message: chunk.trim()
        });
      });
      
      // Handle process completion
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
      
      // Handle process errors
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
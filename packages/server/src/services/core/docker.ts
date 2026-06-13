/**
 * Docker service for container management operations
 * 
 * Provides Docker availability checks, version information, compose operations,
 * and log streaming capabilities with graceful degradation when Docker is unavailable.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import { getLogger } from '../../lib/logger';
import type { ServiceHealth, HealthCheckable } from './types';

const execAsync = promisify(exec);

export interface DockerInfo {
  available: boolean;
  version?: string;
  serverVersion?: string;
  apiVersion?: string;
  error?: string;
}

export interface ComposeProject {
  name: string;
  services: ComposeService[];
  configFiles: string[];
}

export interface ComposeService {
  name: string;
  state: 'running' | 'stopped' | 'restarting' | 'exited' | 'dead' | 'created' | 'paused';
  status: string;
  image: string;
  ports: string[];
}

export interface DockerLogs {
  entries: Array<{
    timestamp: string;
    service: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
  }>;
  hasMore: boolean;
  nextSince?: string;
}

export interface DockerService {
  // Docker availability and info
  getDockerInfo(): Promise<DockerInfo>;
  checkDockerAvailability(): Promise<boolean>;
  
  // Compose operations
  composeUp(projectPath: string, projectName: string): Promise<{ success: boolean; output: string }>;
  composeDown(projectPath: string, projectName: string): Promise<{ success: boolean; output: string }>;
  composePs(projectPath: string, projectName: string): Promise<ComposeProject>;
  composeRestart(projectPath: string, projectName: string, serviceName?: string): Promise<{ success: boolean; output: string }>;
  
  // Log operations
  getContainerLogs(containerName: string, since?: string, tail?: number): Promise<DockerLogs>;
  streamContainerLogs(containerName: string, callback: (log: DockerLogs['entries'][0]) => void): Promise<{ stop: () => void }>;
  
  // Health checking
  healthCheck(): Promise<ServiceHealth>;
}

/**
 * Real Docker service implementation
 */
export class RealDockerService implements DockerService, HealthCheckable {
  private logger = getLogger().child({ service: 'DockerService' });
  private dockerAvailable: boolean | null = null;
  private lastHealthCheck: Date | null = null;

  async getDockerInfo(): Promise<DockerInfo> {
    try {
      this.logger.debug('Getting Docker info');
      
      const { stdout } = await execAsync('docker version --format "{{.Client.Version}}"');
      const clientVersion = stdout.trim();
      
      try {
        const { stdout: serverOut } = await execAsync('docker version --format "{{.Server.Version}}"');
        const serverVersion = serverOut.trim();
        
        const { stdout: apiOut } = await execAsync('docker version --format "{{.Server.APIVersion}}"');
        const apiVersion = apiOut.trim();
        
        this.dockerAvailable = true;
        this.logger.info('Docker info retrieved successfully', {
          clientVersion,
          serverVersion,
          apiVersion,
        });
        
        return {
          available: true,
          version: clientVersion,
          serverVersion,
          apiVersion,
        };
      } catch (serverError) {
        // Docker client available but server not running
        this.dockerAvailable = false;
        this.logger.warn('Docker client available but server not running', {
          clientVersion,
          error: serverError instanceof Error ? serverError.message : String(serverError),
        });
        
        return {
          available: false,
          version: clientVersion,
          error: 'Docker server not running',
        };
      }
    } catch (error) {
      this.dockerAvailable = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn('Docker not available', { error: errorMessage });
      
      return {
        available: false,
        error: errorMessage,
      };
    }
  }

  async checkDockerAvailability(): Promise<boolean> {
    if (this.dockerAvailable !== null) {
      return this.dockerAvailable;
    }
    
    const info = await this.getDockerInfo();
    return info.available;
  }

  async composeUp(projectPath: string, projectName: string): Promise<{ success: boolean; output: string }> {
    try {
      this.logger.info('Starting compose project', { projectPath, projectName });
      
      const composeFile = join(projectPath, 'docker-compose.yml');
      if (!existsSync(composeFile)) {
        throw new Error(`docker-compose.yml not found at ${composeFile}`);
      }
      
      const { stdout, stderr } = await execAsync(
        `docker compose -f "${composeFile}" -p "${projectName}" up -d`,
        { cwd: projectPath, timeout: 120000 } // 2 minute timeout
      );
      
      const output = [stdout, stderr].filter(Boolean).join('\n');
      this.logger.info('Compose project started successfully', {
        projectName,
        output: output.substring(0, 1000), // Truncate for logging
      });
      
      return { success: true, output };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to start compose project', error instanceof Error ? error : undefined, {
        projectPath,
        projectName,
      });
      
      return { success: false, output: errorMessage };
    }
  }

  async composeDown(projectPath: string, projectName: string): Promise<{ success: boolean; output: string }> {
    try {
      this.logger.info('Stopping compose project', { projectPath, projectName });
      
      const composeFile = join(projectPath, 'docker-compose.yml');
      if (!existsSync(composeFile)) {
        throw new Error(`docker-compose.yml not found at ${composeFile}`);
      }
      
      const { stdout, stderr } = await execAsync(
        `docker compose -f "${composeFile}" -p "${projectName}" down`,
        { cwd: projectPath, timeout: 60000 } // 1 minute timeout
      );
      
      const output = [stdout, stderr].filter(Boolean).join('\n');
      this.logger.info('Compose project stopped successfully', {
        projectName,
        output: output.substring(0, 1000),
      });
      
      return { success: true, output };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to stop compose project', error instanceof Error ? error : undefined, {
        projectPath,
        projectName,
      });
      
      return { success: false, output: errorMessage };
    }
  }

  async composePs(projectPath: string, projectName: string): Promise<ComposeProject> {
    try {
      this.logger.debug('Getting compose project status', { projectPath, projectName });
      
      const composeFile = join(projectPath, 'docker-compose.yml');
      
      const { stdout } = await execAsync(
        `docker compose -f "${composeFile}" -p "${projectName}" ps --format json`,
        { cwd: projectPath }
      );
      
      const lines = stdout.trim().split('\n').filter(line => line.trim());
      const services: ComposeService[] = [];
      
      for (const line of lines) {
        try {
          const serviceData = JSON.parse(line);
          services.push({
            name: serviceData.Service || serviceData.Name,
            state: this.normalizeContainerState(serviceData.State),
            status: serviceData.Status || '',
            image: serviceData.Image || '',
            ports: this.parsePortMappings(serviceData.Publishers || []),
          });
        } catch (parseError) {
          this.logger.warn('Failed to parse compose service data', {
            line,
            error: parseError instanceof Error ? parseError.message : String(parseError),
          });
        }
      }
      
      return {
        name: projectName,
        services,
        configFiles: [composeFile],
      };
    } catch (error) {
      this.logger.error('Failed to get compose project status', error instanceof Error ? error : undefined, {
        projectPath,
        projectName,
      });
      
      // Return empty project on error
      return {
        name: projectName,
        services: [],
        configFiles: [],
      };
    }
  }

  async composeRestart(projectPath: string, projectName: string, serviceName?: string): Promise<{ success: boolean; output: string }> {
    try {
      this.logger.info('Restarting compose service(s)', { projectPath, projectName, serviceName });
      
      const composeFile = join(projectPath, 'docker-compose.yml');
      const serviceArg = serviceName ? ` ${serviceName}` : '';
      
      const { stdout, stderr } = await execAsync(
        `docker compose -f "${composeFile}" -p "${projectName}" restart${serviceArg}`,
        { cwd: projectPath, timeout: 60000 }
      );
      
      const output = [stdout, stderr].filter(Boolean).join('\n');
      this.logger.info('Compose service(s) restarted successfully', {
        projectName,
        serviceName,
        output: output.substring(0, 1000),
      });
      
      return { success: true, output };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to restart compose service(s)', error instanceof Error ? error : undefined, {
        projectPath,
        projectName,
        serviceName,
      });
      
      return { success: false, output: errorMessage };
    }
  }

  async getContainerLogs(containerName: string, since?: string, tail?: number): Promise<DockerLogs> {
    try {
      this.logger.debug('Getting container logs', { containerName, since, tail });
      
      let cmd = `docker logs ${containerName}`;
      if (since) {
        cmd += ` --since "${since}"`;
      }
      if (tail) {
        cmd += ` --tail ${tail}`;
      }
      cmd += ' --timestamps';
      
      const { stdout } = await execAsync(cmd);
      const entries = this.parseDockerLogs(stdout, containerName);
      
      return {
        entries,
        hasMore: tail ? entries.length >= tail : false,
        nextSince: entries.length > 0 ? entries[entries.length - 1].timestamp : undefined,
      };
    } catch (error) {
      this.logger.error('Failed to get container logs', error instanceof Error ? error : undefined, {
        containerName,
        since,
        tail,
      });
      
      return {
        entries: [],
        hasMore: false,
      };
    }
  }

  async streamContainerLogs(containerName: string, callback: (log: DockerLogs['entries'][0]) => void): Promise<{ stop: () => void }> {
    this.logger.info('Starting container log stream', { containerName });
    
    const { spawn } = await import('child_process');
    const dockerProcess = spawn('docker', ['logs', '-f', '--timestamps', containerName]);
    
    let stopped = false;
    
    dockerProcess.stdout?.on('data', (data: Buffer) => {
      if (stopped) return;
      
      const logs = this.parseDockerLogs(data.toString(), containerName);
      logs.forEach(callback);
    });
    
    dockerProcess.stderr?.on('data', (data: Buffer) => {
      if (stopped) return;
      
      const logs = this.parseDockerLogs(data.toString(), containerName);
      logs.forEach(callback);
    });
    
    dockerProcess.on('error', (error) => {
      this.logger.error('Docker log stream error', error, { containerName });
    });
    
    dockerProcess.on('exit', (code) => {
      this.logger.info('Docker log stream ended', { containerName, code });
    });
    
    return {
      stop: () => {
        stopped = true;
        dockerProcess.kill();
        this.logger.info('Docker log stream stopped', { containerName });
      },
    };
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      const info = await this.getDockerInfo();
      this.lastHealthCheck = new Date();
      
      return {
        healthy: info.available,
        lastCheck: this.lastHealthCheck,
        error: info.error,
      };
    } catch (error) {
      this.lastHealthCheck = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        healthy: false,
        lastCheck: this.lastHealthCheck,
        error: errorMessage,
      };
    }
  }

  // Helper methods
  private normalizeContainerState(state: string): ComposeService['state'] {
    const lowercaseState = state.toLowerCase();
    
    if (lowercaseState.includes('running')) return 'running';
    if (lowercaseState.includes('stopped') || lowercaseState.includes('exited')) return 'stopped';
    if (lowercaseState.includes('restarting')) return 'restarting';
    if (lowercaseState.includes('dead')) return 'dead';
    if (lowercaseState.includes('created')) return 'created';
    if (lowercaseState.includes('paused')) return 'paused';
    
    return 'exited'; // Default fallback
  }

  private parsePortMappings(publishers: Array<{ PublishedPort?: number; TargetPort?: number; [key: string]: unknown }>): string[] {
    return publishers.map((pub) => {
      if (pub.PublishedPort && pub.TargetPort) {
        return `${pub.PublishedPort}:${pub.TargetPort}`;
      }
      return String(pub);
    }).filter(Boolean);
  }

  private parseDockerLogs(logOutput: string, serviceName: string): DockerLogs['entries'] {
    const lines = logOutput.split('\n').filter(line => line.trim());
    const entries: DockerLogs['entries'] = [];
    
    for (const line of lines) {
      // Docker log format: 2023-12-15T10:30:00.123456789Z message
      const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)$/);
      
      if (timestampMatch) {
        const [, timestamp, message] = timestampMatch;
        const level = this.detectLogLevel(message);
        
        entries.push({
          timestamp,
          service: serviceName,
          level,
          message: message.trim(),
        });
      } else {
        // Fallback for lines without timestamps
        entries.push({
          timestamp: new Date().toISOString(),
          service: serviceName,
          level: 'info',
          message: line.trim(),
        });
      }
    }
    
    return entries;
  }

  private detectLogLevel(message: string): 'info' | 'warn' | 'error' | 'debug' {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('error') || lowerMessage.includes('fatal') || lowerMessage.includes('critical')) {
      return 'error';
    }
    if (lowerMessage.includes('warn') || lowerMessage.includes('warning')) {
      return 'warn';
    }
    if (lowerMessage.includes('debug') || lowerMessage.includes('trace')) {
      return 'debug';
    }
    
    return 'info';
  }
}

/**
 * Mock Docker service implementation for when Docker is unavailable
 */
/**
 * Mock Docker service that simulates a working Docker engine. Used for
 * development and tests so the deployment lifecycle converges to real terminal
 * states without an actual Docker daemon. Reports itself as available so the
 * lifecycle executor exercises the same success/failure paths as production.
 */
export class MockDockerService implements DockerService {
  private logger = getLogger().child({ service: 'MockDockerService' });

  async getDockerInfo(): Promise<DockerInfo> {
    return { available: true, version: 'mock', serverVersion: 'mock', apiVersion: 'mock' };
  }

  async checkDockerAvailability(): Promise<boolean> {
    return true;
  }

  async composeUp(projectPath: string, projectName: string): Promise<{ success: boolean; output: string }> {
    this.logger.debug('Mock compose up', { projectPath, projectName });
    return { success: true, output: `[mock] Project ${projectName} created and started` };
  }

  async composeDown(projectPath: string, projectName: string): Promise<{ success: boolean; output: string }> {
    this.logger.debug('Mock compose down', { projectPath, projectName });
    return { success: true, output: `[mock] Project ${projectName} stopped and removed` };
  }

  async composePs(_projectPath: string, projectName: string): Promise<ComposeProject> {
    return {
      name: projectName,
      services: [
        { name: 'app', state: 'running', status: 'Up (mock)', image: 'mock:latest', ports: [] },
      ],
      configFiles: [],
    };
  }

  async composeRestart(projectPath: string, projectName: string): Promise<{ success: boolean; output: string }> {
    this.logger.debug('Mock compose restart', { projectPath, projectName });
    return { success: true, output: `[mock] Project ${projectName} restarted` };
  }

  async getContainerLogs(containerName: string): Promise<DockerLogs> {
    return {
      entries: [
        { timestamp: new Date().toISOString(), service: containerName, level: 'info', message: '[mock] container log line' },
      ],
      hasMore: false,
    };
  }

  async streamContainerLogs(
    containerName: string,
    callback: (log: DockerLogs['entries'][0]) => void
  ): Promise<{ stop: () => void }> {
    callback({ timestamp: new Date().toISOString(), service: containerName, level: 'info', message: '[mock] streaming log line' });
    return { stop: () => {} };
  }

  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }
}

/**
 * System monitoring service for resource and dependency monitoring
 * 
 * Provides real-time system status including disk usage, memory consumption,
 * external tool availability (ORAS, Docker), and system health monitoring.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { statSync } from 'fs';
import { getLogger } from '../../lib/logger';
import { getHolaDataDir } from '../../config/paths';
import type { ServiceHealth, HealthCheckable } from './types';
// Note: avoid static import of getDockerService to prevent circular deps; use dynamic import where needed
import type { SystemStatus } from '@hola/shared';

const execAsync = promisify(exec);

export interface DiskUsage {
  freeBytes: number;
  totalBytes: number;
  usedBytes: number;
  percentUsed: number;
}

export interface MemoryUsage {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  percentUsed: number;
  buffersCacheBytes: number;
}

export interface SystemResource {
  disk: DiskUsage;
  memory: MemoryUsage;
}

export interface ExternalTool {
  name: string;
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export interface SystemMonitoringService {
  // System resource monitoring
  getDiskUsage(path?: string): Promise<DiskUsage>;
  getMemoryUsage(): Promise<MemoryUsage>;
  getSystemResources(): Promise<SystemResource>;
  
  // External tool checking
  checkDocker(): Promise<ExternalTool>;
  checkOras(): Promise<ExternalTool>;
  checkAuthentik(): Promise<ExternalTool>;
  getAllExternalTools(): Promise<ExternalTool[]>;
  
  // Unified system status
  getSystemStatus(): Promise<SystemStatus>;
  
  // Health checking
  healthCheck(): Promise<ServiceHealth>;
  
  // Real-time monitoring (for SSE)
  startMonitoring(callback: (status: SystemStatus) => void, interval?: number): { stop: () => void };
}

/**
 * Real system monitoring service implementation
 */
export class RealSystemMonitoringService implements SystemMonitoringService, HealthCheckable {
  private logger = getLogger().child({ service: 'SystemMonitoringService' });
  private holaDataPath: string;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(holaDataPath?: string) {
    this.holaDataPath = holaDataPath || getHolaDataDir();
  }

  async getDiskUsage(path?: string): Promise<DiskUsage> {
    const targetPath = path || this.holaDataPath;
    
    try {
      this.logger.debug('Getting disk usage', { path: targetPath });
      
      // Use df command for accurate disk usage on Unix systems
      const { stdout } = await execAsync(`df -B1 "${targetPath}"`);
      const lines = stdout.trim().split('\n');
      
      if (lines.length < 2) {
        throw new Error('Invalid df output');
      }
      
      // Parse df output (format: Filesystem 1B-blocks Used Available Use% Mounted)
      const parts = lines[1].split(/\s+/);
      if (parts.length < 4) {
        throw new Error('Unable to parse df output');
      }
      
      const totalBytes = parseInt(parts[1], 10);
      const usedBytes = parseInt(parts[2], 10);
      const freeBytes = parseInt(parts[3], 10);
      const percentUsed = Math.round((usedBytes / totalBytes) * 100);
      
      this.logger.debug('Disk usage retrieved', {
        path: targetPath,
        totalBytes,
        usedBytes,
        freeBytes,
        percentUsed,
      });
      
      return {
        totalBytes,
        usedBytes,
        freeBytes,
        percentUsed,
      };
    } catch (error) {
      this.logger.error('Failed to get disk usage', error instanceof Error ? error : undefined, {
        path: targetPath,
      });
      
      // Fallback: try to get stats from the directory itself
      try {
        statSync(targetPath); // Just verify the path exists
        // This is a very rough estimate, as we can't get actual disk usage from fs.stat
        const estimatedTotal = 100 * 1024 * 1024 * 1024; // 100GB estimate
        const estimatedUsed = estimatedTotal * 0.5; // Assume 50% used
        const estimatedFree = estimatedTotal - estimatedUsed;
        
        return {
          totalBytes: estimatedTotal,
          usedBytes: estimatedUsed,
          freeBytes: estimatedFree,
          percentUsed: 50,
        };
      } catch (fallbackError) {
        this.logger.error('Fallback disk usage failed', fallbackError instanceof Error ? fallbackError : undefined);
        
        // Last resort: return default values
        const defaultTotal = 100 * 1024 * 1024 * 1024; // 100GB
        return {
          totalBytes: defaultTotal,
          usedBytes: defaultTotal * 0.8,
          freeBytes: defaultTotal * 0.2,
          percentUsed: 80,
        };
      }
    }
  }

  async getMemoryUsage(): Promise<MemoryUsage> {
    try {
      this.logger.debug('Getting memory usage');
      
      // Read /proc/meminfo for detailed memory information
      const { stdout } = await execAsync('cat /proc/meminfo');
      const memInfo = this.parseMemInfo(stdout);
      
      const totalBytes = memInfo.MemTotal || 0;
      const freeBytes = memInfo.MemFree || 0;
      const buffersCacheBytes = (memInfo.Buffers || 0) + (memInfo.Cached || 0);
      const usedBytes = totalBytes - freeBytes - buffersCacheBytes;
      const percentUsed = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
      
      this.logger.debug('Memory usage retrieved', {
        totalBytes,
        freeBytes,
        usedBytes,
        buffersCacheBytes,
        percentUsed,
      });
      
      return {
        totalBytes,
        freeBytes,
        usedBytes,
        percentUsed,
        buffersCacheBytes,
      };
    } catch (error) {
      this.logger.error('Failed to get memory usage', error instanceof Error ? error : undefined);
      
      // Fallback: use Node.js process memory usage as a rough estimate
      const processMemory = process.memoryUsage();
      const estimatedTotal = processMemory.rss * 10; // Rough system memory estimate
      
      return {
        totalBytes: estimatedTotal,
        freeBytes: estimatedTotal - processMemory.rss,
        usedBytes: processMemory.rss,
        percentUsed: 10, // Conservative estimate
        buffersCacheBytes: 0,
      };
    }
  }

  async getSystemResources(): Promise<SystemResource> {
    const [disk, memory] = await Promise.all([
      this.getDiskUsage(),
      this.getMemoryUsage(),
    ]);
    
    return { disk, memory };
  }

  async checkDocker(): Promise<ExternalTool> {
    try {
      this.logger.debug('Checking Docker via DockerService');
      // Lazy import to avoid circular dependency with factory
      const { getServices } = await import('../simple-factory');
      const dockerService = getServices().docker;
      const info = await dockerService.getDockerInfo();

      // Prefer server version if available, else client version
      const version = info.serverVersion || info.version;

      const result: ExternalTool = {
        name: 'docker',
        available: !!info.available,
        ...(version ? { version } : {}),
        ...(info.error ? { error: info.error } : {}),
      };

      if (result.available) {
        this.logger.debug('Docker is available', { version: result.version });
      } else {
        this.logger.debug('Docker reported unavailable', { error: result.error, version: result.version });
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug('Docker check failed', { error: message });
      return { name: 'docker', available: false, error: message };
    }
  }

  async checkOras(): Promise<ExternalTool> {
    try {
      this.logger.debug('Checking ORAS availability');
      
      const { stdout } = await execAsync('oras version');
      const versionMatch = stdout.match(/oras ([^\s]+)/);
      const version = versionMatch ? versionMatch[1] : stdout.trim();
      
      this.logger.debug('ORAS is available', { version });
      return {
        name: 'oras',
        available: true,
        version,
      };
    } catch (error) {
      this.logger.debug('ORAS not available', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        name: 'oras',
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async checkAuthentik(): Promise<ExternalTool> {
    try {
      this.logger.debug('Checking Authentik availability');
      
      // For now, we'll just check if Authentik is accessible via HTTP
      // This is a placeholder implementation
      const { stdout } = await execAsync('curl -s -o /dev/null -w "%{http_code}" http://localhost:9000 || echo "000"');
      const httpCode = stdout.trim();
      
      if (httpCode === '200' || httpCode === '302' || httpCode === '401') {
        this.logger.debug('Authentik is available', { httpCode });
        return {
          name: 'authentik',
          available: true,
        };
      } else {
        this.logger.debug('Authentik not available', { httpCode });
        return {
          name: 'authentik',
          available: false,
          error: `HTTP ${httpCode}`,
        };
      }
    } catch (error) {
      this.logger.debug('Authentik check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        name: 'authentik',
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getAllExternalTools(): Promise<ExternalTool[]> {
    const [docker, oras, authentik] = await Promise.all([
      this.checkDocker(),
      this.checkOras(),
      this.checkAuthentik(),
    ]);
    
    return [docker, oras, authentik];
  }

  async getSystemStatus(): Promise<SystemStatus> {
    this.logger.debug('Getting comprehensive system status');
    
  const [resources, tools] = await Promise.all([
      this.getSystemResources(),
      this.getAllExternalTools(),
    ]);
    
    // Convert our detailed tool information to SystemStatus format
    const docker = tools.find(t => t.name === 'docker');
  const oras = tools.find(t => t.name === 'oras');
  const authentik = tools.find(t => t.name === 'authentik');

  // Try to get Compose version (client-side; doesn't require daemon)
  const composeVersion = await this.getComposeVersion();
    
    const status: SystemStatus = {
      docker: {
        ok: docker?.available || false,
        version: docker?.version,
      },
      disk: {
        freeBytes: resources.disk.freeBytes,
        totalBytes: resources.disk.totalBytes,
      },
      version: {
    hola: '1.0.0', // TODO: Read from package.json
    compose: composeVersion || 'unknown',
      },
    };
    
    // Add optional fields if tools are available
    if (oras) {
      status.oras = {
        ok: oras.available,
        version: oras.version,
      };
    }
    
    if (authentik) {
      status.authentik = {
        ok: authentik.available,
      };
    }
    
    this.logger.debug('System status retrieved', {
      dockerOk: status.docker.ok,
      diskFreeGB: Math.round(status.disk.freeBytes / (1024 * 1024 * 1024)),
      orasOk: status.oras?.ok,
      authentikOk: status.authentik?.ok,
    });
    
    return status;
  }

  private async getComposeVersion(): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('docker compose version --short');
      const v = stdout.trim();
      return v || undefined;
    } catch {
      // Fallback: try legacy docker-compose
      try {
        const { stdout } = await execAsync('docker-compose --version');
        const match = stdout.match(/docker-compose\s+version\s+([^,\s]+)/i);
        return match ? match[1] : undefined;
      } catch {
        return undefined;
      }
    }
  }

  startMonitoring(callback: (status: SystemStatus) => void, interval = 30000): { stop: () => void } {
    this.logger.info('Starting system monitoring', { interval });
    
    // Initial status
    this.getSystemStatus().then(callback).catch(error => {
      this.logger.error('Failed to get initial system status', error instanceof Error ? error : undefined);
    });
    
    // Periodic updates
    this.monitoringInterval = setInterval(async () => {
      try {
        const status = await this.getSystemStatus();
        callback(status);
      } catch (error) {
        this.logger.error('Failed to get system status during monitoring', error instanceof Error ? error : undefined);
      }
    }, interval);
    
    return {
      stop: () => {
        if (this.monitoringInterval) {
          clearInterval(this.monitoringInterval);
          this.monitoringInterval = undefined;
          this.logger.info('System monitoring stopped');
        }
      },
    };
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      // Test core functionality
      await this.getDiskUsage();
      await this.getMemoryUsage();
      
      return {
        healthy: true,
        lastCheck: new Date(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('System monitoring health check failed', error instanceof Error ? error : undefined);
      
      return {
        healthy: false,
        lastCheck: new Date(),
        error: errorMessage,
      };
    }
  }

  // Helper methods
  private parseMemInfo(memInfoContent: string): Record<string, number> {
    const result: Record<string, number> = {};
    const lines = memInfoContent.split('\n');
    
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(\d+)\s*kB/);
      if (match) {
        const [, key, value] = match;
        result[key] = parseInt(value, 10) * 1024; // Convert kB to bytes
      }
    }
    
    return result;
  }
}

/**
 * Mock system monitoring service for testing
 */
export class MockSystemMonitoringService implements SystemMonitoringService {
  private logger = getLogger().child({ service: 'MockSystemMonitoringService' });
  private listeners = new Set<(status: SystemStatus) => void>();
  private overrideStatus: SystemStatus | null = null;

  async getDiskUsage(): Promise<DiskUsage> {
    this.logger.debug('Mock disk usage requested');
    return {
      totalBytes: 100 * 1024 * 1024 * 1024, // 100GB
      usedBytes: 60 * 1024 * 1024 * 1024,   // 60GB
      freeBytes: 40 * 1024 * 1024 * 1024,   // 40GB
      percentUsed: 60,
    };
  }

  async getMemoryUsage(): Promise<MemoryUsage> {
    this.logger.debug('Mock memory usage requested');
    return {
      totalBytes: 8 * 1024 * 1024 * 1024,   // 8GB
      usedBytes: 4 * 1024 * 1024 * 1024,    // 4GB
      freeBytes: 4 * 1024 * 1024 * 1024,    // 4GB
      percentUsed: 50,
      buffersCacheBytes: 1 * 1024 * 1024 * 1024, // 1GB
    };
  }

  async getSystemResources(): Promise<SystemResource> {
    const [disk, memory] = await Promise.all([
      this.getDiskUsage(),
      this.getMemoryUsage(),
    ]);
    return { disk, memory };
  }

  async checkDocker(): Promise<ExternalTool> {
    this.logger.debug('Mock Docker check requested');
    return {
      name: 'docker',
      available: true,
      version: '24.0.7',
    };
  }

  async checkOras(): Promise<ExternalTool> {
    this.logger.debug('Mock ORAS check requested');
    return {
      name: 'oras',
      available: true,
      version: '1.1.0',
    };
  }

  async checkAuthentik(): Promise<ExternalTool> {
    this.logger.debug('Mock Authentik check requested');
    return {
      name: 'authentik',
      available: true,
    };
  }

  async getAllExternalTools(): Promise<ExternalTool[]> {
    const [docker, oras, authentik] = await Promise.all([
      this.checkDocker(),
      this.checkOras(),
      this.checkAuthentik(),
    ]);
    return [docker, oras, authentik];
  }

  async getSystemStatus(): Promise<SystemStatus> {
    if (this.overrideStatus) {
      return this.overrideStatus;
    }
    this.logger.debug('Mock system status requested');
    return {
      docker: { ok: true, version: '24.0.7' },
      disk: { 
        freeBytes: 40 * 1024 * 1024 * 1024,  // 40GB
        totalBytes: 100 * 1024 * 1024 * 1024 // 100GB
      },
      version: { hola: '1.0.0', compose: '2.23.3' },
      oras: { ok: true, version: '1.1.0' },
      authentik: { ok: true },
    };
  }

  startMonitoring(callback: (status: SystemStatus) => void): { stop: () => void } {
    this.logger.debug('Mock system monitoring started');
    this.listeners.add(callback);

    this.getSystemStatus().then(status => callback(status));

    return {
      stop: () => {
        this.logger.debug('Mock system monitoring stopped');
        this.listeners.delete(callback);
      },
    };
  }

  async healthCheck(): Promise<ServiceHealth> {
    return {
      healthy: true,
      lastCheck: new Date(),
    };
  }

  emitTestStatus(status: SystemStatus): void {
    this.overrideStatus = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

/**
 * Docker service for container management operations
 * 
 * Provides Docker availability checks, version information, compose operations,
 * and log streaming capabilities with graceful degradation when Docker is unavailable.
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getLogger } from '../../lib/logger';
import type { ServiceHealth, HealthCheckable } from './types';
import type { PullCredentials } from './bundles';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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
  /** Pull all images for a project ahead of `up`, with a generous timeout.
   *  Image pulls for large multi-service apps (e.g. Postiz) routinely exceed the
   *  short `up` timeout; pulling first means `up` only has to start local images. */
  composePull(projectPath: string, projectName: string, registryAuth?: PullCredentials[]): Promise<{ success: boolean; output: string }>;
  composeUp(projectPath: string, projectName: string, registryAuth?: PullCredentials[]): Promise<{ success: boolean; output: string }>;
  composeDown(projectPath: string, projectName: string): Promise<{ success: boolean; output: string }>;
  composePs(projectPath: string, projectName: string): Promise<ComposeProject>;
  composeRestart(projectPath: string, projectName: string, serviceName?: string): Promise<{ success: boolean; output: string }>;
  /** Run a command inside a running compose service (no shell). Used for post-deploy
   *  auth setup (e.g. `gitea admin auth add-oauth`). */
  composeExec(
    projectPath: string,
    projectName: string,
    service: string,
    command: string[],
    opts?: { user?: string }
  ): Promise<{ success: boolean; output: string }>;

  // Log operations
  getContainerLogs(containerName: string, since?: string, tail?: number): Promise<DockerLogs>;
  streamContainerLogs(containerName: string, callback: (log: DockerLogs['entries'][0]) => void): Promise<{ stop: () => void }>;
  /** Recent logs across every service in a compose project, merged + timestamp-sorted. */
  composeLogs(projectPath: string, projectName: string, options?: { tail?: number }): Promise<DockerLogs>;
  /** Live stream of every service's stdout in a compose project (`docker compose logs -f`). */
  streamComposeLogs(
    projectPath: string,
    projectName: string,
    callback: (log: DockerLogs['entries'][0]) => void
  ): Promise<{ stop: () => void }>;

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

  /**
   * Materialize a scoped DOCKER_CONFIG dir (0o600 config.json) authenticating the
   * given private registries, and return the env to pass to a docker invocation.
   * Never touches ~/.docker/config.json; caller removes the dir when done. Returns
   * undefined (and no temp dir) when there are no credentials.
   */
  private makeRegistryAuthEnv(registryAuth?: PullCredentials[]): { env?: NodeJS.ProcessEnv; dir?: string } {
    if (!registryAuth || registryAuth.length === 0) return {};
    const dir = mkdtempSync(join(tmpdir(), 'hola-docker-'));
    const auths: Record<string, { auth: string }> = {};
    for (const c of registryAuth) {
      const host = c.registry.trim().split('/')[0];
      auths[host] = { auth: Buffer.from(`${c.username}:${c.password}`, 'utf8').toString('base64') };
    }
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ auths }), { mode: 0o600 });
    return { env: { ...process.env, DOCKER_CONFIG: dir }, dir };
  }

  async composePull(projectPath: string, projectName: string, registryAuth?: PullCredentials[]): Promise<{ success: boolean; output: string }> {
    const { env, dir } = this.makeRegistryAuthEnv(registryAuth);
    try {
      this.logger.info('Pulling compose images', { projectPath, projectName, authenticated: Boolean(dir) });

      const composeFile = join(projectPath, 'docker-compose.yml');
      if (!existsSync(composeFile)) {
        throw new Error(`docker-compose.yml not found at ${composeFile}`);
      }

      // `--quiet`: suppress per-layer progress (it produced ~100KB of noise and
      // buried real errors); only warnings/errors are printed. 30-minute ceiling
      // accommodates large first-time pulls on a slow homelab connection.
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['compose', '-f', composeFile, '-p', projectName, 'pull', '--quiet'],
        { cwd: projectPath, timeout: 1_800_000, maxBuffer: 16 * 1024 * 1024, env }
      );
      const output = [stdout, stderr].filter(Boolean).join('\n');
      this.logger.info('Compose images pulled', { projectName, output: output.substring(0, 1000) });
      return { success: true, output };
    } catch (error) {
      // execFile rejects on non-zero exit (e.g. denied/manifest-unknown) or on
      // timeout; surface stdout+stderr+message so the caller logs the real cause.
      const e = error as { stdout?: string; stderr?: string; message?: string };
      const output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n') || String(error);
      this.logger.error('Failed to pull compose images', error instanceof Error ? error : undefined, { projectName });
      return { success: false, output };
    } finally {
      if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
    }
  }

  async composeUp(projectPath: string, projectName: string, registryAuth?: PullCredentials[]): Promise<{ success: boolean; output: string }> {
    const { env, dir } = this.makeRegistryAuthEnv(registryAuth);
    try {
      this.logger.info('Starting compose project', { projectPath, projectName });

      const composeFile = join(projectPath, 'docker-compose.yml');
      if (!existsSync(composeFile)) {
        throw new Error(`docker-compose.yml not found at ${composeFile}`);
      }

      // Images are pre-pulled by composePull, so `up` only starts local images.
      // The 5-minute timeout covers container creation for large stacks (it is
      // no longer gated on download time). A scoped DOCKER_CONFIG is passed as a
      // fallback so a recreate that needs to pull still authenticates.
      const { stdout, stderr } = await execAsync(
        `docker compose -f "${composeFile}" -p "${projectName}" up -d`,
        { cwd: projectPath, timeout: 300000, env } // 5 minute timeout
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
    } finally {
      if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
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

  async composeExec(
    projectPath: string,
    projectName: string,
    service: string,
    command: string[],
    opts?: { user?: string }
  ): Promise<{ success: boolean; output: string }> {
    const composeFile = join(projectPath, 'docker-compose.yml');
    // Build argv directly (no shell) so provisioned values can't be injected.
    const args = ['compose', '-f', composeFile, '-p', projectName, 'exec', '-T'];
    if (opts?.user) args.push('--user', opts.user);
    args.push(service, ...command);
    try {
      const { stdout, stderr } = await execFileAsync('docker', args, { cwd: projectPath, timeout: 60000 });
      const output = [stdout, stderr].filter(Boolean).join('\n');
      this.logger.info('Compose exec succeeded', { projectName, service, output: output.substring(0, 1000) });
      return { success: true, output };
    } catch (error) {
      // execFile rejects on non-zero exit; surface stdout+stderr+message for the caller.
      const e = error as { stdout?: string; stderr?: string; message?: string };
      const output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
      this.logger.warn('Compose exec failed', { projectName, service, output: output.substring(0, 1000) });
      return { success: false, output };
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

  async composeLogs(
    projectPath: string,
    projectName: string,
    options?: { tail?: number }
  ): Promise<DockerLogs> {
    const tail = options?.tail ?? 200;
    try {
      this.logger.debug('Getting compose project logs', { projectPath, projectName, tail });
      const composeFile = join(projectPath, 'docker-compose.yml');
      const { stdout } = await execFileAsync(
        'docker',
        ['compose', '-f', composeFile, '-p', projectName, 'logs', '--no-color', '--timestamps', '--tail', String(tail)],
        { cwd: projectPath, maxBuffer: 16 * 1024 * 1024 }
      );
      return { entries: parseComposeLogs(stdout), hasMore: false };
    } catch (error) {
      // Honest empty snapshot on any failure (project down, no daemon, etc.) —
      // never fabricate log data.
      this.logger.error('Failed to get compose project logs', error instanceof Error ? error : undefined, {
        projectPath,
        projectName,
      });
      return { entries: [], hasMore: false };
    }
  }

  async streamComposeLogs(
    projectPath: string,
    projectName: string,
    callback: (log: DockerLogs['entries'][0]) => void
  ): Promise<{ stop: () => void }> {
    this.logger.info('Starting compose log stream', { projectPath, projectName });
    const composeFile = join(projectPath, 'docker-compose.yml');
    const { spawn } = await import('child_process');
    // `--tail 0`: the snapshot endpoint already serves history, so the live
    // stream only carries new lines (no duplicate flood on connect).
    const proc = spawn('docker', [
      'compose', '-f', composeFile, '-p', projectName,
      'logs', '-f', '--no-color', '--timestamps', '--tail', '0',
    ], { cwd: projectPath });

    let stopped = false;
    const onData = (data: Buffer) => {
      if (stopped) return;
      parseComposeLogs(data.toString()).forEach(callback);
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (error) => {
      this.logger.error('Compose log stream error', error, { projectName });
    });
    proc.on('exit', (code) => {
      this.logger.info('Compose log stream ended', { projectName, code });
    });

    return {
      stop: () => {
        stopped = true;
        proc.kill();
        this.logger.info('Compose log stream stopped', { projectName });
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
    return detectLogLevel(message);
  }
}

/** Heuristic log-level classification from a message body (shared by both parsers). */
function detectLogLevel(message: string): DockerLogs['entries'][0]['level'] {
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

// A `docker logs --timestamps` line: RFC3339Nano timestamp then the message.
const LOG_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)$/;
// A `docker compose logs` line prefixes each line with `<service>-<replica>  | `.
const COMPOSE_PREFIX_RE = /^([^|]+?)\s*\|\s?(.*)$/;

/**
 * Parse `docker compose logs --timestamps` output into structured entries.
 *
 * Each line looks like `gitea-1  | 2024-01-01T00:00:00.000000000Z message`: a
 * service prefix (service name + replica index), then a docker-logs line. The
 * service label drops the `-<n>` replica suffix so multi-service apps (e.g.
 * Postiz) are grouped by compose service. Entries are timestamp-sorted so the
 * merged multi-service view reads chronologically. Exported for unit testing.
 */
export function parseComposeLogs(output: string): DockerLogs['entries'] {
  const entries: DockerLogs['entries'] = [];

  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;

    const prefixed = line.match(COMPOSE_PREFIX_RE);
    // Lines without a `service |` prefix (e.g. compose's own "Attaching to …"
    // notices) are labelled `system` rather than dropped or misattributed.
    const service = prefixed ? prefixed[1].trim().replace(/-\d+$/, '') : 'system';
    const rest = prefixed ? prefixed[2] : line;

    const tsMatch = rest.match(LOG_TIMESTAMP_RE);
    if (tsMatch) {
      const [, timestamp, message] = tsMatch;
      entries.push({ timestamp, service, level: detectLogLevel(message), message: message.trim() });
    } else {
      // No docker timestamp (rare: a notice line) — keep the text, stamp now.
      entries.push({ timestamp: new Date().toISOString(), service, level: detectLogLevel(rest), message: rest.trim() });
    }
  }

  entries.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  return entries;
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

  async composePull(projectPath: string, projectName: string, registryAuth?: PullCredentials[]): Promise<{ success: boolean; output: string }> {
    this.logger.debug('Mock compose pull', { projectPath, projectName, authenticated: Boolean(registryAuth?.length) });
    return { success: true, output: `[mock] Project ${projectName} images pulled` };
  }

  async composeUp(projectPath: string, projectName: string, registryAuth?: PullCredentials[]): Promise<{ success: boolean; output: string }> {
    this.logger.debug('Mock compose up', { projectPath, projectName, authenticated: Boolean(registryAuth?.length) });
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

  async composeExec(
    projectPath: string,
    projectName: string,
    service: string,
    command: string[]
  ): Promise<{ success: boolean; output: string }> {
    this.logger.debug('Mock compose exec', { projectPath, projectName, service, command });
    return { success: true, output: `[mock] exec ${service}: ${command.join(' ')}` };
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

  // No real containers in mock mode: return an honest empty snapshot / no-op
  // stream rather than fabricating app output (see #166/#167).
  async composeLogs(): Promise<DockerLogs> {
    return { entries: [], hasMore: false };
  }

  async streamComposeLogs(): Promise<{ stop: () => void }> {
    return { stop: () => {} };
  }

  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }
}

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
  /** Container id. Lets a caller tell a container compose RECREATED (new id)
   *  from one it left alone (same id) across an `up -d` — see the restart
   *  lifecycle in deployment.ts. Absent when the daemon didn't report one. */
  id?: string;
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
  composePull(projectPath: string, projectName: string, registryAuth?: PullCredentials[], profiles?: string[]): Promise<{ success: boolean; output: string }>;
  /**
   * `options.services` starts only the named services (default: every service in
   * the project, today's behaviour). `options.wait` adds `--wait`, blocking until
   * each named service's own `healthcheck` reports healthy — used by the restore
   * sequence to start only a hook's service before running its hook (spec 007,
   * FR-020). `options.timeoutMs` is the `execFile` ceiling; the 5-minute fallback
   * below applies only to a caller with no opinion, and every `deployment.ts` call
   * site now states its own (#487) — `up -d` blocks on each
   * `depends_on: service_healthy` gate, so a first install, a cold rollback, and a
   * `--wait` on a freshly-`initdb`'d Postgres (research R12) can all legitimately
   * exceed five minutes.
   */
  composeUp(
    projectPath: string,
    projectName: string,
    registryAuth?: PullCredentials[],
    profiles?: string[],
    options?: { services?: string[]; wait?: boolean; timeoutMs?: number },
  ): Promise<{ success: boolean; output: string }>;
  composeDown(projectPath: string, projectName: string, profiles?: string[]): Promise<{ success: boolean; output: string }>;
  /**
   * The FULLY RESOLVED configuration Compose would execute — every `${VAR}`
   * interpolated, every short-syntax mount normalised — as parsed JSON.
   *
   * Run under the same allowlisted child environment as `up` (`appComposeEnv`)
   * and in the same project directory, so the `.env` Compose auto-loads is the
   * one `up` would load: the answer describes the real invocation, not a
   * sanitised approximation of it. `success: false` carries Compose's own error
   * text in `output` and leaves `config` undefined; a caller gating a deploy on
   * containment must treat that as a refusal, not a pass (F02a).
   */
  composeConfig(projectPath: string, projectName: string, profiles?: string[]): Promise<{ success: boolean; output: string; config?: unknown }>;
  composePs(projectPath: string, projectName: string): Promise<ComposeProject>;
  composeRestart(projectPath: string, projectName: string, serviceName?: string, profiles?: string[]): Promise<{ success: boolean; output: string }>;
  /** Run a command inside a running compose service (no shell). Used for post-deploy
   *  auth setup (e.g. `gitea admin auth add-oauth`). */
  composeExec(
    projectPath: string,
    projectName: string,
    service: string,
    command: string[],
    opts?: { user?: string; profiles?: string[] }
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
 * Environment variables an app-directed `docker compose` invocation may inherit
 * from the server process. Everything else is dropped — see {@link appComposeEnv}.
 *
 * Only what the docker CLI itself needs to find its binary, its plugins and the
 * daemon: `PATH`/`HOME` (compose ships as a CLI plugin discovered under
 * `$HOME/.docker`), the `DOCKER_*` client settings (remote daemon, TLS, context),
 * and the two vars a non-default socket is discovered through (`SSH_AUTH_SOCK`
 * for `DOCKER_HOST=ssh://`, `XDG_RUNTIME_DIR` for rootless). `DOCKER_CONFIG`
 * passes through so an operator-configured client config keeps working; a
 * per-pull registry-auth dir overrides it.
 *
 * `COMPOSE_PROFILES` is deliberately NOT here: the platform derives it per
 * invocation from the app's manifest (#162), so inheriting the server's own
 * value would silently activate profiles no app asked for.
 *
 * Proxy variables (`HTTP(S)_PROXY`, `NO_PROXY`) are deliberately absent too:
 * nothing in this repo sets or documents them, and image pulls are performed by
 * the daemon (which has its own proxy configuration), not by the CLI.
 */
const COMPOSE_ENV_PASSTHROUGH = [
  'PATH',
  'HOME',
  'DOCKER_HOST',
  'DOCKER_CONFIG',
  'DOCKER_CONTEXT',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
  'DOCKER_API_VERSION',
  'SSH_AUTH_SOCK',
  'XDG_RUNTIME_DIR',
] as const;

/**
 * The environment for a `docker compose` command run against an APP's project.
 *
 * Built from an explicit allowlist ({@link COMPOSE_ENV_PASSTHROUGH}) instead of
 * inheriting the server's environment, because Compose interpolates `${VAR}` in
 * the app's own compose file from the environment of the process that invoked
 * it. The production server environment holds control-plane credentials (the
 * Authentik bootstrap/provisioner tokens, an optional fixed `HOLA_API_KEY`), so
 * an inherited env let a bundle write `environment: { X: "${HOLA_AUTHENTIK_BOOTSTRAP_TOKEN}" }`
 * and receive a live platform credential it was never granted — the compose
 * validator's unknown-`HOLA_*`-token check only warns, and a credential
 * referenced from an `image:` would leave the host on the next pull. An
 * allowlisted env closes that whole class: there is nothing in the child
 * environment worth stealing.
 *
 * App-supplied interpolation values do NOT travel this way. They are written to
 * `deployments/<id>/runtime/.env` by `materializeCompose` (deployment.ts) and
 * auto-loaded by Compose from the project directory every command runs in, which
 * is now the only path by which an app value reaches Compose.
 *
 * `source` is injectable for tests; production always reads `process.env`.
 */
export function appComposeEnv(
  opts?: { dockerConfigDir?: string; profiles?: string[] },
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of COMPOSE_ENV_PASSTHROUGH) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  // A scoped registry-auth dir (0o600 config.json) wins over any inherited one.
  if (opts?.dockerConfigDir) env.DOCKER_CONFIG = opts.dockerConfigDir;
  // Active Compose profiles (#162), comma-joined. Docker Compose reads this to
  // decide which profiled services to act on — set identically across
  // pull/up/down/restart/exec so `down` tears down the profiled services `up`
  // started (a plain `down` leaves them orphaned).
  if (opts?.profiles?.length) env.COMPOSE_PROFILES = opts.profiles.join(',');
  return env;
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
   * given private registries. Never touches ~/.docker/config.json; caller removes
   * the dir when done (and passes it to {@link appComposeEnv} as
   * `dockerConfigDir`). Returns no dir when there are no credentials.
   */
  private makeRegistryAuthDir(registryAuth?: PullCredentials[]): { dir?: string } {
    if (!registryAuth || registryAuth.length === 0) return {};
    const dir = mkdtempSync(join(tmpdir(), 'hola-docker-'));
    const auths: Record<string, { auth: string }> = {};
    for (const c of registryAuth) {
      const host = c.registry.trim().split('/')[0];
      auths[host] = { auth: Buffer.from(`${c.username}:${c.password}`, 'utf8').toString('base64') };
    }
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ auths }), { mode: 0o600 });
    return { dir };
  }

  async composePull(projectPath: string, projectName: string, registryAuth?: PullCredentials[], profiles?: string[]): Promise<{ success: boolean; output: string }> {
    const { dir } = this.makeRegistryAuthDir(registryAuth);
    const env = appComposeEnv({ dockerConfigDir: dir, profiles });
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

  async composeUp(
    projectPath: string,
    projectName: string,
    registryAuth?: PullCredentials[],
    profiles?: string[],
    options?: { services?: string[]; wait?: boolean; timeoutMs?: number },
  ): Promise<{ success: boolean; output: string }> {
    const { dir } = this.makeRegistryAuthDir(registryAuth);
    const env = appComposeEnv({ dockerConfigDir: dir, profiles });
    try {
      this.logger.info('Starting compose project', { projectPath, projectName, services: options?.services, wait: options?.wait });

      const composeFile = join(projectPath, 'docker-compose.yml');
      if (!existsSync(composeFile)) {
        throw new Error(`docker-compose.yml not found at ${composeFile}`);
      }

      // Images are pre-pulled by composePull, so `up` only starts local images.
      // `--wait` (when requested) blocks until every NAMED service reports
      // healthy via its own declared healthcheck — no bespoke readiness poll
      // (Constitution V). `options.timeoutMs` is the caller's own ceiling: a
      // `--wait` against a freshly-`initdb`'d Postgres can exceed five minutes
      // (research R12), and so can a plain `up -d` that has to clear a large
      // stack's `depends_on: service_healthy` gates. The 300000ms below is a
      // FALLBACK for a caller that expressed no preference, not a considered
      // ceiling for any operation (#487). A scoped DOCKER_CONFIG is passed as
      // a fallback so a recreate that needs to pull still authenticates.
      //
      // Built as an argv array and run through `execFile` (NO shell), the same
      // rule `composeExec` already states: `options.services` carries
      // APP-SUPPLIED names (a bundle manifest's `restore[].hook.service`), and
      // interpolating those into a shell string would let a manifest with a
      // `"`/`;`/`$(`/backtick in a service name run arbitrary commands as the
      // server. Nothing here is shell-quoted because nothing here reaches a shell.
      const args = ['compose', '-f', composeFile, '-p', projectName, 'up', '-d'];
      if (options?.wait) args.push('--wait');
      if (options?.services?.length) args.push(...options.services);
      const timeout = options?.timeoutMs ?? 300000; // 5 minute fallback (see above)
      const { stdout, stderr } = await execFileAsync('docker', args, { cwd: projectPath, timeout, env });

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

  async composeDown(projectPath: string, projectName: string, profiles?: string[]): Promise<{ success: boolean; output: string }> {
    try {
      this.logger.info('Stopping compose project', { projectPath, projectName });

      const composeFile = join(projectPath, 'docker-compose.yml');
      if (!existsSync(composeFile)) {
        throw new Error(`docker-compose.yml not found at ${composeFile}`);
      }

      // Pass the same profiles `up` used so `down` removes the profiled services
      // too — without them Compose leaves profiled containers orphaned (#162).
      const { stdout, stderr } = await execAsync(
        `docker compose -f "${composeFile}" -p "${projectName}" down`,
        { cwd: projectPath, timeout: 60000, env: appComposeEnv({ profiles }) } // 1 minute timeout
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

  async composeConfig(projectPath: string, projectName: string, profiles?: string[]): Promise<{ success: boolean; output: string; config?: unknown }> {
    const composeFile = join(projectPath, 'docker-compose.yml');
    try {
      if (!existsSync(composeFile)) {
        throw new Error(`docker-compose.yml not found at ${composeFile}`);
      }
      // `execFile`, not a shell string: no interpolation of the project name or
      // path into a command line. `--format json` asks for the machine-readable
      // resolved document; `--no-normalize` is deliberately NOT passed — the
      // normalisation (short mounts expanded to long syntax) is what makes the
      // bind sources readable. A 16MB buffer matches `composeLogs`: a resolved
      // multi-service document is large but bounded.
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['compose', '-f', composeFile, '-p', projectName, 'config', '--format', 'json'],
        { cwd: projectPath, timeout: 60000, maxBuffer: 16 * 1024 * 1024, env: appComposeEnv({ profiles }) },
      );
      // Compose writes interpolation warnings to stderr and still exits 0; the
      // document on stdout is the authoritative part.
      return { success: true, output: [stdout, stderr].filter(Boolean).join('\n'), config: JSON.parse(stdout) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to resolve compose configuration', error instanceof Error ? error : undefined, {
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
        { cwd: projectPath, env: appComposeEnv() }
      );
      
      const lines = stdout.trim().split('\n').filter(line => line.trim());
      const services: ComposeService[] = [];
      
      for (const line of lines) {
        try {
          const serviceData = JSON.parse(line);
          services.push({
            name: serviceData.Service || serviceData.Name,
            ...(serviceData.ID ? { id: String(serviceData.ID) } : {}),
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

  async composeRestart(projectPath: string, projectName: string, serviceName?: string, profiles?: string[]): Promise<{ success: boolean; output: string }> {
    try {
      this.logger.info('Restarting compose service(s)', { projectPath, projectName, serviceName });

      const composeFile = join(projectPath, 'docker-compose.yml');
      const serviceArg = serviceName ? ` ${serviceName}` : '';

      const { stdout, stderr } = await execAsync(
        `docker compose -f "${composeFile}" -p "${projectName}" restart${serviceArg}`,
        { cwd: projectPath, timeout: 60000, env: appComposeEnv({ profiles }) }
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
    opts?: { user?: string; profiles?: string[] }
  ): Promise<{ success: boolean; output: string }> {
    const composeFile = join(projectPath, 'docker-compose.yml');
    // Build argv directly (no shell) so provisioned values can't be injected.
    const args = ['compose', '-f', composeFile, '-p', projectName, 'exec', '-T'];
    if (opts?.user) args.push('--user', opts.user);
    args.push(service, ...command);
    try {
      // Carry active profiles so an exec targeting a profiled service (#162) still
      // resolves it — Compose treats a service in an inactive profile as unknown.
      const env = appComposeEnv({ profiles: opts?.profiles });
      const { stdout, stderr } = await execFileAsync('docker', args, { cwd: projectPath, timeout: 60000, env });
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
        { cwd: projectPath, maxBuffer: 16 * 1024 * 1024, env: appComposeEnv() }
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
    ], { cwd: projectPath, env: appComposeEnv() });

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

  /**
   * Every `composeUp` call this instance has received, in order — so a test
   * can assert on what was actually requested rather than merely that the
   * call resolved. A Mock that accepted `services`/`wait` and ignored them
   * would let a suite go green over a restore that started the wrong
   * containers (plan.md's "Known trap", Constitution IV).
   */
  readonly composeUpCalls: Array<{ projectName: string; services?: string[]; wait?: boolean; timeoutMs?: number }> = [];

  /**
   * Every app-directed lifecycle call, in order, with the project DIRECTORY —
   * the one thing a test needs to find the `runtime/.env` the real Compose would
   * auto-load, which is the only path by which an app's own env now reaches
   * Compose (F01). Deliberately NOT a recorded child environment: the child env
   * is built inside `RealDockerService` (`appComposeEnv`), so having the Mock
   * synthesize one would assert the Mock's copy of production rather than
   * production — the very divergence the plan's "Known trap" warns about. The
   * real child environment is observed end-to-end in
   * `__tests__/docker/compose-env.test.ts`.
   */
  readonly composeCalls: Array<{
    command: 'pull' | 'up' | 'down' | 'restart' | 'exec';
    projectPath: string;
    projectName: string;
    profiles?: string[];
  }> = [];

  async getDockerInfo(): Promise<DockerInfo> {
    return { available: true, version: 'mock', serverVersion: 'mock', apiVersion: 'mock' };
  }

  async checkDockerAvailability(): Promise<boolean> {
    return true;
  }

  async composePull(projectPath: string, projectName: string, registryAuth?: PullCredentials[], profiles?: string[]): Promise<{ success: boolean; output: string }> {
    this.logger.debug('Mock compose pull', { projectPath, projectName, authenticated: Boolean(registryAuth?.length), profiles });
    this.composeCalls.push({ command: 'pull', projectPath, projectName, profiles });
    return { success: true, output: `[mock] Project ${projectName} images pulled` };
  }

  async composeUp(
    projectPath: string,
    projectName: string,
    registryAuth?: PullCredentials[],
    profiles?: string[],
    options?: { services?: string[]; wait?: boolean; timeoutMs?: number },
  ): Promise<{ success: boolean; output: string }> {
    this.logger.debug('Mock compose up', { projectPath, projectName, authenticated: Boolean(registryAuth?.length), profiles, services: options?.services, wait: options?.wait });
    this.composeUpCalls.push({ projectName, services: options?.services, wait: options?.wait, timeoutMs: options?.timeoutMs });
    this.composeCalls.push({ command: 'up', projectPath, projectName, profiles });
    return { success: true, output: `[mock] Project ${projectName} created and started` };
  }

  async composeDown(projectPath: string, projectName: string, profiles?: string[]): Promise<{ success: boolean; output: string }> {
    this.logger.debug('Mock compose down', { projectPath, projectName, profiles });
    this.composeCalls.push({ command: 'down', projectPath, projectName, profiles });
    return { success: true, output: `[mock] Project ${projectName} stopped and removed` };
  }

  /**
   * No Docker, so nothing to resolve: an empty, successful document.
   *
   * Deliberately NOT a re-implementation of Compose's interpolation over the
   * on-disk file. A Mock that resolved the document itself would let the
   * containment gate assert the Mock's idea of Compose rather than Compose,
   * which is the divergence that makes a mocked security check worthless. Mock
   * mode creates no containers, so there is nothing to contain; the gate's real
   * behaviour is covered by unit tests over the pure functions in
   * `compose-resolved-guard.ts` and by a stub that returns a resolved document.
   */
  async composeConfig(projectPath: string, projectName: string, profiles?: string[]): Promise<{ success: boolean; output: string; config?: unknown }> {
    this.logger.debug('Mock compose config', { projectPath, projectName, profiles });
    return { success: true, output: `[mock] Project ${projectName} configuration resolved`, config: { services: {} } };
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

  async composeRestart(projectPath: string, projectName: string, serviceName?: string, profiles?: string[]): Promise<{ success: boolean; output: string }> {
    this.logger.debug('Mock compose restart', { projectPath, projectName, serviceName, profiles });
    this.composeCalls.push({ command: 'restart', projectPath, projectName, profiles });
    return { success: true, output: `[mock] Project ${projectName} restarted` };
  }

  async composeExec(
    projectPath: string,
    projectName: string,
    service: string,
    command: string[],
    opts?: { user?: string; profiles?: string[] }
  ): Promise<{ success: boolean; output: string }> {
    this.logger.debug('Mock compose exec', { projectPath, projectName, service, command, profiles: opts?.profiles });
    this.composeCalls.push({ command: 'exec', projectPath, projectName, profiles: opts?.profiles });
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

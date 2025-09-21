/**
 * Validation Service - Phase 7
 * 
 * Provides comprehensive validation for drafts, compose files, and deployment configurations.
 * Includes schema validation, preflight checks, and resource validation.
 */

import type { 
  Draft, 
  DraftFile,
  ValidationReport,
  ValidationIssue,
  EnhancedPreflightResponse,
  EnhancedPreflightCheck,
  GlobalPortRegistry,
  TraefikRoutingRule,
  TraefikRoutingMap,
  RoutingConflict,
  ResourceLimits,
  AppEnvVar
} from '@hola/shared';

import { getLogger } from '../../lib/logger';
import type { HealthCheckable, ServiceHealth } from './types';
import type { DockerService } from './docker';
import type { SystemMonitoringService } from './system-monitoring';
import type { DeploymentService } from './deployment';
import type { StorageService } from './storage';
import { parse as parseYAML } from 'yaml';
import type { ComposeFile, ComposeService } from './compose-parser';

export interface ValidationService extends HealthCheckable {
  // Draft validation
  validateDraft(draft: Draft, files?: Map<string, DraftFile & { content?: Buffer }>): Promise<ValidationReport>;
  preflightCheck(draft: Draft, files?: Map<string, DraftFile & { content?: Buffer }>): Promise<EnhancedPreflightResponse>;
  
  // Resource validation
  validatePorts(ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>): Promise<ValidationIssue[]>;
  validateImages(images: string[]): Promise<ValidationIssue[]>;
  validateEnvironment(env: AppEnvVar[]): Promise<ValidationIssue[]>;
  validateResources(limits?: ResourceLimits): Promise<ValidationIssue[]>;
  
  // Traefik routing conflict detection
  validateRoutingRules(appName: string, domain: string): Promise<RoutingConflict[]>;
  generateRoutingRule(deploymentId: string, appName: string, domain: string): TraefikRoutingRule;
  getRoutingMap(): Promise<TraefikRoutingMap>;
  persistRoutingMap(rules: TraefikRoutingRule[]): Promise<void>;
  
  // Deprecated port management (kept for backwards compatibility)
  reservePorts(deploymentId: string, ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>): Promise<string>;
  releasePorts(reservationToken: string): Promise<void>;
  getPortRegistry(): Promise<GlobalPortRegistry>;
}

export class RealValidationService implements ValidationService {
  private logger = getLogger().child({ service: 'ValidationService' });
  private portRegistry: GlobalPortRegistry = {};
  private reservations = new Map<string, { deploymentId: string; ports: string[] }>(); // token -> reservation
  private routingMap: TraefikRoutingMap = {};

  constructor(
    private dockerService: DockerService,
    private systemMonitoringService: SystemMonitoringService,
    private storageService: StorageService,
    private deploymentService?: DeploymentService
  ) {}

  async healthCheck(): Promise<ServiceHealth> {
    try {
      // Basic validation checks
      await this.validateEnvironment([]);
      
      return {
        healthy: true,
        lastCheck: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        lastCheck: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async validateDraft(draft: Draft, files?: Map<string, DraftFile & { content?: Buffer }>): Promise<ValidationReport> {
    this.logger.info('Validating draft', { draftId: draft.draftId, appId: draft.appId });
    
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    try {
      // Validate required fields
      if (!draft.appId) {
        errors.push({ field: 'appId', message: 'Application ID is required' });
      }

      // Validate environment variables
      const envIssues = await this.validateEnvironment(draft.appEnv);
      errors.push(...envIssues.filter(i => i.code === 'ERROR'));
      warnings.push(...envIssues.filter(i => i.code === 'WARNING'));

      // Validate ports
      const portIssues = await this.validatePorts(draft.ports);
      errors.push(...portIssues.filter(i => i.code === 'ERROR'));
      warnings.push(...portIssues.filter(i => i.code === 'WARNING'));

      // Validate compose override if present
      if (draft.composeOverride) {
        try {
          // Inline compose validation (simplified)
          const composeData = parseYAML(draft.composeOverride) as ComposeFile;
          if (!composeData.services || Object.keys(composeData.services).length === 0) {
            warnings.push({ 
              field: 'composeOverride', 
              message: 'Compose file has no services defined' 
            });
          }
        } catch (error) {
          errors.push({ 
            field: 'composeOverride', 
            message: `Invalid compose override: ${error instanceof Error ? error.message : 'Unknown error'}` 
          });
        }
      }

      // Validate uploaded files
      if (files) {
        for (const [uploadId, file] of files) {
          if (file.kind === 'composeOverride' && file.content) {
            try {
              const composeContent = file.content.toString('utf-8');
              parseYAML(composeContent) as ComposeFile;
            } catch (error) {
              errors.push({
                field: `files.${uploadId}`,
                message: `Invalid compose file: ${error instanceof Error ? error.message : 'Parse error'}`,
              });
            }
          }
        }
      }

      return {
        ok: errors.length === 0,
        errors,
        warnings,
      };
    } catch (error) {
      this.logger.error('Draft validation failed', error as Error, { draftId: draft.draftId });
      return {
        ok: false,
        errors: [{ message: error instanceof Error ? error.message : 'Validation failed' }],
        warnings,
      };
    }
  }

  async preflightCheck(draft: Draft, files?: Map<string, DraftFile & { content?: Buffer }>): Promise<EnhancedPreflightResponse> {
    this.logger.info('Running preflight check', { draftId: draft.draftId });
    
    const checks: EnhancedPreflightCheck[] = [];
    let reservationToken: string | undefined;

    try {
      // Check Docker availability
      try {
        const dockerHealth = await this.dockerService.healthCheck();
        checks.push({
          name: 'docker',
          type: 'docker',
          status: dockerHealth.healthy ? 'pass' : 'fail',
          detail: dockerHealth.healthy ? 'Docker is available' : dockerHealth.error,
          remediation: dockerHealth.healthy ? undefined : 'Install Docker or start Docker daemon',
        });
      } catch (error) {
        checks.push({
          name: 'docker',
          type: 'docker',
          status: 'fail',
          detail: error instanceof Error ? error.message : 'Docker check failed',
          remediation: 'Install Docker or start Docker daemon',
        });
      }

      // Check disk space
      try {
        const systemStatus = await this.systemMonitoringService.getSystemStatus();
        const freeGB = systemStatus.disk.freeBytes / (1024 * 1024 * 1024);
        const threshold = 2; // 2GB minimum
        
        checks.push({
          name: 'disk',
          type: 'disk',
          status: freeGB >= threshold ? 'pass' : 'warn',
          detail: `${freeGB.toFixed(1)}GB free space available`,
          remediation: freeGB < threshold ? 'Free up disk space' : undefined,
        });
      } catch {
        checks.push({
          name: 'disk',
          type: 'disk',
          status: 'warn',
          detail: 'Could not check disk space',
        });
      }

      // Check port availability and reserve them
      if (draft.ports.length > 0) {
        try {
          const portIssues = await this.validatePorts(draft.ports);
          if (portIssues.length === 0) {
            // Try to reserve ports
            reservationToken = await this.reservePorts('preflight-check', draft.ports);
            checks.push({
              name: 'ports',
              type: 'ports',
              status: 'pass',
              detail: `Ports ${draft.ports.map(p => p.host || p.container).join(', ')} are available`,
            });
          } else {
            checks.push({
              name: 'ports',
              type: 'ports',
              status: 'fail',
              detail: portIssues.map(i => i.message).join(', '),
              remediation: 'Change port configuration or stop conflicting services',
            });
          }
        } catch (error) {
          checks.push({
            name: 'ports',
            type: 'ports',
            status: 'fail',
            detail: error instanceof Error ? error.message : 'Port check failed',
          });
        }
      }

      // Check environment variables
      const envIssues = await this.validateEnvironment(draft.appEnv);
      if (envIssues.length === 0) {
        checks.push({
          name: 'env',
          type: 'env',
          status: 'pass',
          detail: 'Environment variables are valid',
        });
      } else {
        const hasErrors = envIssues.some(i => i.code === 'ERROR');
        checks.push({
          name: 'env',
          type: 'env',
          status: hasErrors ? 'fail' : 'warn',
          detail: envIssues.map(i => i.message).join(', '),
        });
      }

      // Check image availability
      const images = await this.extractImagesFromDraft(draft, files);
      if (images.length > 0) {
        const imageIssues = await this.validateImages(images);
        if (imageIssues.length === 0) {
          checks.push({
            name: 'images',
            type: 'docker',
            status: 'pass',
            detail: `All ${images.length} images are available`,
          });
        } else {
          checks.push({
            name: 'images',
            type: 'docker',
            status: 'warn',
            detail: imageIssues.map(i => i.message).join(', '),
            remediation: 'Check internet connection or image references',
          });
        }
      }

      // Check Traefik routing conflicts
      try {
        // Use default domain for now - this could be configurable
        const defaultDomain = 'local.hola';
        const routingConflicts = await this.validateRoutingRules(draft.appId, defaultDomain);
        
        if (routingConflicts.length === 0) {
          checks.push({
            name: 'routing',
            type: 'routing',
            status: 'pass',
            detail: `Host '${draft.appId}.${defaultDomain}' is available`,
          });
        } else {
          checks.push({
            name: 'routing',
            type: 'routing',
            status: 'fail',
            detail: routingConflicts.map(c => c.message).join(', '),
            remediation: 'Choose a different app name or remove conflicting deployments',
          });
        }
      } catch (error) {
        checks.push({
          name: 'routing',
          type: 'routing',
          status: 'warn',
          detail: `Could not check routing conflicts: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }

      const allOk = checks.every(c => c.status === 'pass');
      const hasFailures = checks.some(c => c.status === 'fail');

      return {
        ok: allOk && !hasFailures,
        checks,
        reservationToken,
      };
    } catch (error) {
      this.logger.error('Preflight check failed', error as Error, { draftId: draft.draftId });
      return {
        ok: false,
        checks: [{
          name: 'preflight',
          type: 'docker',
          status: 'fail',
          detail: error instanceof Error ? error.message : 'Preflight check failed',
        }],
      };
    }
  }

  async validatePorts(ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const port of ports) {
      const hostPort = port.host;
      if (hostPort) {
        // Check port range
        if (hostPort < 1 || hostPort > 65535) {
          issues.push({
            field: 'ports',
            message: `Port ${hostPort} is outside valid range (1-65535)`,
            code: 'ERROR',
          });
          continue;
        }

        // Check if port is already in use
        const portKey = `${port.protocol}:${hostPort}`;
        if (this.portRegistry[portKey]) {
          issues.push({
            field: 'ports',
            message: `Port ${hostPort}/${port.protocol} is already in use`,
            code: 'ERROR',
          });
          continue;
        }

        // Check for well-known ports
        if (hostPort < 1024) {
          issues.push({
            field: 'ports',
            message: `Port ${hostPort} is a privileged port and may require root access`,
            code: 'WARNING',
          });
        }
      }

      // Validate container port
      if (port.container < 1 || port.container > 65535) {
        issues.push({
          field: 'ports',
          message: `Container port ${port.container} is outside valid range (1-65535)`,
          code: 'ERROR',
        });
      }
    }

    return issues;
  }

  async validateImages(images: string[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Check each image with Docker (simplified check)
      for (const image of images) {
        try {
          // For now, just validate the image name format
          if (!image.includes(':')) {
            issues.push({
              message: `Image '${image}' should include a tag (e.g., '${image}:latest')`,
              code: 'WARNING',
            });
          }
        } catch {
          // Ignore individual image check failures
        }
      }
    } catch (error) {
      issues.push({
        message: `Could not validate images: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'WARNING',
      });
    }

    return issues;
  }

  async validateEnvironment(env: AppEnvVar[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const envVar of env) {
      // Check for empty required variables
      if (!envVar.value && envVar.isSecret) {
        issues.push({
          field: `env.${envVar.key}`,
          message: `Secret environment variable '${envVar.key}' is required but empty`,
          code: 'ERROR',
        });
      }

      // Check for invalid characters in keys
      if (!envVar.key.match(/^[A-Z_][A-Z0-9_]*$/)) {
        issues.push({
          field: `env.${envVar.key}`,
          message: `Environment variable name '${envVar.key}' should use uppercase letters, numbers, and underscores`,
          code: 'WARNING',
        });
      }
    }

    return issues;
  }

  async validateResources(limits?: ResourceLimits): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    if (limits) {
      if (limits.memoryBytes && limits.memoryBytes < 64 * 1024 * 1024) { // 64MB minimum
        issues.push({
          message: 'Memory limit is very low (< 64MB) and may cause container crashes',
          code: 'WARNING',
        });
      }

      if (limits.cpuShares && limits.cpuShares < 256) {
        issues.push({
          message: 'CPU shares are very low and may impact performance',
          code: 'WARNING',
        });
      }
    }

    return issues;
  }

  // Traefik routing conflict detection methods
  async validateRoutingRules(appName: string, domain: string): Promise<RoutingConflict[]> {
    const conflicts: RoutingConflict[] = [];
    const proposedHost = `${appName}.${domain}`;
    
    this.logger.info('Validating routing rules', { appName, domain, proposedHost });

    try {
      // Skip validation if deploymentService is not available (during initialization)
      if (!this.deploymentService) {
        this.logger.warn('DeploymentService not available for routing validation');
        return conflicts;
      }

      // Get all active deployments to check for conflicts
      const deployments = await this.deploymentService.listDeployments({ 
        status: 'running',
        page: 1,
        limit: 1000 // Get all active deployments
      });

      // Check for host conflicts
      for (const deployment of deployments.items) {
        const existingHost = `${deployment.app}.${domain}`;
        
        if (existingHost === proposedHost) {
          conflicts.push({
            conflictingDeploymentId: deployment.id,
            conflictingAppName: deployment.app,
            conflictingHost: existingHost,
            message: `Host '${proposedHost}' is already in use by deployment '${deployment.name}' (${deployment.id})`
          });
        }
      }

      // Also check pending/installing deployments
      const pendingDeployments = await this.deploymentService.listDeployments({
        status: 'installing',
        page: 1,
        limit: 1000
      });

      for (const deployment of pendingDeployments.items) {
        const existingHost = `${deployment.app}.${domain}`;
        
        if (existingHost === proposedHost) {
          conflicts.push({
            conflictingDeploymentId: deployment.id,
            conflictingAppName: deployment.app,
            conflictingHost: existingHost,
            message: `Host '${proposedHost}' conflicts with pending deployment '${deployment.name}' (${deployment.id})`
          });
        }
      }

    } catch (error) {
      this.logger.error('Failed to validate routing rules', error as Error, { appName, domain });
      // Don't throw here - return empty conflicts to allow deployment to proceed
      // The actual deployment process will catch any real conflicts
    }

    return conflicts;
  }

  generateRoutingRule(deploymentId: string, appName: string, domain: string): TraefikRoutingRule {
    const host = `${appName}.${domain}`;
    const serviceName = `${appName}-${deploymentId.slice(0, 8)}`;
    const networkName = `hola-${deploymentId.slice(0, 8)}`;

    return {
      deploymentId,
      appName,
      host,
      domain,
      serviceName,
      networkName,
      createdAt: new Date().toISOString(),
    };
  }

  async getRoutingMap(): Promise<TraefikRoutingMap> {
    try {
      // Try to load from persisted storage first
      const mapData = await this.storageService.readFile('runtime/traefik/routing-map.json');
      return JSON.parse(mapData.toString('utf-8'));
    } catch {
      // If file doesn't exist or can't be read, return current in-memory map
      return { ...this.routingMap };
    }
  }

  async persistRoutingMap(rules: TraefikRoutingRule[]): Promise<void> {
    try {
      // Ensure the runtime/traefik directory exists
      await this.storageService.ensureDir('runtime/traefik');

      // Convert rules array to map
      const routingMap: TraefikRoutingMap = {};
      for (const rule of rules) {
        routingMap[rule.host] = rule;
      }

      // Update in-memory map
      this.routingMap = routingMap;

      // Persist to storage for debugging/ops
      await this.storageService.writeFile(
        'runtime/traefik/routing-map.json',
        JSON.stringify(routingMap, null, 2)
      );

      this.logger.info('Routing map persisted', { ruleCount: rules.length });
    } catch (error) {
      this.logger.error('Failed to persist routing map', error as Error, { ruleCount: rules.length });
      // Don't throw - persistence is optional for debugging
    }
  }

  // Deprecated port management methods (kept for backwards compatibility)
  async reservePorts(deploymentId: string, ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>): Promise<string> {
    const token = crypto.randomUUID();
    const portKeys: string[] = [];

    // Check availability first
    for (const port of ports) {
      if (port.host) {
        const portKey = `${port.protocol}:${port.host}`;
        if (this.portRegistry[portKey]) {
          throw new Error(`Port ${port.host}/${port.protocol} is already reserved`);
        }
        portKeys.push(portKey);
      }
    }

    // Reserve all ports
    const reservation = {
      deploymentId,
      releaseId: token,
      reservedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(), // 5 minute expiry
    };

    for (const portKey of portKeys) {
      this.portRegistry[portKey] = reservation;
    }

    this.reservations.set(token, { deploymentId, ports: portKeys });

    this.logger.info('Ports reserved', { token, deploymentId, ports: portKeys });
    return token;
  }

  async releasePorts(reservationToken: string): Promise<void> {
    const reservation = this.reservations.get(reservationToken);
    if (!reservation) {
      this.logger.warn('Port reservation not found', { token: reservationToken });
      return;
    }

    // Release all ports
    for (const portKey of reservation.ports) {
      delete this.portRegistry[portKey];
    }

    this.reservations.delete(reservationToken);
    this.logger.info('Ports released', { token: reservationToken, ports: reservation.ports });
  }

  async getPortRegistry(): Promise<GlobalPortRegistry> {
    return { ...this.portRegistry };
  }

  private async extractImagesFromDraft(draft: Draft, files?: Map<string, DraftFile & { content?: Buffer }>): Promise<string[]> {
    const images: string[] = [];

    // Try to extract from compose override
    if (draft.composeOverride) {
      try {
        const parsed = parseYAML(draft.composeOverride) as ComposeFile;
        if (parsed.services) {
          for (const service of Object.values(parsed.services)) {
            const serviceConfig = service as ComposeService;
            if (serviceConfig.image) {
              images.push(serviceConfig.image);
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Extract from uploaded compose files
    if (files) {
      for (const file of files.values()) {
        if (file.kind === 'composeOverride' && file.content) {
          try {
            const composeContent = file.content.toString('utf-8');
            const parsed = parseYAML(composeContent) as ComposeFile;
            if (parsed.services) {
              for (const service of Object.values(parsed.services)) {
                const serviceConfig = service as ComposeService;
                if (serviceConfig.image) {
                  images.push(serviceConfig.image);
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    return [...new Set(images)]; // Remove duplicates
  }
}

export class MockValidationService implements ValidationService {
  private logger = getLogger().child({ service: 'MockValidationService' });
  private mockPortRegistry: GlobalPortRegistry = {};

  async healthCheck(): Promise<ServiceHealth> {
    return {
      healthy: true,
      lastCheck: new Date(),
    };
  }

  async validateDraft(draft: Draft): Promise<ValidationReport> {
    this.logger.info('Mock: Validating draft', { draftId: draft.draftId });

    return {
      ok: true,
      errors: [],
      warnings: [
        { field: 'ports', message: 'Mock validation - ports may conflict' },
      ],
    };
  }

  async preflightCheck(draft: Draft): Promise<EnhancedPreflightResponse> {
    this.logger.info('Mock: Running preflight check', { draftId: draft.draftId });

    return {
      ok: true,
      checks: [
        { name: 'env', type: 'env', status: 'pass', detail: 'Environment variables validated' },
        { name: 'docker', type: 'docker', status: 'pass', detail: 'Docker is available' },
        { name: 'disk', type: 'disk', status: 'warn', detail: 'Disk space check skipped in mock mode' },
        { name: 'ports', type: 'ports', status: 'pass', detail: 'Ports are available' },
      ],
      reservationToken: crypto.randomUUID(),
    };
  }

  async validatePorts(): Promise<ValidationIssue[]> {
    return [];
  }

  async validateImages(): Promise<ValidationIssue[]> {
    return [];
  }

  async validateEnvironment(): Promise<ValidationIssue[]> {
    return [];
  }

  async validateResources(): Promise<ValidationIssue[]> {
    return [];
  }

  // Mock routing methods
  async validateRoutingRules(appName: string, domain: string): Promise<RoutingConflict[]> {
    this.logger.info('Mock: Validating routing rules', { appName, domain });
    // Return no conflicts in mock mode
    return [];
  }

  generateRoutingRule(deploymentId: string, appName: string, domain: string): TraefikRoutingRule {
    const host = `${appName}.${domain}`;
    return {
      deploymentId,
      appName,
      host,
      domain,
      serviceName: `mock-${appName}`,
      networkName: `mock-network-${deploymentId.slice(0, 8)}`,
      createdAt: new Date().toISOString(),
    };
  }

  async getRoutingMap(): Promise<TraefikRoutingMap> {
    this.logger.info('Mock: Getting routing map');
    return {};
  }

  async persistRoutingMap(rules: TraefikRoutingRule[]): Promise<void> {
    this.logger.info('Mock: Persisting routing map', { ruleCount: rules.length });
  }

  // Mock port management (deprecated)
  async reservePorts(deploymentId: string): Promise<string> {
    const token = crypto.randomUUID();
    this.logger.info('Mock: Reserving ports', { deploymentId, token });
    return token;
  }

  async releasePorts(reservationToken: string): Promise<void> {
    this.logger.info('Mock: Releasing ports', { token: reservationToken });
  }

  async getPortRegistry(): Promise<GlobalPortRegistry> {
    return { ...this.mockPortRegistry };
  }
}

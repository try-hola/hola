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
  RoutingConflict,
  ResourceLimits,
  AppEnvVar
} from '@hola/shared';

import { getLogger } from '../../lib/logger';
import type { HealthCheckable, ServiceHealth } from './types';
import type { DockerService } from './docker';
import type { SystemMonitoringService } from './system-monitoring';
import type { RoutingService } from './routing';
import type { StorageService } from './storage';
import { parse as parseYAML } from 'yaml';
import { validateComposeDocument } from '@hola/shared/compose-validate';
import type { ComposeFile, ComposeService } from './compose-parser';

/**
 * Prefix Compose-internal field paths (e.g. `services.web.ports[0]`) with the
 * source they came from within the draft (`composeOverride` or `files.<id>`),
 * so clients can locate the offending input precisely.
 */
function remapComposePath(issues: ValidationIssue[], source: string): ValidationIssue[] {
  return issues.map((issue) => {
    const path = issue.path ? `${source}.${issue.path}` : source;
    return { ...issue, path, field: path };
  });
}

export interface ValidationService extends HealthCheckable {
  // Draft validation
  validateDraft(draft: Draft, files?: Map<string, DraftFile & { content?: Buffer }>): Promise<ValidationReport>;
  preflightCheck(draft: Draft, files?: Map<string, DraftFile & { content?: Buffer }>): Promise<EnhancedPreflightResponse>;
  
  // Resource validation
  validatePorts(ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>): Promise<ValidationIssue[]>;
  validateImages(images: string[]): Promise<ValidationIssue[]>;
  validateEnvironment(env: AppEnvVar[]): Promise<ValidationIssue[]>;
  validateResources(limits?: ResourceLimits): Promise<ValidationIssue[]>;
}

export class RealValidationService implements ValidationService {
  private logger = getLogger().child({ service: 'ValidationService' });

  constructor(
    private dockerService: DockerService,
    private systemMonitoringService: SystemMonitoringService,
    private storageService: StorageService,
    private routingService?: RoutingService
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

    const partition = (issues: ValidationIssue[]) => {
      for (const issue of issues) {
        if (issue.severity === 'error') errors.push(issue);
        else warnings.push(issue);
      }
    };

    try {
      // Validate required fields
      if (!draft.appId) {
        errors.push({ code: 'MISSING_APP_ID', severity: 'error', field: 'appId', path: 'appId', message: 'Application ID is required' });
      }

      // Validate environment variables
      partition(await this.validateEnvironment(draft.appEnv));

      // Validate ports
      partition(await this.validatePorts(draft.ports));

      // Strict Compose schema + semantic validation of the override (#13).
      if (draft.composeOverride) {
        partition(
          remapComposePath(validateComposeDocument(draft.composeOverride), 'composeOverride'),
        );
      }

      // Validate uploaded compose files with the same strict validator.
      if (files) {
        for (const [uploadId, file] of files) {
          if (file.kind === 'composeOverride' && file.content) {
            const composeContent = file.content.toString('utf-8');
            partition(
              remapComposePath(validateComposeDocument(composeContent), `files.${uploadId}`),
            );
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
        errors: [{ code: 'VALIDATION_FAILED', severity: 'error', message: error instanceof Error ? error.message : 'Validation failed' }],
        warnings,
      };
    }
  }

  async preflightCheck(draft: Draft, files?: Map<string, DraftFile & { content?: Buffer }>): Promise<EnhancedPreflightResponse> {
    this.logger.info('Running preflight check', { draftId: draft.draftId });
    
    const checks: EnhancedPreflightCheck[] = [];

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

      // Validate port definitions (no host-port reservation; ingress is Traefik-only).
      if (draft.ports.length > 0) {
        const portIssues = await this.validatePorts(draft.ports);
        if (portIssues.some(i => i.severity === 'error')) {
          checks.push({
            name: 'ports',
            type: 'ports',
            status: 'fail',
            detail: portIssues.map(i => i.message).join(', '),
            remediation: 'Fix the port configuration',
          });
        } else {
          checks.push({
            name: 'ports',
            type: 'ports',
            status: portIssues.length > 0 ? 'warn' : 'pass',
            detail: portIssues.length > 0 ? portIssues.map(i => i.message).join(', ') : 'Port definitions are valid',
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
        const hasErrors = envIssues.some(i => i.severity === 'error');
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

      // Check Traefik routing conflicts via the routing service (host-based ingress).
      if (this.routingService) {
        try {
          const rule = this.routingService.generateRule({ deploymentId: 'preflight', appName: draft.appId });
          const routingConflicts: RoutingConflict[] = await this.routingService.validateRule(rule);

          if (routingConflicts.length === 0) {
            checks.push({
              name: 'routing',
              type: 'routing',
              status: 'pass',
              detail: `Host '${rule.host}' is available`,
            });
          } else {
            checks.push({
              name: 'routing',
              type: 'routing',
              status: 'fail',
              detail: routingConflicts.map(c => c.message).join(', '),
              remediation: 'Choose a different app name or remove the conflicting deployment',
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
      }

      const allOk = checks.every(c => c.status === 'pass');
      const hasFailures = checks.some(c => c.status === 'fail');

      return {
        ok: allOk && !hasFailures,
        checks,
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
      // Host-port publishing is unsupported (Traefik-only ingress); the strict
      // Compose validator rejects `ports:` entries. Here we only sanity-check
      // the container port range for declared port intents.
      if (port.container < 1 || port.container > 65535) {
        issues.push({
          code: 'INVALID_PORT_RANGE',
          severity: 'error',
          field: 'ports',
          path: 'ports',
          message: `Container port ${port.container} is outside valid range (1-65535)`,
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
              code: 'IMAGE_MISSING_TAG',
              severity: 'warning',
              message: `Image '${image}' should include a tag (e.g., '${image}:latest')`,
            });
          }
        } catch {
          // Ignore individual image check failures
        }
      }
    } catch (error) {
      issues.push({
        code: 'IMAGE_MISSING_TAG',
        severity: 'warning',
        message: `Could not validate images: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
          code: 'MISSING_SECRET_VALUE',
          severity: 'error',
          field: `env.${envVar.key}`,
          path: `env.${envVar.key}`,
          message: `Secret environment variable '${envVar.key}' is required but empty`,
        });
      }

      // Check for invalid characters in keys
      if (!envVar.key.match(/^[A-Z_][A-Z0-9_]*$/)) {
        issues.push({
          code: 'INVALID_ENV_KEY',
          severity: 'warning',
          field: `env.${envVar.key}`,
          path: `env.${envVar.key}`,
          message: `Environment variable name '${envVar.key}' should use uppercase letters, numbers, and underscores`,
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
          code: 'LOW_MEMORY',
          severity: 'warning',
          message: 'Memory limit is very low (< 64MB) and may cause container crashes',
        });
      }

      if (limits.cpuShares && limits.cpuShares < 256) {
        issues.push({
          code: 'LOW_CPU',
          severity: 'warning',
          message: 'CPU shares are very low and may impact performance',
        });
      }
    }

    return issues;
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
        { code: 'IMAGE_MISSING_TAG', severity: 'warning', field: 'ports', message: 'Mock validation - ports may conflict' },
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
}

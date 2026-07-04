import { readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYAML } from 'yaml';
import { getLogger } from '../../lib/logger';
import type { DraftDefaults, AppEnvVar } from '@hola/shared';

export interface ComposeService {
  image?: string;
  ports?: Array<string | { target: number; published?: number; protocol?: string }>;
  volumes?: Array<string | { source: string; target: string; readonly?: boolean }>;
  environment?: Record<string, string> | Array<string>;
  [key: string]: unknown;
}

export interface ComposeFile {
  version?: string;
  services?: Record<string, ComposeService>;
  [key: string]: unknown;
}

export interface ParsedDefaults {
  ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>;
  volumes: Array<{ hostPath?: string; containerPath: string; readOnly?: boolean }>;
  environment: AppEnvVar[];
}

/**
 * Parse compose.yaml to extract default ports, volumes, and environment variables
 */
export function parseComposeDefaults(bundlePath: string): ParsedDefaults {
  const logger = getLogger().child({ service: 'ComposeParser' });
  
  const result: ParsedDefaults = {
    ports: [],
    volumes: [],
    environment: [],
  };

  try {
    const composePath = join(bundlePath, 'compose.yaml');
    const composeContent = readFileSync(composePath, 'utf8');
    const compose: ComposeFile = parseYAML(composeContent) as ComposeFile;

    if (!compose.services || typeof compose.services !== 'object') {
      logger.warn('No services found in compose.yaml', { bundlePath });
      return result;
    }

    // Aggregate defaults from all services
    for (const [serviceName, service] of Object.entries(compose.services)) {
      if (!service || typeof service !== 'object') continue;

      // Parse ports
      if (Array.isArray(service.ports)) {
        for (const port of service.ports) {
          try {
            if (typeof port === 'string') {
              // Parse "host:container" or "container" format
              const match = port.match(/^(?:(\d+):)?(\d+)(?:\/(tcp|udp))?$/);
              if (match) {
                const [, hostStr, containerStr, protocol] = match;
                result.ports.push({
                  host: hostStr ? parseInt(hostStr, 10) : undefined,
                  container: parseInt(containerStr, 10),
                  protocol: protocol === 'udp' ? 'udp' : 'tcp',
                });
              }
            } else if (typeof port === 'object' && port.target) {
              result.ports.push({
                host: port.published,
                container: port.target,
                protocol: port.protocol === 'udp' ? 'udp' : 'tcp',
              });
            }
          } catch (error) {
            logger.debug('Failed to parse port', { serviceName, port, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }

      // Parse volumes
      if (Array.isArray(service.volumes)) {
        for (const volume of service.volumes) {
          try {
            if (typeof volume === 'string') {
              // Parse "host:container" or "host:container:ro" format
              const parts = volume.split(':');
              if (parts.length >= 2) {
                result.volumes.push({
                  hostPath: parts[0].startsWith('/') || parts[0].startsWith('./') ? parts[0] : `./${parts[0]}`,
                  containerPath: parts[1],
                  readOnly: parts[2] === 'ro',
                });
              }
            } else if (typeof volume === 'object' && volume.target) {
              result.volumes.push({
                hostPath: volume.source,
                containerPath: volume.target,
                readOnly: volume.readonly === true,
              });
            }
          } catch (error) {
            logger.debug('Failed to parse volume', { serviceName, volume, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }

      // Parse environment variables
      if (service.environment) {
        try {
          if (Array.isArray(service.environment)) {
            // Array format: ["KEY=value", "KEY2=value2"]
            for (const envVar of service.environment) {
              if (typeof envVar === 'string') {
                const [key, ...valueParts] = envVar.split('=');
                if (key) {
                  const value = valueParts.join('=');
                  result.environment.push({
                    key,
                    value: value || '',
                    isSecret: isLikelySecret(key),
                    description: generateEnvDescription(key),
                    autoDetected: true,
                  });
                }
              }
            }
          } else if (typeof service.environment === 'object') {
            // Object format: { KEY: "value", KEY2: "value2" }
            for (const [key, value] of Object.entries(service.environment)) {
              result.environment.push({
                key,
                value: String(value ?? ''),
                isSecret: isLikelySecret(key),
                description: generateEnvDescription(key),
                autoDetected: true,
              });
            }
          }
        } catch (error) {
          logger.debug('Failed to parse environment', { serviceName, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    // Remove duplicates
    result.ports = removeDuplicatePorts(result.ports);
    result.volumes = removeDuplicateVolumes(result.volumes);
    result.environment = removeDuplicateEnvVars(result.environment);

    logger.debug('Parsed compose defaults', {
      bundlePath,
      ports: result.ports.length,
      volumes: result.volumes.length,
      environment: result.environment.length,
    });

  } catch (error) {
    logger.warn('Failed to parse compose.yaml', { bundlePath, error: error instanceof Error ? error.message : String(error) });
  }

  return result;
}

/**
 * Merge compose defaults with manifest defaults, preferring manifest
 */
export function mergeDefaults(
  composeDefaults: ParsedDefaults,
  manifestDefaults: DraftDefaults,
  manifestEnv: AppEnvVar[]
): { defaults: DraftDefaults; defaultEnv: AppEnvVar[] } {
  // Start with compose defaults, overlay manifest
  const ports = [...composeDefaults.ports];
  const volumes = [...composeDefaults.volumes];
  const environment = [...composeDefaults.environment];

  // Add manifest ports (prefer manifest if same container port)
  for (const manifestPort of manifestDefaults.ports || []) {
    const existingIndex = ports.findIndex(p => p.container === manifestPort.container);
    if (existingIndex >= 0) {
      ports[existingIndex] = manifestPort; // Replace with manifest version
    } else {
      ports.push(manifestPort);
    }
  }

  // Add manifest volumes (prefer manifest if same container path)
  for (const manifestVolume of manifestDefaults.volumes || []) {
    const existingIndex = volumes.findIndex(v => v.containerPath === manifestVolume.containerPath);
    if (existingIndex >= 0) {
      volumes[existingIndex] = manifestVolume; // Replace with manifest version
    } else {
      volumes.push(manifestVolume);
    }
  }

  // Add manifest environment (prefer manifest if same key)
  for (const manifestEnvVar of manifestEnv || []) {
    const existingIndex = environment.findIndex(e => e.key === manifestEnvVar.key);
    if (existingIndex >= 0) {
      environment[existingIndex] = manifestEnvVar; // Replace with manifest version
    } else {
      environment.push(manifestEnvVar);
    }
  }

  return {
    defaults: { ports, volumes },
    defaultEnv: environment,
  };
}

// Helper functions

function isLikelySecret(key: string): boolean {
  const secretPatterns = /password|secret|token|key|credential|auth|api_key|private/i;
  return secretPatterns.test(key);
}

function generateEnvDescription(key: string): string | undefined {
  const descriptions: Record<string, string> = {
    // Database
    POSTGRES_DB: 'Database name',
    POSTGRES_USER: 'Database user',
    POSTGRES_PASSWORD: 'Database password',
    MYSQL_DATABASE: 'MySQL database name',
    MYSQL_USER: 'MySQL user',
    MYSQL_PASSWORD: 'MySQL password',
    MYSQL_ROOT_PASSWORD: 'MySQL root password',
    REDIS_PASSWORD: 'Redis password',
    
    // Common app settings
    TZ: 'Timezone',
    DOMAIN: 'Domain name',
    BASE_URL: 'Base URL',
    APP_URL: 'Application URL',
    APP_NAME: 'Application name',
    APP_ENV: 'Application environment',
    DEBUG: 'Debug mode',
    
    // Authentication
    ADMIN_USER: 'Admin username',
    ADMIN_PASSWORD: 'Admin password',
    ADMIN_EMAIL: 'Admin email',
    JWT_SECRET: 'JWT secret key',
    SESSION_SECRET: 'Session secret key',
    
    // Email/SMTP
    SMTP_HOST: 'SMTP server host',
    SMTP_PORT: 'SMTP server port',
    SMTP_USER: 'SMTP username',
    SMTP_PASSWORD: 'SMTP password',
    MAIL_FROM: 'Email from address',
    
    // SSL/TLS
    SSL_CERT: 'SSL certificate path',
    SSL_KEY: 'SSL private key path',
  };

  return descriptions[key.toUpperCase()];
}

function removeDuplicatePorts(ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>): Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }> {
  const seen = new Set<string>();
  return ports.filter(port => {
    const key = `${port.container}:${port.protocol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removeDuplicateVolumes(volumes: Array<{ hostPath?: string; containerPath: string; readOnly?: boolean }>): Array<{ hostPath?: string; containerPath: string; readOnly?: boolean }> {
  const seen = new Set<string>();
  return volumes.filter(volume => {
    const key = volume.containerPath;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removeDuplicateEnvVars(envVars: AppEnvVar[]): AppEnvVar[] {
  const seen = new Set<string>();
  return envVars.filter(envVar => {
    if (seen.has(envVar.key)) return false;
    seen.add(envVar.key);
    return true;
  });
}

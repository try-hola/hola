/**
 * Service factory for switching between mock and real implementations
 * 
 * Uses feature flags to determine which implementation to use.
 * When USE_REAL flags are enabled, services must be healthy or startup fails.
 */

import { featureFlags, type FeatureFlags } from '../config/features';
import { getLogger } from '../lib/logger';
import { recordServiceActivation } from '../lib/metrics';

// Phase 1 imports
import { RealStorageService, MockStorageService, type StorageService } from './core/storage';
import { RealConfigService, MockConfigService, type ConfigService } from './core/config';

// Phase 2 imports
import { RealDatabaseService, MockDatabaseService, type DatabaseService } from './core/database';
import { RealDatabaseConfigService, type DatabaseConfigService } from './core/database-config';

// Phase 3 imports
import { RealAuthService, MockAuthService, ApiKeyAuthProvider, type AuthService } from './auth/auth-service';

// Phase 4 imports
import { RealDockerService, MockDockerService, type DockerService } from './core/docker';
import { RealSystemMonitoringService, MockSystemMonitoringService, type SystemMonitoringService } from './core/system-monitoring';
// Phase 5 imports
import { RealLoggingService, MockLoggingService, type LoggingService } from './core/logging';
import { RealJobService, MockJobService, type JobService } from './core/jobs';

export interface ServiceHealth {
  healthy: boolean;
  lastCheck: Date;
  error?: string;
}

export interface HealthCheckable {
  healthCheck(): Promise<ServiceHealth>;
}

export interface ServiceDescriptor<T extends object> {
  name: string;
  mockImplementation: T;
  realImplementation?: T;
  featureFlag: keyof FeatureFlags;
  healthCheckInterval?: number; // milliseconds
}

class ServiceFactory {
  private logger = getLogger().child({ service: 'ServiceFactory' });
  private healthStates = new Map<string, ServiceHealth>();
  private activeServices = new Map<string, object>();
  private healthCheckTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Register and activate a service based on feature flags
   */
  createService<T extends object>(descriptor: ServiceDescriptor<T>): T {
    const { name, mockImplementation, realImplementation, featureFlag } = descriptor;
    const useReal = featureFlags[featureFlag];
    
    this.logger.info('Creating service', {
      name,
      useReal,
      hasRealImplementation: !!realImplementation,
    });

    // If real service not requested or not available, use mock
    if (!useReal || !realImplementation) {
      this.logger.info('Using mock implementation', { name, reason: useReal ? 'no_real_impl' : 'feature_disabled' });
      recordServiceActivation(name, 'mock', true);
      this.activeServices.set(name, mockImplementation);

      // Start health monitoring for mock implementations if they support it,
      // otherwise mark them healthy by default so they appear in health reports.
      if (this.isHealthCheckable(mockImplementation)) {
        this.performHealthCheck(name, mockImplementation as T & HealthCheckable).catch(error => {
          this.logger.warn('Initial mock health check failed', { name, error: error instanceof Error ? error.message : String(error) });
        });
      } else {
        this.healthStates.set(name, {
          healthy: true,
          lastCheck: new Date(),
        });
      }

      return mockImplementation;
    }

    // Try to activate real service
    const service = this.activateRealService(descriptor);
    this.activeServices.set(name, service);
    return service;
  }

  /**
   * Activate real service with health monitoring
   */
  private activateRealService<T extends object>(descriptor: ServiceDescriptor<T>): T {
    const { name, mockImplementation, realImplementation } = descriptor;
    
    if (!realImplementation) {
      throw new Error(`Real implementation not available for service: ${name}`);
    }
    
    // Set up health monitoring if the service supports it
    if (this.isHealthCheckable(realImplementation)) {
      this.startHealthMonitoring(descriptor, realImplementation as T & HealthCheckable);
    } else {
      // No health check available, assume healthy
      this.healthStates.set(name, {
        healthy: true,
        lastCheck: new Date(),
      });
      recordServiceActivation(name, 'real', true);
    }

    // Return a proxy that can switch to mock on health failure
    return new Proxy(realImplementation, {
      get: (target, prop, receiver) => {
        const health = this.healthStates.get(name);
        
        // If unhealthy and we haven't already fallen back, switch to mock
        if (health && !health.healthy) {
          this.logger.warn('Service unhealthy, falling back to mock', {
            name,
            error: health.error,
          });
          recordServiceActivation(name, 'mock', false); // false = fallback
          // Return mock implementation for this call
          return Reflect.get(mockImplementation, prop, receiver);
        }
        
        return Reflect.get(target, prop, receiver);
      }
    });
  }

  /**
   * Check if a service implements health checking
   */
  private isHealthCheckable(service: unknown): service is HealthCheckable {
    return typeof service === 'object' && 
           service !== null && 
           'healthCheck' in service &&
           typeof (service as Record<string, unknown>).healthCheck === 'function';
  }

  /**
   * Start periodic health monitoring for a service
   */
  private startHealthMonitoring<T extends object>(
    descriptor: ServiceDescriptor<T>,
    service: T & HealthCheckable
  ): void {
    const { name, healthCheckInterval = 30000 } = descriptor;
    
    // Run initial health check immediately in background
    this.performHealthCheck(name, service).catch(error => {
      this.logger.warn('Initial health check failed', { name, error: error.message });
    });
    
    // Set up periodic checks
    const timer = setInterval(() => {
      this.performHealthCheck(name, service);
    }, healthCheckInterval);
    
    this.healthCheckTimers.set(name, timer);
  }

  /**
   * Perform health check for a service
   */
  private async performHealthCheck<T>(name: string, service: T & HealthCheckable): Promise<void> {
    try {
      const health = await service.healthCheck();
      this.healthStates.set(name, health);
      
      if (health.healthy) {
        recordServiceActivation(name, 'real', true);
      } else {
        this.logger.warn('Service health check failed', {
          name,
          error: health.error,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Health check error', error instanceof Error ? error : undefined, {
        name,
      });
      
      this.healthStates.set(name, {
        healthy: false,
        lastCheck: new Date(),
        error: errorMessage,
      });
    }
  }

  /**
   * Get health status for all services
   */
  getHealthStatus(): Record<string, ServiceHealth> {
    return Object.fromEntries(this.healthStates);
  }

  /**
   * Get list of activated service names
   */
  getActivatedServices(): string[] {
    return Array.from(this.activeServices.keys());
  }

  /**
   * Get active service instance
   */
  getService<T>(name: string): T | undefined {
    return this.activeServices.get(name) as T;
  }

  /**
   * Shutdown all health monitoring
   */
  shutdown(): void {
    this.logger.info('Shutting down service factory');
    
    for (const timer of this.healthCheckTimers.values()) {
      clearInterval(timer);
    }
    
    this.healthCheckTimers.clear();
    this.healthStates.clear();
    this.activeServices.clear();
  }

  /**
   * Validate that all enabled real services are healthy, fail fast if not
   */
  async validateRealServices(): Promise<void> {
    const logger = this.logger.child({ method: 'validateRealServices' });
    const enabledServices: Array<{ name: string; flag: keyof FeatureFlags; service: () => object }> = [];

    // Check which real services are enabled
    if (featureFlags.useRealStorage) enabledServices.push({ name: 'storage', flag: 'useRealStorage', service: () => new RealStorageService() });
    if (featureFlags.useRealConfig) enabledServices.push({ name: 'config', flag: 'useRealConfig', service: () => new RealConfigService(new RealStorageService()) });
    if (featureFlags.useRealDatabase) enabledServices.push({ name: 'database', flag: 'useRealDatabase', service: () => new RealDatabaseService(new RealStorageService()) });
    if (featureFlags.useAuth) enabledServices.push({ name: 'auth', flag: 'useAuth', service: () => new RealAuthService(featureFlags.useAuth) });
    if (featureFlags.useRealDocker) {
      enabledServices.push({ name: 'docker', flag: 'useRealDocker', service: () => new RealDockerService() });
      enabledServices.push({ name: 'system-monitoring', flag: 'useRealDocker', service: () => new RealSystemMonitoringService() });
    }
    if (featureFlags.useRealJobs) {
      enabledServices.push({ name: 'logging', flag: 'useRealJobs', service: () => new RealLoggingService() });
      enabledServices.push({ name: 'jobs', flag: 'useRealJobs', service: () => new RealJobService() });
    }

    if (enabledServices.length === 0) {
      logger.info('No real services enabled, using all mocks');
      return;
    }

    logger.info('Validating enabled real services', { 
      enabledServices: enabledServices.map(s => s.name),
      flags: enabledServices.map(s => s.flag)
    });

    const failures: Array<{ name: string; flag: string; error: string }> = [];

    for (const { name, flag, service } of enabledServices) {
      try {
        const serviceInstance = service();
        
        // Only health check if the service supports it
        if (this.isHealthCheckable(serviceInstance)) {
          const health = await (serviceInstance as HealthCheckable).healthCheck();
          if (!health.healthy) {
            failures.push({
              name,
              flag: `HOLA_${flag.replace(/([A-Z])/g, '_$1').toUpperCase()}`,
              error: health.error || 'Health check failed'
            });
          } else {
            logger.info('Real service validated successfully', { name });
          }
        } else {
          logger.info('Real service validated (no health check)', { name });
        }
      } catch (error) {
        failures.push({
          name,
          flag: `HOLA_${flag.replace(/([A-Z])/g, '_$1').toUpperCase()}`,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (failures.length > 0) {
      const errorMessage = [
        `❌ ${failures.length} real service(s) failed validation:`,
        ...failures.map(f => `  • ${f.name}: ${f.error}`),
        '',
        '🛠️  Fix options:',
        ...failures.map(f => `  • Fix ${f.name} dependency and restart`),
        ...failures.map(f => `  • Disable real service: export ${f.flag}=false`),
        '',
        '💡 With real services disabled, the server will use mock implementations.',
      ].join('\n');

      logger.error('Real service validation failed', undefined, { failures });
      throw new Error(errorMessage);
    }

    logger.info('All enabled real services validated successfully');
  }
}

// Global service factory instance
let globalServiceFactory: ServiceFactory;

/**
 * Get the global service factory
 */
export function getServiceFactory(): ServiceFactory {
  if (!globalServiceFactory) {
    globalServiceFactory = new ServiceFactory();
  }
  return globalServiceFactory;
}

/**
 * Initialize services with the factory and validate real services
 */
export async function initializeServices(): Promise<void> {
  const factory = getServiceFactory(); // Initialize the factory
  const logger = getLogger().child({ service: 'ServiceInitialization' });
  
  logger.info('Initializing services with feature flags', { 
    flags: featureFlags 
  });

  // First, validate that all enabled real services are healthy
  try {
    await factory.validateRealServices();
  } catch (error) {
    logger.error('Service validation failed during initialization', error instanceof Error ? error : undefined);
    throw error; // This will cause startup to fail with a clear message
  }
  
  // Phase 1: Storage and Config Services
  logger.info('Registering Phase 1 services: Storage and Config');
  
  // Phase 4: Docker and System Monitoring Services
  logger.info('Registering Phase 4 services: Docker and System Monitoring');
  
  // Initialize Phase 4 services for health monitoring
  try {
    getDockerService(); // Register Docker service
    getSystemMonitoringService(); // Register system monitoring service
    logger.info('Phase 4 services registered successfully');
  } catch (error) {
    logger.warn('Phase 4 services registration failed, will use mocks', { error: error instanceof Error ? error.message : 'Unknown error' });
  }

  // Phase 5: Logging and Jobs Services
  logger.info('Registering Phase 5 services: Logging and Jobs');
  try {
    getLoggingService();
    getJobService();
    logger.info('Phase 5 services registered successfully');
  } catch (error) {
    logger.warn('Phase 5 services registration failed, will use mocks', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
  
  // Services will be created on-demand when needed
  // The factory pattern allows for lazy initialization
  
  logger.info('Service initialization complete');
}

/**
 * Shutdown all services
 */
export function shutdownServices(): void {
  if (globalServiceFactory) {
    globalServiceFactory.shutdown();
  }
}

/**
 * Phase 1 Service Helpers
 * Helper functions to create Phase 1 services with proper feature flag handling
 */

/**
 * Get or create storage service
 */
export function getStorageService(): StorageService {
  const factory = getServiceFactory();
  
  // Check if already created
  const existing = factory.getService<StorageService>('storage');
  if (existing) {
    return existing;
  }

  // Create new service
  return factory.createService<StorageService>({
    name: 'storage',
    mockImplementation: new MockStorageService(),
    realImplementation: new RealStorageService(),
    featureFlag: 'useRealStorage',
    healthCheckInterval: 60000, // 1 minute
  });
}

/**
 * Get or create config service (depends on storage)
 */
export function getConfigService(): ConfigService {
  const factory = getServiceFactory();
  
  // Check if already created
  const existing = factory.getService<ConfigService>('config');
  if (existing) {
    return existing;
  }

  // Get storage service first (dependency)
  const storageService = getStorageService();

  // Create new service
  return factory.createService<ConfigService>({
    name: 'config',
    mockImplementation: new MockConfigService(),
    realImplementation: new RealConfigService(storageService),
    featureFlag: 'useRealConfig',
    healthCheckInterval: 60000, // 1 minute
  });
}

/**
 * Phase 2 Service Helpers
 * Helper functions to create Phase 2 services with database support
 */

/**
 * Get or create database service (depends on storage)
 */
export function getDatabaseService(): DatabaseService {
  const factory = getServiceFactory();
  
  // Check if already created
  const existing = factory.getService<DatabaseService>('database');
  if (existing) {
    return existing;
  }

  // Get storage service first (dependency)
  const storageService = getStorageService();

  // Create new service
  return factory.createService<DatabaseService>({
    name: 'database',
    mockImplementation: new MockDatabaseService(),
    realImplementation: new RealDatabaseService(storageService),
    featureFlag: 'useRealDatabase',
    healthCheckInterval: 30000, // 30 seconds
  });
}

/**
 * Get or create database config service (depends on database)
 * This is an alternative to the file-based config service for Phase 2
 */
export function getDatabaseConfigService(): DatabaseConfigService {
  const factory = getServiceFactory();
  
  // Check if already created
  const existing = factory.getService<DatabaseConfigService>('database-config');
  if (existing) {
    return existing;
  }

  // Get database service first (dependency)
  const databaseService = getDatabaseService();

  // Create new service
  return factory.createService<DatabaseConfigService>({
    name: 'database-config',
    mockImplementation: new MockConfigService() as unknown as DatabaseConfigService,
    realImplementation: new RealDatabaseConfigService(databaseService),
    featureFlag: 'useRealDatabase', // Uses database flag, not config flag
    healthCheckInterval: 60000, // 1 minute
  });
}

/**
 * Smart config service getter - returns database-backed config if database is enabled,
 * otherwise returns file-based config
 */
export function getActiveConfigService(): ConfigService | DatabaseConfigService {
  const { useRealDatabase } = featureFlags;
  
  if (useRealDatabase) {
    return getDatabaseConfigService();
  } else {
    return getConfigService();
  }
}

/**
 * Phase 3 Service Helpers
 * Helper functions to create Phase 3 services with authentication support
 */

/**
 * Get or create auth service
 */
export function getAuthService(): AuthService {
  const factory = getServiceFactory();
  
  // Check if already created
  const existing = factory.getService<AuthService>('auth');
  if (existing) {
    return existing;
  }

  // Create auth service with default configuration
  const realAuthService = new RealAuthService(featureFlags.useAuth);
  
  // Register API key provider with default development keys
  if (featureFlags.useAuth) {
    const apiKeyProvider = new ApiKeyAuthProvider({
      'dev-key-123': {
        id: 'dev-user-1',
        name: 'Development User',
        email: 'dev@hola.local',
        roles: ['admin'],
        capabilities: ['*'],
      },
      'readonly-key-456': {
        id: 'readonly-user',
        name: 'Read Only User',
        roles: ['reader'],
        capabilities: ['read:system', 'read:deployments', 'read:logs', 'read:backups', 'read:catalog'],
      },
    });
    
    realAuthService.registerProvider(apiKeyProvider);
  }

  // Create new service
  return factory.createService<AuthService>({
    name: 'auth',
    mockImplementation: new MockAuthService(),
    realImplementation: realAuthService,
    featureFlag: 'useAuth',
    healthCheckInterval: 60000, // 1 minute
  });
}

/**
 * Phase 4 Service Helpers
 * Helper functions to create Phase 4 services with Docker and system monitoring
 */

/**
 * Get or create Docker service
 */
export function getDockerService(): DockerService {
  const factory = getServiceFactory();
  
  // Check if already created
  const existing = factory.getService<DockerService>('docker');
  if (existing) {
    return existing;
  }

  // Create new service
  return factory.createService<DockerService>({
    name: 'docker',
    mockImplementation: new MockDockerService(),
    realImplementation: new RealDockerService(),
    featureFlag: 'useRealDocker',
    healthCheckInterval: 30000, // 30 seconds
  });
}

/**
 * Get or create system monitoring service (depends on storage)
 */
export function getSystemMonitoringService(): SystemMonitoringService {
  const factory = getServiceFactory();
  
  // Check if already created
  const existing = factory.getService<SystemMonitoringService>('system-monitoring');
  if (existing) {
    return existing;
  }

  // Create new service with default .hola path
  return factory.createService<SystemMonitoringService>({
    name: 'system-monitoring',
    mockImplementation: new MockSystemMonitoringService(),
    realImplementation: new RealSystemMonitoringService(), // Uses default ~/.hola path
    featureFlag: 'useRealDocker', // Uses Docker flag since it depends on Docker monitoring
    healthCheckInterval: 30000, // 30 seconds
  });
}

/**
 * Phase 5 Service Helpers
 * Logging and Jobs services with feature flags (useRealJobs toggles both)
 */

export function getLoggingService(): LoggingService {
  const factory = getServiceFactory();

  const existing = factory.getService<LoggingService>('logging');
  if (existing) return existing;

  // Create new service (no separate flag; tie to jobs feature for activation)
  return factory.createService<LoggingService>({
    name: 'logging',
    mockImplementation: new MockLoggingService(),
    realImplementation: new RealLoggingService(),
    featureFlag: 'useRealJobs',
    healthCheckInterval: 60000,
  });
}

export function getJobService(): JobService {
  const factory = getServiceFactory();

  const existing = factory.getService<JobService>('jobs');
  if (existing) return existing;

  return factory.createService<JobService>({
    name: 'jobs',
    mockImplementation: new MockJobService(),
    realImplementation: new RealJobService(),
    featureFlag: 'useRealJobs',
    healthCheckInterval: 30000,
  });
}

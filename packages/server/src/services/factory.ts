/**
 * Service factory for switching between mock and real implementations
 * 
 * Uses feature flags to determine which implementation to use,
 * with automatic fallback to mocks on health check failures.
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
    
    // Initial health check
    this.performHealthCheck(name, service);
    
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
 * Initialize services with the factory
 */
export function initializeServices(): void {
  getServiceFactory(); // Initialize the factory
  const logger = getLogger().child({ service: 'ServiceInitialization' });
  
  logger.info('Initializing services with feature flags', { 
    flags: featureFlags 
  });
  
  // Phase 1: Storage and Config Services
  logger.info('Registering Phase 1 services: Storage and Config');
  
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

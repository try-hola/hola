/**
 * Simplified Service Factory
 * 
 * Environment-based service selection for testing and production use.
 * Replaces complex feature flag and health monitoring patterns with 
 * simple, predictable service instantiation.
 */

// Import all service implementations
import { RealStorageService, MockStorageService, type StorageService } from './core/storage';
import { RealConfigService, MockConfigService, type ConfigService } from './core/config';
import { RealDatabaseService, MockDatabaseService, type DatabaseService } from './core/database';
import { RealDatabaseConfigService, type DatabaseConfigService } from './core/database-config';
import { RealAuthService, MockAuthService, ApiKeyAuthProvider, type AuthService } from './auth/auth-service';
import { RealDockerService, MockDockerService, type DockerService } from './core/docker';
import { RealSystemMonitoringService, MockSystemMonitoringService, type SystemMonitoringService } from './core/system-monitoring';
import { RealLoggingService, MockLoggingService, type LoggingService } from './core/logging';
import { RealJobService, MockJobService, type JobService } from './core/jobs';
import { RealCatalogService, MockCatalogService, type CatalogService } from './core/catalog';
import { RealBundleService, MockBundleService, type BundleService } from './core/bundles';
import { RealDraftService, MockDraftService, type DraftService } from './core/draft';
import { RealValidationService, MockValidationService, type ValidationService } from './core/validation';
import { RealDeploymentService, MockDeploymentService, type DeploymentService } from './core/deployment';

/**
 * Service collection interface
 */
export interface Services {
  storage: StorageService;
  config: ConfigService;
  database: DatabaseService;
  databaseConfig: DatabaseConfigService;
  auth: AuthService;
  docker: DockerService;
  systemMonitoring: SystemMonitoringService;
  logging: LoggingService;
  jobs: JobService;
  catalog: CatalogService;
  bundles: BundleService;
  drafts: DraftService;
  validation: ValidationService;
  deployments: DeploymentService;
}

/**
 * Environment types for service selection
 */
export type ServiceEnvironment = 'test' | 'development' | 'production';

/**
 * Create services based on environment
 * 
 * @param env - Environment to create services for ('test', 'development', or 'production')
 * @returns Complete service collection
 */
export function createServices(env: ServiceEnvironment): Services {
  if (env === 'test') {
    // All mock services for reliable testing
    const storage = new MockStorageService();
    const database = new MockDatabaseService();
    // Share the jobs service so deployment history reflects jobs created by
    // create/action/rollback (the deployment service is the single owner).
    const jobs = new MockJobService();

    return {
      storage,
      config: new MockConfigService(),
      database,
      databaseConfig: new RealDatabaseConfigService(database),
      auth: new MockAuthService(),
      docker: new MockDockerService(),
      systemMonitoring: new MockSystemMonitoringService(),
      logging: new MockLoggingService(),
      jobs,
      catalog: new MockCatalogService(),
      bundles: new MockBundleService(),
      drafts: new MockDraftService(),
      validation: new MockValidationService(),
      deployments: new MockDeploymentService(jobs),
    };
  }
  
  if (env === 'development') {
    // Mixed services for development: real services where possible, mocks for external dependencies
    const storage = new RealStorageService();
    const database = new RealDatabaseService(storage);
    const authService = new RealAuthService(false); // Auth disabled in development by default
    const docker = new MockDockerService(); // Use mock Docker for safety in development
    const systemMonitoring = new RealSystemMonitoringService(storage.resolveHolaPath());
    
    // Create logging service with storage dependency
    const logging = new RealLoggingService(storage);
    
    // Create jobs service with database and logging dependencies
    const jobs = new RealJobService(database, logging);
    
    const catalog = new RealCatalogService();
    
    // Create shared validation service instance to avoid duplication
    const validation = new RealValidationService(docker, systemMonitoring, storage);

    // Shared draft service: the deployment service builds releases from its finalized artifacts.
    const drafts = new RealDraftService(storage, catalog, validation);

    return {
      storage,
      config: new RealConfigService(storage),
      database,
      databaseConfig: new RealDatabaseConfigService(database),
      auth: authService,
      docker,
      systemMonitoring,
      logging,
      jobs,
      catalog,
      bundles: new RealBundleService(storage.resolveHolaPath('cache', 'bundles')),
      drafts,
      validation,
      deployments: new RealDeploymentService(storage, jobs, docker, drafts),
    };
  }
  
  // All real services for production
  const storage = new RealStorageService();
  const database = new RealDatabaseService(storage);
  const authService = new RealAuthService(true);
  const docker = new RealDockerService();
  const systemMonitoring = new RealSystemMonitoringService(storage.resolveHolaPath());
  
  // Create logging service with storage dependency
  const logging = new RealLoggingService(storage);
  
  // Create jobs service with database and logging dependencies
  const jobs = new RealJobService(database, logging);
  
  const catalog = new RealCatalogService();
  
  // Set up auth provider for real auth service
  const apiKeyProvider = new ApiKeyAuthProvider();
  authService.registerProvider(apiKeyProvider);
  
  // Create shared validation service instance to avoid duplication
  const validation = new RealValidationService(docker, systemMonitoring, storage);

  // Shared draft service: the deployment service builds releases from its finalized artifacts.
  const drafts = new RealDraftService(storage, catalog, validation);

  return {
    storage,
    config: new RealConfigService(storage),
    database,
    databaseConfig: new RealDatabaseConfigService(database),
    auth: authService,
    docker,
    systemMonitoring,
    logging,
    jobs,
    catalog,
    bundles: new RealBundleService(storage.resolveHolaPath('cache', 'bundles')),
    drafts,
    validation,
    deployments: new RealDeploymentService(storage, jobs, docker, drafts),
  };
}

/**
 * Determine environment from process environment variables
 */
export function detectEnvironment(): ServiceEnvironment {
  // Check if we're in a test environment
  if (process.env.NODE_ENV === 'test' || 
      process.env.VITEST === 'true' || 
      process.env.HOLA_DISABLE_AUTOSTART === 'true') {
    return 'test';
  }
  
  // Check if we're in development environment
  if (process.env.NODE_ENV === 'development') {
    return 'development';
  }
  
  return 'production';
}

/**
 * Global services instance
 */
let globalServices: Services | null = null;

/**
 * Get or create global services instance
 */
export function getServices(): Services {
  if (!globalServices) {
    const env = detectEnvironment();
    globalServices = createServices(env);
  }
  return globalServices;
}

/**
 * Reset global services (useful for testing)
 */
export function resetServices(): void {
  globalServices = null;
}

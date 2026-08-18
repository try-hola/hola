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
import { RealAuthService, MockAuthService, type AuthService } from './auth/auth-service';
import { resolveAdminApiKey, createAdminApiKeyProvider } from './auth/api-key-config';
import { RealContractTokenService, createContractTokenAuthProvider } from './auth/contract-tokens';
import { createOidcAuthProvider } from './auth/oidc-provider';
import { RealDockerService, MockDockerService, type DockerService } from './core/docker';
import { RealSystemMonitoringService, MockSystemMonitoringService, type SystemMonitoringService } from './core/system-monitoring';
import { RealUpdateCheckService, MockUpdateCheckService, type UpdateCheckService } from './core/update-check';
import { RealLoggingService, MockLoggingService, type LoggingService } from './core/logging';
import { RealJobService, MockJobService, type JobService } from './core/jobs';
import { InProcessEventBus, type EventBus } from './core/event-bus';
import { RealCatalogService, MockCatalogService, type CatalogService } from './core/catalog';
import { RealBundleService, MockBundleService, type BundleService } from './core/bundles';
import { RealRegistryCredentialService, MockRegistryCredentialService, type RegistryCredentialService } from './core/registry-credentials';
import { RealCatalogSourceService, MockCatalogSourceService, type CatalogSourceService } from './core/catalog-sources';
import { RealDraftService, MockDraftService, type DraftService } from './core/draft';
import { RealValidationService, MockValidationService, type ValidationService } from './core/validation';
import { RealRoutingService, MockRoutingService, type RoutingService } from './core/routing';
import { RealDeploymentService, MockDeploymentService, type DeploymentService } from './core/deployment';
import { RealAuthentikProvisionerService, MockProvisionerService, NoneProvisionerService, type ProvisionerService } from './core/provisioner';
import { authConfig } from '../config/auth';

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
  updateCheck: UpdateCheckService;
  logging: LoggingService;
  jobs: JobService;
  eventBus: EventBus;
  catalog: CatalogService;
  bundles: BundleService;
  registryCredentials: RegistryCredentialService;
  catalogSources: CatalogSourceService;
  drafts: DraftService;
  validation: ValidationService;
  routing: RoutingService;
  provisioner: ProvisionerService;
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
    const eventBus = new InProcessEventBus();
    const jobs = new MockJobService(eventBus);

    return {
      storage,
      config: new MockConfigService(),
      database,
      databaseConfig: new RealDatabaseConfigService(database),
      auth: new MockAuthService(),
      docker: new MockDockerService(),
      systemMonitoring: new MockSystemMonitoringService(),
      updateCheck: new MockUpdateCheckService(),
      logging: new MockLoggingService(),
      jobs,
      eventBus,
      catalog: new MockCatalogService(),
      bundles: new MockBundleService(),
      registryCredentials: new MockRegistryCredentialService(),
      catalogSources: new MockCatalogSourceService(),
      drafts: new MockDraftService(),
      validation: new MockValidationService(),
      routing: new MockRoutingService(),
      provisioner: new MockProvisionerService(),
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
    
    // Global event bus backing the dashboard-wide /api/events stream (#291).
    const eventBus = new InProcessEventBus();

    // Create jobs service with database and logging dependencies
    const jobs = new RealJobService(database, logging, eventBus);

    const catalog = new RealCatalogService();

    // Shared routing service owns Traefik rule generation/validation/emission.
    const routing = new RealRoutingService(storage);

    // Create shared validation service instance to avoid duplication
    const validation = new RealValidationService(docker, systemMonitoring, storage, routing);

    // Registry credentials for private OCI pulls (shared by drafts + deployments).
    const registryCredentials = new RealRegistryCredentialService(storage);

    // Shared draft service: the deployment service builds releases from its finalized
    // artifacts. Reuses the shared `routing` instance above for seed-time platform-
    // token prefill (`${HOLA_APP_HOST}`/`${HOLA_BASE_DOMAIN}` → concrete values).
    const drafts = new RealDraftService(storage, catalog, validation, registryCredentials, routing);

    // Mock provisioner in development for safety (no calls to a real auth platform).
    const provisioner = new MockProvisionerService();

    return {
      storage,
      config: new RealConfigService(storage),
      database,
      databaseConfig: new RealDatabaseConfigService(database),
      auth: authService,
      docker,
      systemMonitoring,
      updateCheck: new MockUpdateCheckService(),
      logging,
      jobs,
      eventBus,
      catalog,
      bundles: new RealBundleService(storage.resolveHolaPath('cache', 'bundles')),
      registryCredentials,
      catalogSources: new RealCatalogSourceService(storage),
      drafts,
      validation,
      routing,
      provisioner,
      deployments: new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, provisioner, catalog, eventBus, registryCredentials),
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

  // Global event bus backing the dashboard-wide /api/events stream (#291).
  const eventBus = new InProcessEventBus();

  // Create jobs service with database and logging dependencies
  const jobs = new RealJobService(database, logging, eventBus);

  const catalog = new RealCatalogService();
  
  // Set up auth providers for real auth service. Order matters: the api-key
  // provider runs first (cheap map lookup for the admin key / CLI tokens); the
  // OIDC provider runs second and validates dashboard Bearer JWTs. The OIDC
  // provider self-disables until an issuer/clientId is configured (e.g. after
  // startup self-provisioning), so registering it unconditionally is safe.
  authService.registerProvider(createAdminApiKeyProvider(resolveAdminApiKey()));
  authService.registerProvider(createOidcAuthProvider());
  // Contract-scoped tokens (ADR 0004 §6): a provider app calling its own contract
  // endpoints. Registered last — it only ever matches its own `hct_` prefix, so it
  // costs nothing for the admin/dashboard paths that resolve above it.
  const contractTokens = new RealContractTokenService(storage);
  authService.registerProvider(createContractTokenAuthProvider(contractTokens));
  
  // Shared routing service owns Traefik rule generation/validation/emission.
  const routing = new RealRoutingService(storage);

  // Create shared validation service instance to avoid duplication
  const validation = new RealValidationService(docker, systemMonitoring, storage, routing);

  // Registry credentials for private OCI pulls (shared by drafts + deployments).
  const registryCredentials = new RealRegistryCredentialService(storage);

  // Shared draft service: the deployment service builds releases from its finalized
  // artifacts. Reuses the shared `routing` instance above for seed-time platform-
  // token prefill (`${HOLA_APP_HOST}`/`${HOLA_BASE_DOMAIN}` → concrete values).
  const drafts = new RealDraftService(storage, catalog, validation, registryCredentials, routing);

  // Provision auth artifacts against the configured platform. When no backend is
  // configured (mode != authentik) use the real no-op provisioner — NOT the Mock,
  // which injects fake creds / a dead forward-auth gate into real apps (#110).
  const provisioner: ProvisionerService =
    authConfig.mode === 'authentik'
      ? new RealAuthentikProvisionerService(authConfig)
      : new NoneProvisionerService();

  return {
    storage,
    config: new RealConfigService(storage),
    database,
    databaseConfig: new RealDatabaseConfigService(database),
    auth: authService,
    docker,
    systemMonitoring,
    updateCheck: new RealUpdateCheckService(),
    logging,
    jobs,
    eventBus,
    catalog,
    bundles: new RealBundleService(storage.resolveHolaPath('cache', 'bundles')),
    registryCredentials,
    catalogSources: new RealCatalogSourceService(storage),
    drafts,
    validation,
    routing,
    provisioner,
    deployments: new RealDeploymentService(storage, jobs, docker, drafts, routing, logging, provisioner, catalog, eventBus, registryCredentials, contractTokens),
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

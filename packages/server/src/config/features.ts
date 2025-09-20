/**
 * Feature flags for progressive activation of real services
 * 
 * Each flag controls whether to use real or mock implementations.
 * Default to false for safety; auto-fallback to mocks on health check failure.
 */

export interface FeatureFlags {
  useRealStorage: boolean;
  useRealConfig: boolean;
  useRealDatabase: boolean;
  useRealDocker: boolean;
  useRealJobs: boolean;
  useRealCatalog: boolean;
  useRealBundles: boolean;
  useRealDrafts: boolean;
  useRealValidation: boolean;
  useRealDeployments: boolean;
  useRealBackups: boolean;
  useAuth: boolean;
  useObservability: boolean; // enables metrics/tracing/exporters
}

export const defaultFeatureFlags: FeatureFlags = {
  useRealStorage: false,
  useRealConfig: false,
  useRealDatabase: false,
  useRealDocker: false,
  useRealJobs: false,
  useRealCatalog: false,
  useRealBundles: false,
  useRealDrafts: false,
  useRealValidation: false,
  useRealDeployments: false,
  useRealBackups: false,
  useAuth: false,
  useObservability: false,
};

/**
 * Load feature flags from environment variables
 */
export function loadFeatureFlags(): FeatureFlags {
  return {
    useRealStorage: process.env.HOLA_USE_REAL_STORAGE === 'true',
    useRealConfig: process.env.HOLA_USE_REAL_CONFIG === 'true',
    useRealDatabase: process.env.HOLA_USE_REAL_DATABASE === 'true',
    useRealDocker: process.env.HOLA_USE_REAL_DOCKER === 'true',
    useRealJobs: process.env.HOLA_USE_REAL_JOBS === 'true',
    useRealCatalog: process.env.HOLA_USE_REAL_CATALOG === 'true',
  useRealBundles: process.env.HOLA_USE_REAL_BUNDLES === 'true',
    useRealDrafts: process.env.HOLA_USE_REAL_DRAFTS === 'true',
    useRealValidation: process.env.HOLA_USE_REAL_VALIDATION === 'true',
    useRealDeployments: process.env.HOLA_USE_REAL_DEPLOYMENTS === 'true',
    useRealBackups: process.env.HOLA_USE_REAL_BACKUPS === 'true',
    useAuth: process.env.HOLA_USE_AUTH === 'true',
    useObservability: process.env.HOLA_USE_OBSERVABILITY === 'true',
  };
}

/**
 * Global feature flags instance
 */
export const featureFlags = loadFeatureFlags();

/**
 * Check if a feature flag is enabled
 */
export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  return featureFlags[flag];
}

/**
 * Environment-specific configuration
 */
export interface AppConfig {
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logFormat: 'json' | 'pretty';
  metricsEnabled: boolean;
  healthCheckInterval: number;
  requestTimeout: number;
}

export const defaultAppConfig: AppConfig = {
  port: 3001,
  logLevel: 'info',
  logFormat: 'json',
  metricsEnabled: true,
  healthCheckInterval: 30000, // 30 seconds
  requestTimeout: 30000, // 30 seconds
};

/**
 * Load app configuration from environment
 */
export function loadAppConfig(): AppConfig {
  return {
    port: Number(process.env.PORT) || defaultAppConfig.port,
    logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) || defaultAppConfig.logLevel,
    logFormat: (process.env.LOG_FORMAT as AppConfig['logFormat']) || defaultAppConfig.logFormat,
    metricsEnabled: process.env.METRICS_ENABLED !== 'false',
    healthCheckInterval: Number(process.env.HEALTH_CHECK_INTERVAL) || defaultAppConfig.healthCheckInterval,
    requestTimeout: Number(process.env.REQUEST_TIMEOUT) || defaultAppConfig.requestTimeout,
  };
}

/**
 * Global app configuration instance
 */
export const appConfig = loadAppConfig();

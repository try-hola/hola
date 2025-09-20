/**
 * Environment-based configuration system
 * 
 * Replaces complex feature flag matrix with simple environment modes.
 * Each environment has clear, predictable configuration defaults.
 */

export type Environment = 'test' | 'development' | 'production';

export interface EnvironmentConfig {
  environment: Environment;
  useAuth: boolean;
  useObservability: boolean;
  enableDevApi: boolean;
  useRealServices: boolean;
}

/**
 * Get configuration for an environment
 */
export function getEnvironmentConfig(env: Environment): EnvironmentConfig {
  switch (env) {
    case 'test':
      return {
        environment: 'test',
        useAuth: false,           // Simplify test setup
        useObservability: false,  // Reduce test complexity
        enableDevApi: true,       // Enable dev endpoints for testing
        useRealServices: false,   // Always use mocks for reliable testing
      };
    
    case 'development': 
      return {
        environment: 'development',
        useAuth: false,           // Optional in development, can be overridden
        useObservability: false,  // Optional in development, can be overridden
        enableDevApi: true,       // Enable dev features for development
        useRealServices: true,    // Mix of real and mock services for development
      };
    
    case 'production':
      return {
        environment: 'production', 
        useAuth: true,            // Production security enabled
        useObservability: true,   // Full observability in production
        enableDevApi: false,      // No dev endpoints in production
        useRealServices: true,    // Always real services in production
      };
  }
}

/**
 * Detect environment from process.env
 */
export function detectEnvironment(): Environment {
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
 * Load environment configuration with optional overrides
 */
export function loadEnvironmentConfig(): EnvironmentConfig {
  const env = detectEnvironment();
  const config = getEnvironmentConfig(env);
  
  // Allow specific overrides for development and production
  if (env === 'development' || env === 'production') {
    // Auth can be overridden
    if (process.env.HOLA_USE_AUTH === 'true') {
      config.useAuth = true;
    } else if (process.env.HOLA_USE_AUTH === 'false') {
      config.useAuth = false;
    }
    
    // Observability can be overridden
    if (process.env.HOLA_USE_OBSERVABILITY === 'true') {
      config.useObservability = true;
    } else if (process.env.HOLA_USE_OBSERVABILITY === 'false') {
      config.useObservability = false;
    }
  }
  
  return config;
}

/**
 * Legacy feature flags interface for backward compatibility
 * 
 * @deprecated Use EnvironmentConfig instead
 */
export interface FeatureFlags {
  useAuth: boolean;
  useObservability: boolean; // enables metrics/tracing/exporters
}

/**
 * @deprecated Use loadEnvironmentConfig() instead
 */
export function loadFeatureFlags(): FeatureFlags {
  const config = loadEnvironmentConfig();
  return {
    useAuth: config.useAuth,
    useObservability: config.useObservability,
  };
}

/**
 * @deprecated Use loadEnvironmentConfig() instead
 */
export const defaultFeatureFlags: FeatureFlags = {
  useAuth: false,
  useObservability: false,
};

/**
 * Global environment configuration instance
 */
export const environmentConfig = loadEnvironmentConfig();

/**
 * Global feature flags instance (for backward compatibility)
 * 
 * @deprecated Use environmentConfig instead
 */
export const featureFlags = loadFeatureFlags();

/**
 * Check if a feature flag is enabled
 * 
 * @deprecated Use environmentConfig directly instead
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

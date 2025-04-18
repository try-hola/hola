/**
 * ServerProvider interface defines the contract for different server type implementations
 * This abstraction allows us to support multiple server types (OrbStack, Docker Desktop, Remote Docker)
 * while maintaining a consistent interface.
 */
interface ServerProvider {
  /**
   * Unique identifier for this server provider type
   */
  readonly type: string;
  
  /**
   * Human-readable name of the server provider
   */
  readonly displayName: string;
  
  /**
   * Check if this provider is available on the current system
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * Bootstrap a new server using this provider
   */
  bootstrap(options: ServerBootstrapOptions): Promise<ServerContext>;
  
  /**
   * Validate a server context for this provider type
   */
  validateContext(context: ServerContext): Promise<boolean>;
  
  /**
   * Get provider-specific configuration options
   */
  getConfigOptions(): ServerProviderConfigOptions;
}

/**
 * Options for bootstrapping a server
 */
interface ServerBootstrapOptions {
  name: string;
  dataDir?: string;
  port?: number;
  resourceLimits?: {
    cpu?: number;
    memory?: string;
  };
  // Database configuration
  dbUser?: string;
  dbName?: string;
  dbPassword?: string;
  // Authentication provider configuration
  authProvider?: {
    initialAdminPassword?: string;
    domain?: string;
  };
  // OIDC configuration
  oidc?: {
    issuerUrl?: string;
    clientId?: string;
  };
  // Provider-specific options
  providerOptions: Record<string, any>;
}

/**
 * Server context representing a connection to a Hola server
 */
interface ServerContext {
  name: string;
  url: string;
  clientId: string;
  type: string; // ServerProvider type
  providerOptions: Record<string, any>; // Provider-specific options
  timeout?: number;
}

/**
 * Configuration options specific to a server provider
 */
interface ServerProviderConfigOptions {
  // Options that will appear in bootstrap wizard and server configuration
  [key: string]: {
    type: 'string' | 'number' | 'boolean';
    label: string;
    description: string;
    default?: any;
    required?: boolean;
  };
}

export {
  ServerProvider,
  ServerBootstrapOptions,
  ServerContext,
  ServerProviderConfigOptions
};
/**
 * ServerProviderRegistry manages available server providers and enables
 * selecting the appropriate provider when needed.
 * This design allows us to focus on OrbStack initially while having a clear
 * path to add other providers (Docker Desktop, Remote Docker) in the future.
 */
const OrbStackProvider = require('./providers/orbstack-provider');
// Future imports for other providers:
// const DockerDesktopProvider = require('./providers/docker-desktop-provider');
// const RemoteDockerProvider = require('./providers/remote-docker-provider');

class ServerProviderRegistry {
  private providers: Map<string, any>;
  
  constructor() {
    this.providers = new Map();
    
    // Register the OrbStack provider initially
    this.registerProvider(new OrbStackProvider());
    
    // These will be uncommented in future phases:
    // this.registerProvider(new DockerDesktopProvider());
    // this.registerProvider(new RemoteDockerProvider());
  }
  
  /**
   * Register a server provider
   */
  registerProvider(provider: any): void {
    this.providers.set(provider.type, provider);
  }
  
  /**
   * Get a specific provider by type
   */
  getProvider(type: string): any {
    return this.providers.get(type);
  }
  
  /**
   * Get all registered providers
   */
  getAllProviders(): any[] {
    return Array.from(this.providers.values());
  }
  
  /**
   * Get available providers (providers that are detected on the system)
   */
  async getAvailableProviders(): Promise<any[]> {
    const availableProviders = [];
    
    for (const provider of this.providers.values()) {
      if (await provider.isAvailable()) {
        availableProviders.push(provider);
      }
    }
    
    return availableProviders;
  }
  
  /**
   * Get the provider for a given server context
   */
  getProviderForContext(context: any): any {
    return this.getProvider(context.type);
  }
}

// Create a singleton instance
const serverProviderRegistry = new ServerProviderRegistry();

module.exports = serverProviderRegistry;